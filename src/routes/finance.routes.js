import { Router } from "express";
import { z } from "zod";

import { prisma } from "../lib/prisma.js";
import { requireModuleAccess } from "../middlewares/require-module-access.js";
import { authenticate } from "../middlewares/authenticate.js";
import { validate } from "../middlewares/validate.js";
import { HttpError } from "../lib/http-error.js";

export const financeRouter = Router();

financeRouter.use(authenticate);

const contractStatusSchema = z.enum([
  "pendente_financeiro",
  "pagamento_confirmado",
  "em_implantacao",
  "concluido",
  "cancelado",
]);

const contractQuerySchema = z.object({
  status: contractStatusSchema.optional(),
  q: z.string().trim().optional(),
});

const cashFlowAccountSchema = z.object({
  nome: z.string(),
  saldoInicial: z.number().nullable(),
  chequeEspecial: z.number().nullable(),
  saldoFinal: z.number().nullable(),
});

const cashFlowDaySchema = z.object({
  data: z.string(),
  semana: z.string(),
  receita: z.number(),
  despesa: z.number(),
  saldoDiario: z.number().nullable(),
});

const inadimplenciaBucketSchema = z.object({
  label: z.string(),
  valor: z.number(),
  pct: z.number(),
});

const cashFlowSummarySchema = z.object({
  referencia: z.string().nullable(),
  contas: z.array(cashFlowAccountSchema),
  saldoInicial: z.number(),
  totalDespesas: z.number(),
  subTotal1: z.number(),
  chequeEspecialTotal: z.number(),
  saldoFinalGeral: z.number(),
  aplicacao: z.number(),
  dias: z.array(cashFlowDaySchema),
  inadimplencia: z.object({
    buckets: z.array(inadimplenciaBucketSchema),
    total: z.number(),
    receitaRecorrente: z.number(),
    pctRecorrente: z.number(),
  }),
  fluxoRealizado: z.object({
    receita: z.number(),
    despesa: z.number(),
  }),
  fluxoPendente: z.object({
    receita: z.number(),
    despesa: z.number(),
  }),
  saldoBancos: z.number(),
  _computed: z.boolean().optional(),
});

const ledgerExpenseRowSchema = z.object({
  fornecedor: z.string(),
  vencimento: z.string(),
  _vencRaw: z.string().nullable(),
  situacao: z.string(),
  valor: z.number(),
  emAberto: z.number(),
  pago: z.number(),
  categoria: z.string(),
  centroCusto: z.string(),
  conta: z.string(),
});

const ledgerRevenueRowSchema = z.object({
  cliente: z.string(),
  vencimento: z.string(),
  _vencRaw: z.string().nullable(),
  situacao: z.string(),
  valor: z.number(),
  emAberto: z.number(),
  recebido: z.number(),
  categoria: z.string(),
  centroCusto: z.string(),
  conta: z.string(),
  obs: z.string(),
});

const upsertCashFlowSchema = z.object({
  caixa: cashFlowSummarySchema.nullable(),
  despesas: z.array(ledgerExpenseRowSchema),
  receitas: z.array(ledgerRevenueRowSchema),
  atrasadas: z.array(ledgerRevenueRowSchema),
  importedAt: z.string().datetime().nullable().optional(),
});

function parseJsonField(value, fallback) {
  if (!value) return fallback;

  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function serializeCashFlowSnapshot(snapshot) {
  if (!snapshot) {
    return {
      caixa: null,
      despesas: [],
      receitas: [],
      atrasadas: [],
      importedAt: null,
    };
  }

  return {
    caixa: parseJsonField(snapshot.caixaJson, null),
    despesas: parseJsonField(snapshot.expensesJson, []),
    receitas: parseJsonField(snapshot.revenuesJson, []),
    atrasadas: parseJsonField(snapshot.overdueJson, []),
    importedAt: snapshot.importedAt,
  };
}

function serializeContractTicket(ticket) {
  return {
    id: ticket.id,
    code: ticket.code,
    leadId: ticket.leadId,
    company: ticket.company,
    cnpj: ticket.cnpj,
    contact: ticket.contact,
    email: ticket.email,
    phone: ticket.phone,
    instance: ticket.instance,
    plan: ticket.plan,
    planId: ticket.planId || null,
    paymentMethod: ticket.paymentMethod,
    installment: ticket.installment,
    type: ticket.type,
    status: ticket.status,
    createdAt: ticket.createdAt,
    updatedAt: ticket.updatedAt,
    setupAmount: ticket.setupInCents / 100,
    recurringAmount: ticket.recurringInCents / 100,
    assignee: ticket.assignee
      ? {
          id: ticket.assignee.id,
          name: ticket.assignee.name,
          sector: ticket.assignee.sector,
        }
      : null,
    lead: ticket.lead
      ? {
          id: ticket.lead.id,
          company: ticket.lead.company,
          cnpj: ticket.lead.cnpj,
          contact: ticket.lead.contact,
          seller: ticket.lead.seller
            ? {
                id: ticket.lead.seller.id,
                name: ticket.lead.seller.name,
                sector: ticket.lead.seller.sector,
              }
            : null,
        }
      : null,
    comments:
      ticket.comments?.map((comment) => ({
        id: comment.id,
        message: comment.message,
        createdAt: comment.createdAt,
        author: comment.author
          ? {
              id: comment.author.id,
              name: comment.author.name,
            }
          : null,
      })) || [],
    attachments:
      ticket.attachments?.map((attachment) => ({
        id: attachment.id,
        fileName: attachment.fileName,
        mimeType: attachment.mimeType,
        sizeInBytes: attachment.sizeInBytes,
        createdAt: attachment.createdAt,
        uploadedBy: attachment.uploadedBy
          ? {
              id: attachment.uploadedBy.id,
              name: attachment.uploadedBy.name,
            }
          : null,
      })) || [],
  };
}

financeRouter.get(
  "/contracts",
  requireModuleAccess("FINANCEIRO", "view"),
  validate({ query: contractQuerySchema }),
  async (request, response) => {
    const normalizedQuery = String(request.query.q || "").trim();
    const items = await prisma.ticket.findMany({
      where: {
        ...(request.query.status ? { status: request.query.status } : {}),
        ...(normalizedQuery
          ? {
              OR: [
                { code: { contains: normalizedQuery } },
                { company: { contains: normalizedQuery } },
                { cnpj: { contains: normalizedQuery } },
                { contact: { contains: normalizedQuery } },
              ],
            }
          : {}),
      },
      include: {
        assignee: true,
        comments: {
          include: {
            author: true,
          },
          orderBy: {
            createdAt: "desc",
          },
        },
        attachments: {
          include: {
            uploadedBy: true,
          },
          orderBy: {
            createdAt: "desc",
          },
        },
        lead: {
          include: {
            seller: true,
          },
        },
      },
      orderBy: [{ createdAt: "desc" }],
    });

    response.json({ items: items.map(serializeContractTicket) });
  },
);

financeRouter.patch(
  "/contracts/:ticketId/confirm",
  requireModuleAccess("FINANCEIRO", "edit"),
  validate({
    params: z.object({
      ticketId: z.string().trim().min(1),
    }),
  }),
  async (request, response) => {
    const existing = await prisma.ticket.findUnique({
      where: { id: request.params.ticketId },
      include: {
        assignee: true,
        comments: {
          include: {
            author: true,
          },
          orderBy: {
            createdAt: "desc",
          },
        },
        attachments: {
          include: {
            uploadedBy: true,
          },
          orderBy: {
            createdAt: "desc",
          },
        },
        lead: {
          include: {
            seller: true,
          },
        },
      },
    });

    if (!existing) {
      throw new HttpError(404, "Ticket não encontrado");
    }

    const ticket = await prisma.ticket.update({
      where: { id: existing.id },
      data: {
        status: "pagamento_confirmado",
      },
      include: {
        assignee: true,
        comments: {
          include: {
            author: true,
          },
          orderBy: {
            createdAt: "desc",
          },
        },
        attachments: {
          include: {
            uploadedBy: true,
          },
          orderBy: {
            createdAt: "desc",
          },
        },
        lead: {
          include: {
            seller: true,
          },
        },
      },
    });

    response.json({ item: serializeContractTicket(ticket) });
  },
);

financeRouter.get(
  "/cash-flow",
  requireModuleAccess("FINANCEIRO", "view"),
  async (_request, response) => {
    const snapshot = await prisma.financeFlowSnapshot.findFirst({
      orderBy: [{ importedAt: "desc" }, { createdAt: "desc" }],
    });

    response.json({ item: serializeCashFlowSnapshot(snapshot) });
  },
);

financeRouter.put(
  "/cash-flow",
  requireModuleAccess("FINANCEIRO", "edit"),
  validate({ body: upsertCashFlowSchema }),
  async (request, response) => {
    const current = await prisma.financeFlowSnapshot.findFirst({
      orderBy: [{ importedAt: "desc" }, { createdAt: "desc" }],
    });

    const payload = {
      referenceDate: request.body.caixa?.referencia ? new Date(request.body.caixa.referencia) : null,
      importedAt: request.body.importedAt ? new Date(request.body.importedAt) : new Date(),
      caixaJson: request.body.caixa ? JSON.stringify(request.body.caixa) : null,
      expensesJson: JSON.stringify(request.body.despesas || []),
      revenuesJson: JSON.stringify(request.body.receitas || []),
      overdueJson: JSON.stringify(request.body.atrasadas || []),
    };

    const snapshot = current
      ? await prisma.financeFlowSnapshot.update({
          where: { id: current.id },
          data: payload,
        })
      : await prisma.financeFlowSnapshot.create({
          data: payload,
        });

    response.json({ item: serializeCashFlowSnapshot(snapshot) });
  },
);

financeRouter.delete(
  "/cash-flow",
  requireModuleAccess("FINANCEIRO", "edit"),
  async (_request, response) => {
    await prisma.financeFlowSnapshot.deleteMany();
    response.status(204).send();
  },
);
