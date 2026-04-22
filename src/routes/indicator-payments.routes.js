import { Router } from "express";
import { z } from "zod";

import { writeAuditLog } from "../lib/audit.js";
import { HttpError } from "../lib/http-error.js";
import { parseLeadMetadata } from "../lib/lead-metadata.js";
import { fromCents, toCents } from "../lib/money.js";
import { prisma } from "../lib/prisma.js";
import { cuidSchema } from "../lib/schemas.js";
import { serializeUser } from "../lib/serializers.js";
import { authenticate } from "../middlewares/authenticate.js";
import { requireModuleAccess } from "../middlewares/require-module-access.js";
import { validate } from "../middlewares/validate.js";

export const indicatorPaymentsRouter = Router();

const paymentStatusSchema = z.enum(["pending", "paid"]);

const listQuerySchema = z.object({
  q: z.string().trim().optional(),
  status: paymentStatusSchema.optional(),
  indicatorId: cuidSchema.optional(),
});

const updatePaymentSchema = z.object({
  status: paymentStatusSchema,
  dueDate: z.string().datetime().optional().nullable(),
  paidAt: z.string().datetime().optional().nullable(),
  notes: z.string().trim().max(2000).optional().nullable(),
});

indicatorPaymentsRouter.use(authenticate);

function resolveIndicatorForLead(lead, indicatorMap) {
  const metadata = parseLeadMetadata(lead.notes);
  const indicatorId = metadata.representativeId || lead.indicatorId || null;
  const indicator =
    (indicatorId && indicatorMap.get(indicatorId)) ||
    (lead.indicator?.id ? indicatorMap.get(lead.indicator.id) : null) ||
    null;
  const explicitAmount =
    Number(metadata.passThroughAmount || 0) || Number(metadata.representativeCommission || 0);
  const fallbackAmount =
    indicator && lead.ticket?.setupInCents
      ? fromCents(lead.ticket.setupInCents) * (indicator.percentSetup / 100)
      : 0;
  const amountInCents = toCents(explicitAmount || fallbackAmount);

  return {
    indicatorId,
    indicator,
    amountInCents,
    dueDate: lead.wonAt || lead.createdAt,
  };
}

function buildPaymentListItem(lead, payment, indicatorMap) {
  const resolved = resolveIndicatorForLead(lead, indicatorMap);

  if (!resolved.indicatorId || !resolved.indicator || resolved.amountInCents <= 0) {
    return null;
  }

  const currentStatus = payment?.status || "pending";

  return {
    id: payment?.id || null,
    leadId: lead.id,
    ticketCode: lead.ticket?.code || null,
    company: payment?.leadCompanySnapshot || lead.company,
    indicatorId: payment?.indicatorId || resolved.indicatorId,
    indicatorName: payment?.indicatorNameSnapshot || resolved.indicator.name,
    amount: fromCents(payment?.amountInCents ?? resolved.amountInCents),
    commissionPercent: resolved.indicator.percentSetup,
    indicator: {
      id: resolved.indicator.id,
      name: resolved.indicator.name,
      percentSetup: resolved.indicator.percentSetup,
      docType: resolved.indicator.docType,
      docNumber: resolved.indicator.docNumber || null,
      contact: resolved.indicator.contact || null,
      email: resolved.indicator.email || null,
      bank: resolved.indicator.bank || null,
      agency: resolved.indicator.agency || null,
      account: resolved.indicator.account || null,
      pixKey: resolved.indicator.pixKey || null,
    },
    status: currentStatus,
    dueDate: payment?.dueDate || resolved.dueDate,
    paidAt: payment?.paidAt || null,
    notes: payment?.notes || null,
    wonAt: lead.wonAt || null,
    paymentMethod: lead.paymentMethod || null,
    setupAmount: fromCents(lead.ticket?.setupInCents || 0),
    recurringAmount: fromCents(lead.ticket?.recurringInCents || 0),
    seller: serializeUser(lead.seller),
    paidBy: serializeUser(payment?.paidBy),
  };
}

indicatorPaymentsRouter.get(
  "/",
  requireModuleAccess("FINANCEIRO", "view"),
  validate({ query: listQuerySchema }),
  async (request, response) => {
    const leads = await prisma.lead.findMany({
      where: {
        status: "Ganho",
      },
      include: {
        seller: true,
        indicator: true,
        ticket: true,
        indicatorPayment: {
          include: {
            indicator: true,
            paidBy: true,
          },
        },
      },
      orderBy: [{ wonAt: "desc" }, { createdAt: "desc" }],
    });

    const indicatorIds = [
      ...new Set(
        leads
          .map((lead) => {
            const metadata = parseLeadMetadata(lead.notes);
            return metadata.representativeId || lead.indicatorId || null;
          })
          .filter(Boolean),
      ),
    ];

    const indicators = indicatorIds.length
      ? await prisma.indicator.findMany({
          where: {
            id: {
              in: indicatorIds,
            },
          },
        })
      : [];

    const indicatorMap = new Map(indicators.map((indicator) => [indicator.id, indicator]));

    const normalizedQuery = String(request.query.q || "").trim().toLowerCase();

    const items = leads
      .map((lead) => buildPaymentListItem(lead, lead.indicatorPayment, indicatorMap))
      .filter(Boolean)
      .filter((item) => {
        const matchesStatus = request.query.status ? item.status === request.query.status : true;
        const matchesIndicator = request.query.indicatorId
          ? item.indicatorId === request.query.indicatorId
          : true;
        const matchesQuery = normalizedQuery
          ? [
              item.company,
              item.ticketCode || "",
              item.indicatorName,
              item.seller?.name || "",
            ]
              .join(" ")
              .toLowerCase()
              .includes(normalizedQuery)
          : true;

        return matchesStatus && matchesIndicator && matchesQuery;
      })
      .sort((left, right) => {
        if (left.status !== right.status) {
          return left.status === "pending" ? -1 : 1;
        }

        const leftDate = new Date(left.paidAt || left.dueDate || left.wonAt || 0).getTime();
        const rightDate = new Date(right.paidAt || right.dueDate || right.wonAt || 0).getTime();

        return right.status === "paid" ? rightDate - leftDate : leftDate - rightDate;
      });

    response.json({ items });
  },
);

indicatorPaymentsRouter.patch(
  "/:leadId",
  requireModuleAccess("FINANCEIRO", "edit"),
  validate({
    params: z.object({ leadId: cuidSchema }),
    body: updatePaymentSchema,
  }),
  async (request, response) => {
    const lead = await prisma.lead.findUnique({
      where: { id: request.params.leadId },
      include: {
        indicator: true,
        ticket: true,
        indicatorPayment: true,
      },
    });

    if (!lead) {
      throw new HttpError(404, "Lead não encontrado");
    }

    if (lead.status !== "Ganho") {
      throw new HttpError(422, "Somente leads ganhos podem gerar pagamento de indicador");
    }

    const extraIndicatorId = parseLeadMetadata(lead.notes).representativeId || lead.indicatorId || null;
    const indicator = extraIndicatorId
      ? await prisma.indicator.findUnique({ where: { id: extraIndicatorId } })
      : null;
    const indicatorMap = new Map(indicator ? [[indicator.id, indicator]] : []);
    const resolved = resolveIndicatorForLead(lead, indicatorMap);

    if (!resolved.indicatorId || !resolved.indicator || resolved.amountInCents <= 0) {
      throw new HttpError(422, "Lead sem indicador elegível para pagamento");
    }

    const payload = await prisma.indicatorPayment.upsert({
      where: { leadId: lead.id },
      create: {
        leadId: lead.id,
        indicatorId: resolved.indicatorId,
        indicatorNameSnapshot: resolved.indicator.name,
        leadCompanySnapshot: lead.company,
        amountInCents: resolved.amountInCents,
        status: request.body.status,
        dueDate: request.body.dueDate ? new Date(request.body.dueDate) : resolved.dueDate ? new Date(resolved.dueDate) : null,
        paidAt:
          request.body.status === "paid"
            ? request.body.paidAt
              ? new Date(request.body.paidAt)
              : new Date()
            : null,
        notes: request.body.notes || null,
        paidByUserId: request.body.status === "paid" ? request.auth.userId : null,
      },
      update: {
        indicatorId: resolved.indicatorId,
        indicatorNameSnapshot: resolved.indicator.name,
        leadCompanySnapshot: lead.company,
        amountInCents: resolved.amountInCents,
        status: request.body.status,
        dueDate:
          request.body.dueDate !== undefined
            ? request.body.dueDate
              ? new Date(request.body.dueDate)
              : null
            : lead.indicatorPayment?.dueDate || (resolved.dueDate ? new Date(resolved.dueDate) : null),
        paidAt:
          request.body.status === "paid"
            ? request.body.paidAt
              ? new Date(request.body.paidAt)
              : lead.indicatorPayment?.paidAt || new Date()
            : null,
        notes: request.body.notes !== undefined ? request.body.notes || null : lead.indicatorPayment?.notes || null,
        paidByUserId: request.body.status === "paid" ? request.auth.userId : null,
      },
      include: {
        lead: {
          include: {
            seller: true,
            ticket: true,
          },
        },
        indicator: true,
        paidBy: true,
      },
    });

    await writeAuditLog({
      actorUserId: request.auth.userId,
      action: "INDICATOR_PAYMENT_UPDATE",
      entityType: "IndicatorPayment",
      entityId: payload.id,
      ipAddress: response.locals.ipAddress,
      userAgent: response.locals.userAgent,
      metadata: {
        leadId: lead.id,
        status: payload.status,
        amountInCents: payload.amountInCents,
      },
    });

    response.json({
      item: {
        ...payload,
        amount: fromCents(payload.amountInCents),
        seller: serializeUser(payload.lead?.seller),
        paidBy: serializeUser(payload.paidBy),
        ticketCode: payload.lead?.ticket?.code || null,
        setupAmount: fromCents(payload.lead?.ticket?.setupInCents || 0),
      },
    });
  },
);
