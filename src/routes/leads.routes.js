import { Router } from "express";
import { z } from "zod";

import { writeAuditLog } from "../lib/audit.js";
import { resolveLeadWorkflow } from "../lib/crm-funnels.js";
import { LEAD_TASK_TYPES } from "../lib/constants.js";
import { HttpError } from "../lib/http-error.js";
import { buildLeadMetadataNotes, parseLeadMetadata } from "../lib/lead-metadata.js";
import { toCents } from "../lib/money.js";
import { buildPageMeta, getPagination } from "../lib/pagination.js";
import { hasPricedEnabledCatalogItems } from "../lib/plan-catalog.js";
import { prisma } from "../lib/prisma.js";
import { cuidSchema, paginationSchema } from "../lib/schemas.js";
import { serializeLead } from "../lib/serializers.js";
import { moveEntityToTrash } from "../lib/trash.js";
import { authenticate } from "../middlewares/authenticate.js";
import { requireModuleAccess } from "../middlewares/require-module-access.js";
import { validate } from "../middlewares/validate.js";

export const leadsRouter = Router();

const leadStatusSchema = z.string().trim().min(2).max(120);
const taskTypeSchema = z.enum(LEAD_TASK_TYPES);

const leadTaskInputSchema = z.object({
  title: z.string().trim().min(2).max(160),
  type: taskTypeSchema,
  done: z.boolean().optional(),
  dueDate: z.string().datetime().optional().nullable(),
  notes: z.string().trim().max(1000).optional().nullable(),
});

const leadCommentInputSchema = z.object({
  message: z.string().trim().min(1).max(2000),
});

const leadCatalogItemSchema = z.object({
  catalogItemId: cuidSchema,
  enabled: z.boolean().optional(),
  setupAmount: z.coerce.number().min(0).optional(),
  recurringAmount: z.coerce.number().min(0).optional(),
});

const createLeadSchema = z.object({
  company: z.string().trim().min(2).max(160),
  cnpj: z.string().trim().max(24).optional().nullable(),
  contact: z.string().trim().max(120).optional().nullable(),
  email: z.string().email().optional().nullable(),
  phone: z.string().trim().max(40).optional().nullable(),
  status: leadStatusSchema,
  funnelId: cuidSchema.optional().nullable(),
  stageId: cuidSchema.optional().nullable(),
  value: z.coerce.number().min(0),
  paymentMethod: z.string().trim().max(40).optional().nullable(),
  installment: z.string().trim().max(40).optional().nullable(),
  site: z.string().trim().max(255).optional().nullable(),
  isLite: z.boolean().optional(),
  planId: cuidSchema.optional().nullable(),
  sellerId: cuidSchema.optional().nullable(),
  sdrId: cuidSchema.optional().nullable(),
  originId: cuidSchema.optional().nullable(),
  indicatorId: cuidSchema.optional().nullable(),
  wonAt: z.string().datetime().optional().nullable(),
  lostAt: z.string().datetime().optional().nullable(),
  consultant: z.string().trim().max(120).optional().nullable(),
  validUntil: z.string().trim().max(20).optional().nullable(),
  agents: z.coerce.number().int().min(0).optional(),
  supervisors: z.coerce.number().int().min(0).optional(),
  admins: z.coerce.number().int().min(0).optional(),
  observations: z.string().trim().max(4000).optional().nullable(),
  representativeId: cuidSchema.optional().nullable(),
  representativeCommission: z.coerce.number().min(0).optional(),
  passThroughAmount: z.coerce.number().min(0).optional(),
  lossReason: z.string().trim().max(1000).optional().nullable(),
  tasks: z.array(leadTaskInputSchema).optional(),
  catalogItems: z.array(leadCatalogItemSchema).optional(),
});

const updateLeadSchema = createLeadSchema.partial();

const listLeadsQuerySchema = paginationSchema.extend({
  q: z.string().trim().optional(),
  status: leadStatusSchema.optional(),
  funnelId: cuidSchema.optional(),
  sellerId: cuidSchema.optional(),
  sdrId: cuidSchema.optional(),
  originId: cuidSchema.optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
});

const leadAutofillLookupQuerySchema = z.object({
  cnpj: z.string().trim().min(8).max(24),
});

const leadAutofillSearchQuerySchema = z.object({
  q: z.string().trim().min(2).max(120),
});

const leadInclude = {
  seller: true,
  sdr: true,
  origin: true,
  indicator: true,
  plan: true,
  funnel: true,
  stage: true,
  tasks: {
    orderBy: {
      createdAt: "asc",
    },
  },
  comments: {
    include: {
      author: true,
    },
    orderBy: {
      createdAt: "desc",
    },
  },
  catalogItems: {
    include: {
      catalogItem: true,
    },
    orderBy: {
      createdAt: "asc",
    },
  },
  createdBy: true,
  ticket: true,
};

const leadAutofillTicketInclude = {
  linkedPlan: true,
  lead: {
    include: {
      seller: true,
      sdr: true,
      origin: true,
      indicator: true,
      plan: true,
      catalogItems: {
        include: {
          catalogItem: true,
        },
        orderBy: {
          createdAt: "asc",
        },
      },
    },
  },
};

leadsRouter.use(authenticate);

function sumCatalogItems(items = []) {
  return items.reduce(
    (sum, item) => ({
      setupAmount: sum.setupAmount + (item.enabled === false ? 0 : item.setupAmount || 0),
      recurringAmount:
        sum.recurringAmount + (item.enabled === false ? 0 : item.recurringAmount || 0),
    }),
    { setupAmount: 0, recurringAmount: 0 },
  );
}

function normalizeDocumentDigits(value) {
  return String(value || "").replace(/\D/g, "");
}

function buildCatalogAutofillItems(catalogItems = [], type) {
  return catalogItems
    .filter((item) => item.catalogItem?.type === type)
    .map((item) => ({
      name: item.catalogItem.name,
      enabled: item.enabled !== false,
      setup: item.setupAmount || 0,
      recurring: item.recurringAmount || 0,
    }));
}

function buildAutofillSnapshotFromLead(lead) {
  return {
    source: "lead",
    company: lead.company,
    cnpj: lead.cnpj || null,
    contact: lead.contact || null,
    email: lead.email || null,
    phone: lead.phone || null,
      paymentMethod: lead.paymentMethod || null,
      installment: lead.installment || null,
      site: lead.site || null,
      sellerId: lead.seller?.id || null,
    sdrId: lead.sdr?.id || lead.sdrId || null,
    originId: lead.origin?.id || null,
    consultant: lead.consultant || null,
    validUntil: lead.validUntil || null,
    isLite: lead.isLite ?? false,
    planId: lead.plan?.id || lead.planId || null,
    planName: lead.plan?.name || null,
    agents: lead.agents || 0,
    supervisors: lead.supervisors || 0,
    admins: lead.admins || 0,
    observations: lead.observations || null,
    representativeId: lead.representativeId || null,
    representativeCommission: lead.representativeCommission || 0,
    indicatorId: lead.indicator?.id || null,
    passThroughAmount: lead.passThroughAmount || 0,
    products: buildCatalogAutofillItems(lead.catalogItems, "PRODUCT"),
    integrations: buildCatalogAutofillItems(lead.catalogItems, "INTEGRATION"),
  };
}

function buildAutofillSnapshotFromTicket(ticket) {
  const metadata = parseLeadMetadata(ticket.notes);
  const linkedLead = ticket.lead;
  const linkedPlan = ticket.linkedPlan || linkedLead?.plan || null;

  return {
    source: "ticket",
    company: linkedLead?.company || ticket.company,
    cnpj: linkedLead?.cnpj || ticket.cnpj || null,
    contact: linkedLead?.contact || ticket.contact || null,
    email: linkedLead?.email || ticket.email || null,
    phone: linkedLead?.phone || ticket.phone || null,
      paymentMethod: linkedLead?.paymentMethod || ticket.paymentMethod || null,
      installment: linkedLead?.installment || ticket.installment || metadata.installment || null,
      site: linkedLead?.site || metadata.site || null,
      sellerId: linkedLead?.seller?.id || ticket.assigneeId || null,
    sdrId: linkedLead?.sdr?.id || null,
    originId: linkedLead?.origin?.id || null,
    consultant: linkedLead?.consultant || metadata.consultant || null,
    validUntil: linkedLead?.validUntil || metadata.validUntil || null,
    isLite: linkedLead?.isLite ?? String(linkedPlan?.name || ticket.plan || "").toLowerCase().includes("lite"),
    planId: linkedLead?.plan?.id || linkedPlan?.id || ticket.planId || null,
    planName: linkedLead?.plan?.name || linkedPlan?.name || ticket.plan || null,
    agents: linkedLead?.agents || metadata.agents || linkedPlan?.includedAgents || 0,
    supervisors: linkedLead?.supervisors || metadata.supervisors || linkedPlan?.includedSupervisors || 0,
    admins: linkedLead?.admins || metadata.admins || linkedPlan?.includedAdmins || 0,
    observations: linkedLead?.observations || metadata.observations || ticket.notes || null,
    representativeId: linkedLead?.representativeId || metadata.representativeId || null,
    representativeCommission:
      linkedLead?.representativeCommission || metadata.representativeCommission || 0,
    indicatorId: linkedLead?.indicator?.id || null,
    passThroughAmount: linkedLead?.passThroughAmount || metadata.passThroughAmount || 0,
    products: buildCatalogAutofillItems(linkedLead?.catalogItems, "PRODUCT"),
    integrations: buildCatalogAutofillItems(linkedLead?.catalogItems, "INTEGRATION"),
  };
}

function buildLeadSuggestionPayload(snapshot, extra = {}) {
  return {
    ...snapshot,
    label: snapshot.company || snapshot.cnpj || "Cliente",
    subtitle: extra.subtitle || snapshot.planName || null,
  };
}

async function createOrSyncLeadTicket(tx, lead, actorUserId, catalogItems = []) {
  const totals = sumCatalogItems(catalogItems);
  const assigneeId = lead.sellerId || actorUserId;
  const linkedPlan =
    lead.plan || (lead.planId ? await tx.plan.findUnique({ where: { id: lead.planId } }) : null);
  const planName = linkedPlan?.name || (lead.isLite ? "Lite" : "Profissional");
  const shouldFallbackToPlanTotals =
    Boolean(linkedPlan) && !hasPricedEnabledCatalogItems(catalogItems);
  const resolvedSetupInCents = shouldFallbackToPlanTotals
    ? linkedPlan.setupFeeInCents
    : toCents(totals.setupAmount);
  const resolvedRecurringInCents = shouldFallbackToPlanTotals
    ? linkedPlan.monthlyFeeInCents
    : toCents(totals.recurringAmount);

  if (lead.ticket?.id) {
    return tx.ticket.update({
      where: { id: lead.ticket.id },
      data: {
        company: lead.company,
        cnpj: lead.cnpj,
        contact: lead.contact,
        email: lead.email,
        phone: lead.phone,
        plan: planName,
        planId: lead.planId || null,
        paymentMethod: lead.paymentMethod,
        setupInCents: resolvedSetupInCents,
        recurringInCents: resolvedRecurringInCents,
        assigneeId,
      },
    });
  }

  const code = `COM-${Date.now().toString().slice(-6)}-${Math.random()
    .toString(36)
    .slice(2, 5)
    .toUpperCase()}`;

  return tx.ticket.create({
    data: {
      code,
      leadId: lead.id,
      company: lead.company,
      cnpj: lead.cnpj,
      contact: lead.contact,
      email: lead.email,
      phone: lead.phone,
      plan: planName,
      planId: lead.planId || null,
      paymentMethod: lead.paymentMethod,
      installment: parseLeadMetadata(lead.notes).installment || null,
      type: "novo",
      status: "pendente_financeiro",
      setupInCents: resolvedSetupInCents,
      recurringInCents: resolvedRecurringInCents,
      createdById: actorUserId,
      assigneeId,
    },
  });
}

leadsRouter.get(
  "/",
  requireModuleAccess("COMMERCIAL", "view"),
  validate({ query: listLeadsQuerySchema }),
  async (request, response) => {
    const { page, limit, skip } = getPagination(request.query);
    const where = {
      ...(request.query.q
        ? {
            OR: [
              { company: { contains: request.query.q } },
              { cnpj: { contains: request.query.q } },
              { contact: { contains: request.query.q } },
            ],
          }
        : {}),
      ...(request.query.status ? { status: request.query.status } : {}),
      ...(request.query.funnelId ? { funnelId: request.query.funnelId } : {}),
      ...(request.query.sellerId ? { sellerId: request.query.sellerId } : {}),
      ...(request.query.sdrId ? { sdrId: request.query.sdrId } : {}),
      ...(request.query.originId ? { originId: request.query.originId } : {}),
      ...((request.query.from || request.query.to) && {
        createdAt: {
          ...(request.query.from ? { gte: new Date(request.query.from) } : {}),
          ...(request.query.to ? { lte: new Date(request.query.to) } : {}),
        },
      }),
    };

    const [items, total] = await prisma.$transaction([
      prisma.lead.findMany({
        where,
        include: leadInclude,
        orderBy: { createdAt: "desc" },
        take: limit,
        skip,
      }),
      prisma.lead.count({ where }),
    ]);

    response.json({
      items: items.map(serializeLead),
      meta: buildPageMeta({ page, limit, total }),
    });
  },
);

leadsRouter.get(
  "/lookup/by-cnpj",
  requireModuleAccess("COMMERCIAL", "view"),
  validate({ query: leadAutofillLookupQuerySchema }),
  async (request, response) => {
    const normalizedCnpj = normalizeDocumentDigits(request.query.cnpj);

    if (normalizedCnpj.length !== 14) {
      response.json({ item: null });
      return;
    }

    const [leadMatchRows, ticketMatchRows] = await prisma.$transaction([
      prisma.$queryRaw`
        SELECT "id"
        FROM "Lead"
        WHERE REPLACE(REPLACE(REPLACE(REPLACE(COALESCE("cnpj", ''), '.', ''), '/', ''), '-', ''), ' ', '') = ${normalizedCnpj}
        ORDER BY "updatedAt" DESC
        LIMIT 1
      `,
      prisma.$queryRaw`
        SELECT "id"
        FROM "Ticket"
        WHERE REPLACE(REPLACE(REPLACE(REPLACE(COALESCE("cnpj", ''), '.', ''), '/', ''), '-', ''), ' ', '') = ${normalizedCnpj}
        ORDER BY "updatedAt" DESC
        LIMIT 1
      `,
    ]);

    const leadId = leadMatchRows?.[0]?.id;
    if (leadId) {
      const lead = await prisma.lead.findUnique({
        where: { id: leadId },
        include: leadInclude,
      });

      response.json({
        item: lead ? buildAutofillSnapshotFromLead(serializeLead(lead)) : null,
      });
      return;
    }

    const ticketId = ticketMatchRows?.[0]?.id;
    if (ticketId) {
      const ticket = await prisma.ticket.findUnique({
        where: { id: ticketId },
        include: leadAutofillTicketInclude,
      });

      response.json({
        item: ticket ? buildAutofillSnapshotFromTicket(serializeTicket(ticket)) : null,
      });
      return;
    }

    response.json({ item: null });
  },
);

leadsRouter.get(
  "/lookup/search",
  requireModuleAccess("COMMERCIAL", "view"),
  validate({ query: leadAutofillSearchQuerySchema }),
  async (request, response) => {
    const query = request.query.q.trim();

    const [leadMatches, ticketMatches] = await prisma.$transaction([
      prisma.lead.findMany({
        where: {
          company: {
            contains: query,
          },
        },
        include: leadInclude,
        orderBy: { updatedAt: "desc" },
        take: 5,
      }),
      prisma.ticket.findMany({
        where: {
          OR: [
            {
              company: {
                contains: query,
              },
            },
            {
              instance: {
                contains: query,
              },
            },
          ],
        },
        include: leadAutofillTicketInclude,
        orderBy: { updatedAt: "desc" },
        take: 5,
      }),
    ]);

    const items = [];
    const seenKeys = new Set();

    for (const lead of leadMatches) {
      const snapshot = buildAutofillSnapshotFromLead(serializeLead(lead));
      const key = `${snapshot.source}:${snapshot.company || ""}:${snapshot.cnpj || ""}`;
      if (seenKeys.has(key)) continue;
      seenKeys.add(key);
      items.push(buildLeadSuggestionPayload(snapshot, { subtitle: snapshot.cnpj || null }));
      if (items.length >= 5) break;
    }

    if (items.length < 5) {
      for (const ticket of ticketMatches) {
        const snapshot = buildAutofillSnapshotFromTicket(serializeTicket(ticket));
        const key = `${snapshot.source}:${snapshot.company || ""}:${snapshot.cnpj || ""}:${ticket.instance || ""}`;
        if (seenKeys.has(key)) continue;
        seenKeys.add(key);
        items.push(
          buildLeadSuggestionPayload(snapshot, {
            subtitle: ticket.instance || snapshot.cnpj || null,
          }),
        );
        if (items.length >= 5) break;
      }
    }

    response.json({ items });
  },
);

leadsRouter.get(
  "/:id",
  requireModuleAccess("COMMERCIAL", "view"),
  validate({ params: z.object({ id: cuidSchema }) }),
  async (request, response) => {
    const lead = await prisma.lead.findUnique({
      where: { id: request.params.id },
      include: leadInclude,
    });

    if (!lead) {
      throw new HttpError(404, "Lead não encontrado");
    }

    response.json({ item: serializeLead(lead) });
  },
);

leadsRouter.post(
  "/",
  requireModuleAccess("COMMERCIAL", "edit"),
  validate({ body: createLeadSchema }),
  async (request, response) => {
    const lead = await prisma.$transaction(async (tx) => {
      const workflow = await resolveLeadWorkflow(tx, request.body);
      const createdLead = await tx.lead.create({
        data: {
          company: request.body.company,
          cnpj: request.body.cnpj,
          contact: request.body.contact,
          email: request.body.email,
          phone: request.body.phone,
          status: workflow.status,
          funnelId: workflow.funnelId,
          stageId: workflow.stageId,
          valueInCents: toCents(request.body.value),
          paymentMethod: request.body.paymentMethod,
          isLite: request.body.isLite ?? false,
          planId: request.body.planId,
          notes: buildLeadMetadataNotes(request.body),
          sellerId: request.body.sellerId,
          sdrId: request.body.sdrId,
          originId: request.body.originId,
          indicatorId: request.body.indicatorId,
          wonAt:
            request.body.wonAt || workflow.status === "Ganho"
              ? new Date(request.body.wonAt || new Date().toISOString())
              : null,
          lostAt:
            request.body.lostAt || workflow.status === "Perdido"
              ? new Date(request.body.lostAt || new Date().toISOString())
              : null,
          createdById: request.auth.userId,
          tasks: request.body.tasks?.length
            ? {
                create: request.body.tasks.map((task) => ({
                  title: task.title,
                  type: task.type,
                  done: task.done ?? false,
                  dueDate: task.dueDate ? new Date(task.dueDate) : null,
                  notes: task.notes,
                })),
              }
            : undefined,
          catalogItems: request.body.catalogItems?.length
            ? {
                create: request.body.catalogItems.map((item) => ({
                  catalogItemId: item.catalogItemId,
                  enabled: item.enabled ?? true,
                  setupInCents: toCents(item.setupAmount),
                  recurringInCents: toCents(item.recurringAmount),
                })),
              }
            : undefined,
        },
        include: {
          ...leadInclude,
          ticket: true,
        },
      });

      if (workflow.status === "Ganho") {
        await createOrSyncLeadTicket(tx, createdLead, request.auth.userId, request.body.catalogItems);
      }

      return tx.lead.findUnique({
        where: { id: createdLead.id },
        include: leadInclude,
      });
    });

    await writeAuditLog({
      actorUserId: request.auth.userId,
      action: "LEAD_CREATE",
      entityType: "Lead",
      entityId: lead.id,
      ipAddress: response.locals.ipAddress,
      userAgent: response.locals.userAgent,
    });

    response.status(201).json({ item: serializeLead(lead) });
  },
);

leadsRouter.patch(
  "/:id",
  requireModuleAccess("COMMERCIAL", "edit"),
  validate({
    params: z.object({ id: cuidSchema }),
    body: updateLeadSchema,
  }),
  async (request, response) => {
    const existingLead = await prisma.lead.findUnique({
      where: { id: request.params.id },
      include: {
        ticket: true,
      },
    });

    if (!existingLead) {
      throw new HttpError(404, "Lead não encontrado");
    }

    const currentMetadata = parseLeadMetadata(existingLead.notes);
    const nextMetadata = {
      ...currentMetadata,
      ...Object.fromEntries(
          Object.entries({
            installment: request.body.installment,
            site: request.body.site,
            consultant: request.body.consultant,
            validUntil: request.body.validUntil,
          agents: request.body.agents,
          supervisors: request.body.supervisors,
          admins: request.body.admins,
          observations: request.body.observations,
          representativeId: request.body.representativeId,
          representativeCommission: request.body.representativeCommission,
          passThroughAmount: request.body.passThroughAmount,
          lossReason: request.body.lossReason,
        }).filter(([, value]) => value !== undefined),
      ),
    };
    const nextStatus = request.body.status || existingLead.status;
    const lead = await prisma.$transaction(async (tx) => {
      const workflow =
        "status" in request.body || "funnelId" in request.body || "stageId" in request.body
          ? await resolveLeadWorkflow(tx, {
              status: request.body.status || existingLead.status,
              funnelId:
                "funnelId" in request.body ? request.body.funnelId : existingLead.funnelId,
              stageId: "stageId" in request.body ? request.body.stageId : existingLead.stageId,
            })
          : {
              status: existingLead.status,
              funnelId: existingLead.funnelId,
              stageId: existingLead.stageId,
            };
      const nextStatus = workflow.status;
      const updatedLead = await tx.lead.update({
        where: { id: request.params.id },
        data: {
          ...("company" in request.body ? { company: request.body.company } : {}),
          ...("cnpj" in request.body ? { cnpj: request.body.cnpj } : {}),
          ...("contact" in request.body ? { contact: request.body.contact } : {}),
          ...("email" in request.body ? { email: request.body.email } : {}),
          ...("phone" in request.body ? { phone: request.body.phone } : {}),
          ...(workflow ? { status: workflow.status, funnelId: workflow.funnelId, stageId: workflow.stageId } : {}),
          ...("value" in request.body ? { valueInCents: toCents(request.body.value) } : {}),
          ...("paymentMethod" in request.body
            ? { paymentMethod: request.body.paymentMethod }
            : {}),
          ...("isLite" in request.body ? { isLite: request.body.isLite } : {}),
          ...("planId" in request.body ? { planId: request.body.planId } : {}),
          ...("sellerId" in request.body ? { sellerId: request.body.sellerId } : {}),
          ...("sdrId" in request.body ? { sdrId: request.body.sdrId } : {}),
          ...("originId" in request.body ? { originId: request.body.originId } : {}),
          ...("indicatorId" in request.body ? { indicatorId: request.body.indicatorId } : {}),
          notes: buildLeadMetadataNotes(nextMetadata),
          ...("wonAt" in request.body
            ? { wonAt: request.body.wonAt ? new Date(request.body.wonAt) : null }
            : nextStatus === "Ganho" && !existingLead.wonAt
              ? { wonAt: new Date() }
              : nextStatus !== "Ganho" && existingLead.wonAt
                ? { wonAt: null }
                : {}),
          ...("lostAt" in request.body
            ? { lostAt: request.body.lostAt ? new Date(request.body.lostAt) : null }
            : nextStatus === "Perdido" && !existingLead.lostAt
              ? { lostAt: new Date() }
              : nextStatus !== "Perdido" && existingLead.lostAt
                ? { lostAt: null }
                : {}),
        },
      });

      if (Array.isArray(request.body.tasks)) {
        await tx.leadTask.deleteMany({
          where: { leadId: updatedLead.id },
        });

        if (request.body.tasks.length) {
          await tx.leadTask.createMany({
            data: request.body.tasks.map((task) => ({
              leadId: updatedLead.id,
              title: task.title,
              type: task.type,
              done: task.done ?? false,
              dueDate: task.dueDate ? new Date(task.dueDate) : null,
              notes: task.notes,
            })),
          });
        }
      }

      if (Array.isArray(request.body.catalogItems)) {
        await tx.leadCatalogItem.deleteMany({
          where: { leadId: updatedLead.id },
        });

        if (request.body.catalogItems.length) {
          await tx.leadCatalogItem.createMany({
            data: request.body.catalogItems.map((item) => ({
              leadId: updatedLead.id,
              catalogItemId: item.catalogItemId,
              enabled: item.enabled ?? true,
              setupInCents: toCents(item.setupAmount),
              recurringInCents: toCents(item.recurringAmount),
            })),
          });
        }
      }

      if (workflow.status === "Ganho") {
        await createOrSyncLeadTicket(
          tx,
          { ...updatedLead, ticket: existingLead.ticket, notes: buildLeadMetadataNotes(nextMetadata) },
          request.auth.userId,
          Array.isArray(request.body.catalogItems)
            ? request.body.catalogItems
            : (
                await tx.leadCatalogItem.findMany({
                  where: { leadId: updatedLead.id },
                })
              ).map((item) => ({
                enabled: item.enabled,
                setupAmount: item.setupInCents / 100,
                recurringAmount: item.recurringInCents / 100,
              })),
        );
      }

      return tx.lead.findUnique({
        where: { id: updatedLead.id },
        include: leadInclude,
      });
    });

    await writeAuditLog({
      actorUserId: request.auth.userId,
      action: "LEAD_UPDATE",
      entityType: "Lead",
      entityId: lead.id,
      ipAddress: response.locals.ipAddress,
      userAgent: response.locals.userAgent,
      metadata: request.body,
    });

    response.json({ item: serializeLead(lead) });
  },
);

leadsRouter.delete(
  "/:id",
  requireModuleAccess("COMMERCIAL", "manage"),
  validate({
    params: z.object({ id: cuidSchema }),
  }),
  async (request, response) => {
    const lead = await prisma.lead.findUnique({
      where: { id: request.params.id },
      include: {
        tasks: true,
        comments: true,
        catalogItems: true,
      },
    });

    if (!lead) {
      throw new HttpError(404, "Lead não encontrado");
    }

    await prisma.$transaction(async (tx) => {
      await moveEntityToTrash({
        tx,
        moduleKey: "COMMERCIAL",
        entityType: "Lead",
        entityId: lead.id,
        label: lead.company,
        payload: {
          lead: {
            id: lead.id,
            company: lead.company,
            cnpj: lead.cnpj,
            contact: lead.contact,
            email: lead.email,
            phone: lead.phone,
            status: lead.status,
            valueInCents: lead.valueInCents,
            paymentMethod: lead.paymentMethod,
            isLite: lead.isLite,
            wonAt: lead.wonAt,
            lostAt: lead.lostAt,
            notes: lead.notes,
            sellerId: lead.sellerId,
            sdrId: lead.sdrId,
            originId: lead.originId,
            indicatorId: lead.indicatorId,
            createdById: lead.createdById,
            createdAt: lead.createdAt,
            updatedAt: lead.updatedAt,
          },
          tasks: lead.tasks.map((task) => ({
            id: task.id,
            title: task.title,
            type: task.type,
            done: task.done,
            dueDate: task.dueDate,
            notes: task.notes,
            createdAt: task.createdAt,
            updatedAt: task.updatedAt,
          })),
          comments: lead.comments.map((comment) => ({
            id: comment.id,
            authorUserId: comment.authorUserId,
            message: comment.message,
            createdAt: comment.createdAt,
          })),
          catalogItems: lead.catalogItems.map((item) => ({
            id: item.id,
            catalogItemId: item.catalogItemId,
            enabled: item.enabled,
            setupInCents: item.setupInCents,
            recurringInCents: item.recurringInCents,
            createdAt: item.createdAt,
            updatedAt: item.updatedAt,
          })),
        },
        deletedById: request.auth.userId,
      });

      await tx.lead.delete({
        where: { id: lead.id },
      });
    });

    response.status(204).send();
  },
);

leadsRouter.post(
  "/:id/tasks",
  requireModuleAccess("COMMERCIAL", "edit"),
  validate({
    params: z.object({ id: cuidSchema }),
    body: leadTaskInputSchema,
  }),
  async (request, response) => {
    const lead = await prisma.lead.findUnique({
      where: { id: request.params.id },
    });

    if (!lead) {
      throw new HttpError(404, "Lead não encontrado");
    }

    const task = await prisma.leadTask.create({
      data: {
        leadId: lead.id,
        title: request.body.title,
        type: request.body.type,
        done: request.body.done ?? false,
        dueDate: request.body.dueDate ? new Date(request.body.dueDate) : null,
        notes: request.body.notes,
      },
    });

    await writeAuditLog({
      actorUserId: request.auth.userId,
      action: "LEAD_TASK_CREATE",
      entityType: "LeadTask",
      entityId: task.id,
      ipAddress: response.locals.ipAddress,
      userAgent: response.locals.userAgent,
      metadata: { leadId: lead.id },
    });

    response.status(201).json({ item: task });
  },
);

leadsRouter.post(
  "/:id/comments",
  requireModuleAccess("COMMERCIAL", "edit"),
  validate({
    params: z.object({ id: cuidSchema }),
    body: leadCommentInputSchema,
  }),
  async (request, response) => {
    const lead = await prisma.lead.findUnique({
      where: { id: request.params.id },
    });

    if (!lead) {
      throw new HttpError(404, "Lead não encontrado");
    }

    const comment = await prisma.leadComment.create({
      data: {
        leadId: lead.id,
        authorUserId: request.auth.userId,
        message: request.body.message,
      },
      include: {
        author: true,
      },
    });

    await writeAuditLog({
      actorUserId: request.auth.userId,
      action: "LEAD_COMMENT_CREATE",
      entityType: "LeadComment",
      entityId: comment.id,
      ipAddress: response.locals.ipAddress,
      userAgent: response.locals.userAgent,
      metadata: { leadId: lead.id },
    });

    response.status(201).json({
      item: {
        ...comment,
        author: comment.author
          ? {
              id: comment.author.id,
              name: comment.author.name,
              email: comment.author.email,
            }
          : null,
      },
    });
  },
);
