import { Prisma } from '@prisma/client';
import { Router } from 'express';
import { z } from 'zod';

import { writeAuditLog } from '../lib/audit.js';
import { parseImportedClientsFile } from '../lib/client-import.js';
import { TICKET_STATUSES, TICKET_TYPES } from '../lib/constants.js';
import { HttpError } from '../lib/http-error.js';
import {
  buildLeadMetadataNotes,
  parseLeadMetadata,
} from '../lib/lead-metadata.js';
import { toCents } from '../lib/money.js';
import { hasPricedEnabledCatalogItems } from '../lib/plan-catalog.js';
import { buildPageMeta, getPagination } from '../lib/pagination.js';
import { prisma } from '../lib/prisma.js';
import {
  cuidSchema,
  instanceDomainSchema,
  paginationSchema,
} from '../lib/schemas.js';
import { serializeLead, serializeTicket } from '../lib/serializers.js';
import { moveEntityToTrash } from '../lib/trash.js';
import { authenticate } from '../middlewares/authenticate.js';
import { requireModuleAccess } from '../middlewares/require-module-access.js';
import { validate } from '../middlewares/validate.js';

export const ticketsRouter = Router();

const ticketStatusSchema = z.enum(TICKET_STATUSES);
const ticketTypeSchema = z.enum(TICKET_TYPES);

const ticketTaskSchema = z.object({
  assigneeId: cuidSchema.optional().nullable(),
  title: z.string().trim().min(2).max(160),
  done: z.boolean().optional(),
  dueDate: z.string().datetime().optional().nullable(),
});

const ticketCommentSchema = z.object({
  message: z.string().trim().min(1).max(2000),
});

const ticketAttachmentInputSchema = z.object({
  fileName: z.string().trim().min(1).max(255),
  mimeType: z.string().trim().min(1).max(120),
  sizeInBytes: z.coerce.number().int().min(1).max(25 * 1024 * 1024),
  contentBase64: z.string().trim().min(10).max(25 * 1024 * 1024),
});

const ticketAttachmentBatchSchema = z.object({
  files: z.array(ticketAttachmentInputSchema).min(1).max(10),
});

const importClientsSchema = z.object({
  fileName: z.string().trim().min(3).max(255),
  contentBase64: z.string().trim().min(10),
});

const leadTaskInputSchema = z.object({
  title: z.string().trim().min(2).max(160),
  type: z.string().trim().min(2).max(40),
  done: z.boolean().optional(),
  dueDate: z.string().datetime().optional().nullable(),
  notes: z.string().trim().max(1000).optional().nullable(),
});

const leadCatalogItemSchema = z.object({
  catalogItemId: cuidSchema,
  enabled: z.boolean().optional(),
  setupAmount: z.coerce.number().min(0).optional(),
  recurringAmount: z.coerce.number().min(0).optional(),
});

const createTicketSchema = z.object({
  code: z.string().trim().min(4).max(40),
  leadId: cuidSchema.optional().nullable(),
  company: z.string().trim().min(2).max(160),
  cnpj: z.string().trim().max(24).optional().nullable(),
  contact: z.string().trim().max(120).optional().nullable(),
  email: z.string().email().optional().nullable(),
  phone: z.string().trim().max(40).optional().nullable(),
  site: z.string().trim().max(255).optional().nullable(),
  instance: instanceDomainSchema.optional().nullable(),
  plan: z.string().trim().max(80).optional().nullable(),
  planId: cuidSchema.optional().nullable(),
  paymentMethod: z.string().trim().max(40).optional().nullable(),
  installment: z.string().trim().max(40).optional().nullable(),
  type: ticketTypeSchema,
  status: ticketStatusSchema,
  csStatus: z.string().trim().max(80).optional().nullable(),
  notes: z.string().trim().max(4000).optional().nullable(),
  cancelReason: z.string().trim().max(1000).optional().nullable(),
  setupAmount: z.coerce.number().min(0),
  recurringAmount: z.coerce.number().min(0),
  assigneeId: cuidSchema,
  technicalAssigneeId: cuidSchema.optional().nullable(),
  completedAt: z.string().datetime().optional().nullable(),
  tasks: z.array(ticketTaskSchema).optional(),
});

const updateTicketSchema = createTicketSchema.partial();

function onlyDigits(value) {
  return String(value || '').replace(/\D/g, '');
}

function sumCatalogItems(items = []) {
  return items.reduce(
    (sum, item) => ({
      setupAmount:
        sum.setupAmount + (item.enabled === false ? 0 : item.setupAmount || 0),
      recurringAmount:
        sum.recurringAmount +
        (item.enabled === false ? 0 : item.recurringAmount || 0),
    }),
    { setupAmount: 0, recurringAmount: 0 },
  );
}

function resolveTicketAmountsInCents(ticket) {
  const setupInCents = ticket.setupInCents || 0;
  const recurringInCents = ticket.recurringInCents || 0;
  const hasExplicitCatalogPrices = hasPricedEnabledCatalogItems(ticket.lead?.catalogItems || []);

  if (setupInCents > 0 || recurringInCents > 0 || hasExplicitCatalogPrices) {
    return {
      setupInCents,
      recurringInCents,
    };
  }

  return {
    setupInCents: ticket.linkedPlan?.setupFeeInCents || 0,
    recurringInCents: ticket.linkedPlan?.monthlyFeeInCents || 0,
  };
}

const listTicketsQuerySchema = paginationSchema.extend({
  q: z.string().trim().optional(),
  status: ticketStatusSchema.optional(),
  type: ticketTypeSchema.optional(),
  assigneeId: cuidSchema.optional(),
  technicalAssigneeId: cuidSchema.optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
});

const ticketInclude = {
  createdBy: true,
  assignee: true,
  technicalAssignee: true,
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
          createdAt: 'asc',
        },
      },
      comments: {
        include: {
          author: true,
        },
        orderBy: {
          createdAt: 'desc',
        },
      },
      tasks: {
        orderBy: {
          createdAt: 'asc',
        },
      },
    },
  },
  tasks: {
    include: {
      assignee: true,
    },
    orderBy: {
      createdAt: 'asc',
    },
  },
  comments: {
    include: {
      author: true,
    },
    orderBy: {
      createdAt: 'desc',
    },
  },
  attachments: {
    include: {
      uploadedBy: true,
    },
    orderBy: {
      createdAt: 'desc',
    },
  },
};

function buildClosedClientsWhereSql(query) {
  const clauses = [];

  if (query.q) {
    const likeValue = `%${query.q}%`;
    const normalizedDigits = onlyDigits(query.q);
    const normalizedCnpjSql = Prisma.sql`REPLACE(REPLACE(REPLACE(REPLACE(COALESCE("cnpj", ''), '.', ''), '/', ''), '-', ''), ' ', '')`;
    clauses.push(
      normalizedDigits
        ? Prisma.sql`("code" LIKE ${likeValue} OR "company" LIKE ${likeValue} OR "cnpj" LIKE ${likeValue} OR ${normalizedCnpjSql} LIKE ${`%${normalizedDigits}%`})`
        : Prisma.sql`("code" LIKE ${likeValue} OR "company" LIKE ${likeValue} OR "cnpj" LIKE ${likeValue})`,
    );
  }

  if (query.status) {
    clauses.push(Prisma.sql`"status" = ${query.status}`);
  }

  if (query.type) {
    clauses.push(Prisma.sql`"type" = ${query.type}`);
  }

  if (query.assigneeId) {
    clauses.push(Prisma.sql`"assigneeId" = ${query.assigneeId}`);
  }

  if (query.technicalAssigneeId) {
    clauses.push(Prisma.sql`"technicalAssigneeId" = ${query.technicalAssigneeId}`);
  }

  if (query.from) {
    clauses.push(Prisma.sql`"createdAt" >= ${new Date(query.from)}`);
  }

  if (query.to) {
    clauses.push(Prisma.sql`"createdAt" <= ${new Date(query.to)}`);
  }

  if (!clauses.length) {
    return Prisma.empty;
  }

  const combinedClauses = clauses.reduce((current, clause, index) => {
    if (index === 0) {
      return clause;
    }

    return Prisma.sql`${current} AND ${clause}`;
  }, Prisma.empty);

  return Prisma.sql`WHERE ${combinedClauses}`;
}

function buildClientHistoryWhere(ticket) {
  const cnpj = ticket.cnpj || null;
  const company = ticket.company || null;

  if (cnpj) {
    return {
      OR: [{ cnpj }, { lead: { cnpj } }],
    };
  }

  if (company) {
    return {
      OR: [{ company }, { lead: { company } }],
    };
  }

  return { id: ticket.id };
}

function buildDevHistoryWhere(ticket) {
  const cnpj = ticket.cnpj || null;
  const company = ticket.company || null;

  if (cnpj) {
    return {
      OR: [{ cnpj }, { clientName: company || undefined }].filter(Boolean),
    };
  }

  if (company) {
    return {
      clientName: company,
    };
  }

  return null;
}

function serializeClientDevTicket(ticket) {
  return {
    id: ticket.id,
    proto: ticket.proto,
    title: ticket.title,
    category: ticket.category,
    devType: ticket.devType,
    devStatus: ticket.devStatus,
    complexity: ticket.complexity,
    score: ticket.score,
    totalPts: ticket.totalPts,
    clientName: ticket.clientName,
    instance: ticket.instance,
    cnpj: ticket.cnpj,
    createdAt: ticket.createdAt,
    deadline: ticket.deadline,
    resolvedAt: ticket.resolvedAt,
    assignee: ticket.assignee
      ? {
          id: ticket.assignee.id,
          name: ticket.assignee.name,
        }
      : null,
    sprint: ticket.sprint
      ? {
          id: ticket.sprint.id,
          name: ticket.sprint.name,
        }
      : null,
  };
}

function collectClientInstances(ticket, relatedTickets = [], lead = null) {
  const values = [
    ticket.instance,
    ...relatedTickets.map((item) => item.instance),
  ]
    .map((value) => value?.trim())
    .filter(Boolean);

  const uniqueValues = [...new Set(values)];

  return {
    primaryInstance: uniqueValues[0] || null,
    instances: uniqueValues,
  };
}

ticketsRouter.use(authenticate);

ticketsRouter.get(
  '/closed-clients',
  requireModuleAccess('CLIENTES', 'view'),
  validate({ query: listTicketsQuerySchema }),
  async (request, response) => {
    const { page, limit, skip } = getPagination(request.query);
    const normalizedQueryDigits = onlyDigits(request.query.q);
    const where = {
      ...(request.query.q
        ? {
            OR: [
              { code: { contains: request.query.q } },
              { company: { contains: request.query.q } },
              { cnpj: { contains: request.query.q } },
              ...(normalizedQueryDigits ? [{ cnpj: { contains: normalizedQueryDigits } }] : []),
            ],
          }
        : {}),
      ...(request.query.status ? { status: request.query.status } : {}),
      ...(request.query.type ? { type: request.query.type } : {}),
      ...(request.query.assigneeId
        ? { assigneeId: request.query.assigneeId }
        : {}),
      ...(request.query.technicalAssigneeId
        ? { technicalAssigneeId: request.query.technicalAssigneeId }
        : {}),
      ...((request.query.from || request.query.to) && {
        createdAt: {
          ...(request.query.from ? { gte: new Date(request.query.from) } : {}),
          ...(request.query.to ? { lte: new Date(request.query.to) } : {}),
        },
      }),
    };

    const whereSql = buildClosedClientsWhereSql(request.query);

    const [orderedRows, totalRows] = await prisma.$transaction([
      prisma.$queryRaw`
        SELECT "id"
        FROM "Ticket"
        ${whereSql}
        ORDER BY
          CASE WHEN "status" = 'concluido' THEN 0 ELSE 1 END ASC,
          "company" COLLATE NOCASE ASC,
          "createdAt" DESC
        LIMIT ${limit}
        OFFSET ${skip}
      `,
      prisma.$queryRaw`
        SELECT COUNT(*) as "total"
        FROM "Ticket"
        ${whereSql}
      `,
    ]);
    const total = Number(totalRows?.[0]?.total || 0);

    const orderedIds = orderedRows.map((row) => row.id);
    const items =
      orderedIds.length > 0
        ? await prisma.ticket.findMany({
            where: { id: { in: orderedIds } },
            include: ticketInclude,
          })
        : [];
    const itemMap = new Map(items.map((item) => [item.id, item]));
    const orderedItems = orderedIds.map((id) => itemMap.get(id)).filter(Boolean);

    response.json({
      items: orderedItems.map(serializeTicket),
      meta: buildPageMeta({ page, limit, total }),
    });
  },
);

ticketsRouter.post(
  '/closed-clients/import',
  requireModuleAccess('CLIENTES', 'manage'),
  validate({ body: importClientsSchema }),
  async (request, response) => {
    const fileBuffer = Buffer.from(request.body.contentBase64, 'base64');
    const importedRecords = await parseImportedClientsFile({
      fileName: request.body.fileName,
      fileBuffer,
    });

    if (!importedRecords.length) {
      throw new HttpError(400, 'O arquivo enviado não possui registros válidos para importar.');
    }

    const [users, plans, existingTickets] = await Promise.all([
      prisma.user.findMany({
        select: {
          id: true,
          name: true,
          isActive: true,
        },
      }),
      prisma.plan.findMany({
        select: {
          id: true,
          name: true,
        },
      }),
      prisma.ticket.findMany({
        where: {
          code: {
            in: importedRecords.map((record) => record.code),
          },
        },
        select: {
          id: true,
          code: true,
          company: true,
          cnpj: true,
          instance: true,
          plan: true,
          planId: true,
          type: true,
          status: true,
          setupInCents: true,
          recurringInCents: true,
          createdById: true,
          assigneeId: true,
          technicalAssigneeId: true,
        },
      }),
    ]);

    const existingByCode = new Map(existingTickets.map((ticket) => [ticket.code, ticket]));
    const fallbackUser =
      users.find((user) => user.id === request.auth.userId) ||
      users.find((user) => user.name === 'Gabriel Admin') ||
      users.find((user) => user.isActive) ||
      users[0];

    if (!fallbackUser) {
      throw new HttpError(400, 'Nenhum usuário disponível para vincular a importação.');
    }

    let created = 0;
    let updated = 0;
    let unchanged = 0;
    const createRows = [];
    const updateOperations = [];

    for (const record of importedRecords) {
      const assignee =
        users.find((user) => user.name === record.assigneeName && user.isActive) ||
        users.find((user) => user.name === record.assigneeName) ||
        fallbackUser;
      const linkedPlan =
        plans.find((plan) => plan.name === record.plan) ||
        plans.find(
          (plan) =>
            plan.name.toLowerCase() === String(record.plan || '').trim().toLowerCase(),
        ) ||
        null;

      const nextData = {
        company: record.company,
        cnpj: record.cnpj || null,
        instance: record.instance || null,
        plan: record.plan || null,
        planId: linkedPlan?.id || null,
        type: 'novo',
        status: record.status,
        setupInCents: 0,
        recurringInCents: toCents(record.monthlyCost || 0),
        createdById: fallbackUser.id,
        assigneeId: assignee.id,
        technicalAssigneeId: null,
        completedAt: record.status === 'concluido' ? new Date() : null,
        canceledAt: record.status === 'cancelado' ? new Date() : null,
      };

      const existing = existingByCode.get(record.code);

      if (!existing) {
        createRows.push({
          code: record.code,
          ...nextData,
        });
        created += 1;
        continue;
      }

      const hasChanges =
        existing.company !== nextData.company ||
        (existing.cnpj || null) !== nextData.cnpj ||
        (existing.instance || null) !== nextData.instance ||
        (existing.plan || null) !== nextData.plan ||
        (existing.planId || null) !== nextData.planId ||
        existing.type !== nextData.type ||
        existing.status !== nextData.status ||
        existing.setupInCents !== nextData.setupInCents ||
        existing.recurringInCents !== nextData.recurringInCents ||
        existing.createdById !== nextData.createdById ||
        existing.assigneeId !== nextData.assigneeId ||
        (existing.technicalAssigneeId || null) !== nextData.technicalAssigneeId;

      if (!hasChanges) {
        unchanged += 1;
        continue;
      }

      updateOperations.push({
        id: existing.id,
        data: nextData,
      });
      updated += 1;
    }

    for (let index = 0; index < createRows.length; index += 200) {
      const chunk = createRows.slice(index, index + 200);
      if (!chunk.length) continue;
      await prisma.ticket.createMany({
        data: chunk,
        skipDuplicates: true,
      });
    }

    for (let index = 0; index < updateOperations.length; index += 50) {
      const chunk = updateOperations.slice(index, index + 50);
      await prisma.$transaction(
        chunk.map((operation) =>
          prisma.ticket.update({
            where: { id: operation.id },
            data: operation.data,
          }),
        ),
      );
    }

    await writeAuditLog({
      actorUserId: request.auth.userId,
      action: 'COMMERCIAL_CLIENT_IMPORT',
      entityType: 'Ticket',
      entityId: null,
      ipAddress: response.locals.ipAddress,
      userAgent: response.locals.userAgent,
      metadata: {
        fileName: request.body.fileName,
        processed: importedRecords.length,
        created,
        updated,
        unchanged,
      },
    });

    response.status(201).json({
      meta: {
        processed: importedRecords.length,
        created,
        updated,
        unchanged,
      },
    });
  },
);

ticketsRouter.get(
  '/closed-clients/:id',
  requireModuleAccess('CLIENTES', 'view'),
  validate({ params: z.object({ id: cuidSchema }) }),
  async (request, response) => {
    const ticket = await prisma.ticket.findUnique({
      where: { id: request.params.id },
      include: ticketInclude,
    });

    if (!ticket) {
      throw new HttpError(404, 'Ticket não encontrado');
    }

    response.json({ item: serializeTicket(ticket) });
  },
);

ticketsRouter.get(
  '/closed-clients/:id/details',
  requireModuleAccess('CLIENTES', 'view'),
  validate({ params: z.object({ id: cuidSchema }) }),
  async (request, response) => {
    const ticket = await prisma.ticket.findUnique({
      where: { id: request.params.id },
      include: ticketInclude,
    });

    if (!ticket) {
      throw new HttpError(404, 'Ticket não encontrado');
    }

    const historyWhere = buildClientHistoryWhere(ticket);
    const devHistoryWhere = buildDevHistoryWhere(ticket);

    const [relatedTickets, devTickets, leadWithExtras] = await Promise.all([
      prisma.ticket.findMany({
        where: historyWhere,
        include: ticketInclude,
        orderBy: { createdAt: 'desc' },
      }),
      devHistoryWhere
        ? prisma.devTicket.findMany({
            where: devHistoryWhere,
            include: {
              assignee: {
                select: {
                  id: true,
                  name: true,
                },
              },
              sprint: {
                select: {
                  id: true,
                  name: true,
                },
              },
            },
            orderBy: { createdAt: 'desc' },
          })
        : Promise.resolve([]),
      ticket.leadId
        ? prisma.lead.findUnique({
            where: { id: ticket.leadId },
            include: {
              seller: true,
              sdr: true,
              origin: true,
              indicator: true,
              plan: true,
              indicatorPayment: {
                include: {
                  paidBy: true,
                },
              },
              catalogItems: {
                include: {
                  catalogItem: true,
                },
                orderBy: {
                  createdAt: 'asc',
                },
              },
              comments: {
                include: {
                  author: true,
                },
                orderBy: {
                  createdAt: 'desc',
                },
              },
              tasks: {
                orderBy: {
                  createdAt: 'asc',
                },
              },
            },
          })
        : Promise.resolve(null),
    ]);

    const instanceData = collectClientInstances(
      ticket,
      relatedTickets,
      leadWithExtras,
    );

    response.json({
      item: {
        anchorTicket: serializeTicket(ticket),
        lead: leadWithExtras ? serializeLead(leadWithExtras) : null,
        relatedTickets: relatedTickets.map(serializeTicket),
        developmentTickets: devTickets.map(serializeClientDevTicket),
        instance: instanceData,
        summary: {
          totalTickets: relatedTickets.length,
          totalDevTickets: devTickets.length,
          totalSetupAmount: relatedTickets.reduce(
            (sum, item) => sum + resolveTicketAmountsInCents(item).setupInCents,
            0,
          ),
          totalRecurringAmount: relatedTickets.reduce(
            (sum, item) => sum + resolveTicketAmountsInCents(item).recurringInCents,
            0,
          ),
        },
      },
    });
  },
);

ticketsRouter.patch(
  '/closed-clients/:id',
  requireModuleAccess('CLIENTES', 'edit'),
  validate({
    params: z.object({ id: cuidSchema }),
    body: updateTicketSchema
      .pick({
        status: true,
        csStatus: true,
        notes: true,
        assigneeId: true,
        technicalAssigneeId: true,
        company: true,
        cnpj: true,
        contact: true,
        email: true,
        phone: true,
        instance: true,
          plan: true,
          planId: true,
          paymentMethod: true,
          installment: true,
          tasks: true,
        })
        .extend({
          leadTasks: z.array(leadTaskInputSchema).optional(),
          catalogItems: z.array(leadCatalogItemSchema).optional(),
          sellerId: cuidSchema.optional().nullable(),
          sdrId: cuidSchema.optional().nullable(),
          originId: cuidSchema.optional().nullable(),
          indicatorId: cuidSchema.optional().nullable(),
          site: z.string().trim().max(255).optional().nullable(),
          consultant: z.string().trim().max(120).optional().nullable(),
          observations: z.string().trim().max(4000).optional().nullable(),
        }),
  }),
  async (request, response) => {
    const existingTicket = await prisma.ticket.findUnique({
      where: { id: request.params.id },
      include: {
        lead: true,
      },
    });

    if (!existingTicket) {
      throw new HttpError(404, 'Ticket não encontrado');
    }

    const nextStatus = request.body.status || existingTicket.status;
    const requestedPlanId =
      request.body.planId !== undefined
        ? request.body.planId
        : existingTicket.planId || existingTicket.lead?.planId;
    const totals = Array.isArray(request.body.catalogItems)
      ? sumCatalogItems(request.body.catalogItems)
      : null;
    const ticket = await prisma.$transaction(async (tx) => {
      const linkedPlan = requestedPlanId
        ? await tx.plan.findUnique({
            where: { id: requestedPlanId },
          })
        : existingTicket.linkedPlan || existingTicket.lead?.plan || null;
      const shouldFallbackToPlanTotals =
        Boolean(linkedPlan) &&
        (!Array.isArray(request.body.catalogItems) ||
          !hasPricedEnabledCatalogItems(request.body.catalogItems));
      const resolvedSetupInCents = shouldFallbackToPlanTotals
        ? linkedPlan.setupFeeInCents
        : totals
          ? toCents(totals.setupAmount)
          : null;
      const resolvedRecurringInCents = shouldFallbackToPlanTotals
        ? linkedPlan.monthlyFeeInCents
        : totals
          ? toCents(totals.recurringAmount)
          : null;
      let resolvedLeadId = existingTicket.leadId || null;
      const nextMetadata = {
        ...(existingTicket.lead ? parseLeadMetadata(existingTicket.lead.notes) : {}),
        ...('installment' in request.body
          ? { installment: request.body.installment }
          : {}),
        ...('site' in request.body ? { site: request.body.site } : {}),
        ...('notes' in request.body
          ? { observations: request.body.notes }
          : {}),
        ...('observations' in request.body
          ? { observations: request.body.observations }
          : {}),
        ...('consultant' in request.body
          ? { consultant: request.body.consultant }
          : {}),
      };

      if (existingTicket.leadId && existingTicket.lead) {
        await tx.lead.update({
          where: { id: existingTicket.leadId },
          data: {
            ...('company' in request.body
              ? { company: request.body.company }
              : {}),
            ...('cnpj' in request.body ? { cnpj: request.body.cnpj } : {}),
            ...('contact' in request.body
              ? { contact: request.body.contact }
              : {}),
            ...('email' in request.body ? { email: request.body.email } : {}),
            ...('phone' in request.body ? { phone: request.body.phone } : {}),
            ...('paymentMethod' in request.body
              ? { paymentMethod: request.body.paymentMethod }
              : {}),
            ...('planId' in request.body
              ? { planId: request.body.planId }
              : {}),
            ...('sellerId' in request.body
              ? { sellerId: request.body.sellerId }
              : {}),
            ...('sdrId' in request.body ? { sdrId: request.body.sdrId } : {}),
            ...('originId' in request.body
              ? { originId: request.body.originId }
              : {}),
            ...('indicatorId' in request.body
              ? { indicatorId: request.body.indicatorId }
              : {}),
            ...('plan' in request.body
              ? { isLite: request.body.plan === 'Lite' }
              : {}),
            notes: buildLeadMetadataNotes(nextMetadata),
          },
        });

        if (Array.isArray(request.body.leadTasks)) {
          await tx.leadTask.deleteMany({
            where: { leadId: existingTicket.leadId },
          });

          if (request.body.leadTasks.length) {
            await tx.leadTask.createMany({
              data: request.body.leadTasks.map((task) => ({
                leadId: existingTicket.leadId,
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
            where: { leadId: existingTicket.leadId },
          });

          if (request.body.catalogItems.length) {
            await tx.leadCatalogItem.createMany({
              data: request.body.catalogItems.map((item) => ({
                leadId: existingTicket.leadId,
                catalogItemId: item.catalogItemId,
                enabled: item.enabled ?? true,
                setupInCents: toCents(item.setupAmount),
                recurringInCents: toCents(item.recurringAmount),
              })),
            });
          }
        }
      } else {
        const createdLead = await tx.lead.create({
          data: {
            company: request.body.company ?? existingTicket.company,
            cnpj:
              'cnpj' in request.body ? request.body.cnpj : existingTicket.cnpj,
            contact:
              'contact' in request.body ? request.body.contact : existingTicket.contact,
            email:
              'email' in request.body ? request.body.email : existingTicket.email,
            phone:
              'phone' in request.body ? request.body.phone : existingTicket.phone,
            status: 'Ganho',
            valueInCents: 0,
            paymentMethod:
              'paymentMethod' in request.body
                ? request.body.paymentMethod
                : existingTicket.paymentMethod,
            isLite:
              'plan' in request.body
                ? request.body.plan === 'Lite'
                : existingTicket.plan === 'Lite',
            planId: requestedPlanId || null,
            sellerId: request.body.sellerId ?? null,
            sdrId: request.body.sdrId ?? null,
            originId: request.body.originId ?? null,
            indicatorId: request.body.indicatorId ?? null,
            createdById: request.auth.userId,
            wonAt: new Date(),
            notes: buildLeadMetadataNotes(nextMetadata),
          },
        });

        resolvedLeadId = createdLead.id;

        if (Array.isArray(request.body.leadTasks) && request.body.leadTasks.length) {
          await tx.leadTask.createMany({
            data: request.body.leadTasks.map((task) => ({
              leadId: createdLead.id,
              title: task.title,
              type: task.type,
              done: task.done ?? false,
              dueDate: task.dueDate ? new Date(task.dueDate) : null,
              notes: task.notes,
            })),
          });
        }

        if (Array.isArray(request.body.catalogItems) && request.body.catalogItems.length) {
          await tx.leadCatalogItem.createMany({
            data: request.body.catalogItems.map((item) => ({
              leadId: createdLead.id,
              catalogItemId: item.catalogItemId,
              enabled: item.enabled ?? true,
              setupInCents: toCents(item.setupAmount),
              recurringInCents: toCents(item.recurringAmount),
            })),
          });
        }
      }

      if (Array.isArray(request.body.tasks)) {
        await tx.ticketTask.deleteMany({
          where: { ticketId: existingTicket.id },
        });

        if (request.body.tasks.length) {
          await tx.ticketTask.createMany({
            data: request.body.tasks.map((task) => ({
              ticketId: existingTicket.id,
              assigneeId: task.assigneeId,
              title: task.title,
              done: task.done ?? false,
              dueDate: task.dueDate ? new Date(task.dueDate) : null,
            })),
          });
        }
      }

      await tx.ticket.update({
        where: { id: existingTicket.id },
        data: {
          ...(resolvedLeadId && !existingTicket.leadId ? { leadId: resolvedLeadId } : {}),
          ...('status' in request.body ? { status: request.body.status } : {}),
          ...('csStatus' in request.body
            ? { csStatus: request.body.csStatus }
            : {}),
          ...('notes' in request.body ? { notes: request.body.notes } : {}),
          ...('company' in request.body
            ? { company: request.body.company }
            : {}),
          ...('cnpj' in request.body ? { cnpj: request.body.cnpj } : {}),
          ...('contact' in request.body
            ? { contact: request.body.contact }
            : {}),
          ...('email' in request.body ? { email: request.body.email } : {}),
          ...('phone' in request.body ? { phone: request.body.phone } : {}),
          ...('instance' in request.body
            ? { instance: request.body.instance }
            : {}),
          ...('plan' in request.body ? { plan: request.body.plan } : {}),
          ...('planId' in request.body ? { planId: request.body.planId } : {}),
          ...('paymentMethod' in request.body
            ? { paymentMethod: request.body.paymentMethod }
            : {}),
          ...('installment' in request.body
            ? { installment: request.body.installment }
            : {}),
          ...('assigneeId' in request.body
            ? { assigneeId: request.body.assigneeId }
            : {}),
          ...('technicalAssigneeId' in request.body
            ? { technicalAssigneeId: request.body.technicalAssigneeId }
            : {}),
          ...((resolvedSetupInCents !== null && resolvedRecurringInCents !== null)
            ? {
                setupInCents: resolvedSetupInCents,
                recurringInCents: resolvedRecurringInCents,
              }
            : {}),
          ...(!('technicalAssigneeId' in request.body) &&
          nextStatus === 'concluido' &&
          !existingTicket.technicalAssigneeId &&
          existingTicket.assigneeId
            ? { technicalAssigneeId: existingTicket.assigneeId }
            : {}),
          ...(nextStatus === 'concluido' && !existingTicket.completedAt
            ? { completedAt: new Date() }
            : {}),
          ...(nextStatus === 'cancelado' && !existingTicket.canceledAt
            ? { canceledAt: new Date() }
            : {}),
        },
      });

      return tx.ticket.findUnique({
        where: { id: existingTicket.id },
        include: ticketInclude,
      });
    });

    await writeAuditLog({
      actorUserId: request.auth.userId,
      action: 'COMMERCIAL_TICKET_UPDATE',
      entityType: 'Ticket',
      entityId: ticket.id,
      ipAddress: response.locals.ipAddress,
      userAgent: response.locals.userAgent,
      metadata: request.body,
    });

    response.json({ item: serializeTicket(ticket) });
  },
);

ticketsRouter.patch(
  '/closed-clients/:id/confirm-payment',
  requireModuleAccess('CLIENTES', 'edit'),
  validate({
    params: z.object({ id: cuidSchema }),
  }),
  async (request, response) => {
    const existingTicket = await prisma.ticket.findUnique({
      where: { id: request.params.id },
      include: {
        lead: {
          include: {
            plan: true,
          },
        },
        linkedPlan: true,
      },
    });

    if (!existingTicket) {
      throw new HttpError(404, 'Ticket não encontrado');
    }

    const ticket = await prisma.ticket.update({
      where: { id: existingTicket.id },
      data: {
        status: 'pagamento_confirmado',
        csStatus: existingTicket.csStatus || 'Briefing',
      },
      include: ticketInclude,
    });

    await writeAuditLog({
      actorUserId: request.auth.userId,
      action: 'COMMERCIAL_TICKET_PAYMENT_CONFIRM',
      entityType: 'Ticket',
      entityId: ticket.id,
      ipAddress: response.locals.ipAddress,
      userAgent: response.locals.userAgent,
    });

    response.json({ item: serializeTicket(ticket) });
  },
);

ticketsRouter.patch(
  '/closed-clients/:id/approve-implementation',
  requireModuleAccess('CLIENTES', 'edit'),
  validate({
    params: z.object({ id: cuidSchema }),
  }),
  async (request, response) => {
    const existingTicket = await prisma.ticket.findUnique({
      where: { id: request.params.id },
      include: {
        linkedPlan: true,
        lead: {
          include: {
            plan: true,
          },
        },
      },
    });

    if (!existingTicket) {
      throw new HttpError(404, 'Ticket não encontrado');
    }

    if (existingTicket.status !== 'pagamento_confirmado') {
      throw new HttpError(
        400,
        'Confirme o pagamento antes de aprovar a implantação',
      );
    }

    const ticket = await prisma.ticket.update({
      where: { id: existingTicket.id },
      data: {
        status: 'em_implantacao',
        csStatus: existingTicket.csStatus || 'Briefing',
      },
      include: ticketInclude,
    });

    await writeAuditLog({
      actorUserId: request.auth.userId,
      action: 'COMMERCIAL_TICKET_IMPLEMENTATION_APPROVE',
      entityType: 'Ticket',
      entityId: ticket.id,
      ipAddress: response.locals.ipAddress,
      userAgent: response.locals.userAgent,
    });

    response.json({ item: serializeTicket(ticket) });
  },
);

ticketsRouter.post(
  '/closed-clients/:id/comments',
  requireModuleAccess('CLIENTES', 'edit'),
  validate({
    params: z.object({ id: cuidSchema }),
    body: ticketCommentSchema,
  }),
  async (request, response) => {
    const ticket = await prisma.ticket.findUnique({
      where: { id: request.params.id },
    });

    if (!ticket) {
      throw new HttpError(404, 'Ticket não encontrado');
    }

    const comment = await prisma.ticketComment.create({
      data: {
        ticketId: ticket.id,
        authorUserId: request.auth.userId,
        message: request.body.message,
      },
      include: {
        author: true,
      },
    });

    await writeAuditLog({
      actorUserId: request.auth.userId,
      action: 'COMMERCIAL_TICKET_COMMENT_CREATE',
      entityType: 'TicketComment',
      entityId: comment.id,
      ipAddress: response.locals.ipAddress,
      userAgent: response.locals.userAgent,
      metadata: { ticketId: ticket.id },
    });

    response.status(201).json({ item: comment });
  },
);

ticketsRouter.get(
  '/',
  requireModuleAccess('IMPLANTACAO', 'view'),
  validate({ query: listTicketsQuerySchema }),
  async (request, response) => {
    const { page, limit, skip } = getPagination(request.query);
    const where = {
      ...(request.query.q
        ? {
            OR: [
              { code: { contains: request.query.q } },
              { company: { contains: request.query.q } },
              { cnpj: { contains: request.query.q } },
            ],
          }
        : {}),
      ...(request.query.status ? { status: request.query.status } : {}),
      ...(request.query.type ? { type: request.query.type } : {}),
      ...(request.query.assigneeId
        ? { assigneeId: request.query.assigneeId }
        : {}),
      ...(request.query.technicalAssigneeId
        ? { technicalAssigneeId: request.query.technicalAssigneeId }
        : {}),
      ...((request.query.from || request.query.to) && {
        createdAt: {
          ...(request.query.from ? { gte: new Date(request.query.from) } : {}),
          ...(request.query.to ? { lte: new Date(request.query.to) } : {}),
        },
      }),
    };

    const [items, total] = await prisma.$transaction([
      prisma.ticket.findMany({
        where,
        include: ticketInclude,
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip,
      }),
      prisma.ticket.count({ where }),
    ]);

    response.json({
      items: items.map(serializeTicket),
      meta: buildPageMeta({ page, limit, total }),
    });
  },
);

ticketsRouter.get(
  '/:id',
  requireModuleAccess('IMPLANTACAO', 'view'),
  validate({ params: z.object({ id: cuidSchema }) }),
  async (request, response) => {
    const ticket = await prisma.ticket.findUnique({
      where: { id: request.params.id },
      include: ticketInclude,
    });

    if (!ticket) {
      throw new HttpError(404, 'Ticket não encontrado');
    }

    response.json({ item: serializeTicket(ticket) });
  },
);

ticketsRouter.post(
  '/',
  requireModuleAccess('IMPLANTACAO', 'edit'),
  validate({ body: createTicketSchema }),
  async (request, response) => {
    const ticket = await prisma.ticket.create({
      data: {
        code: request.body.code,
        leadId: request.body.leadId,
        company: request.body.company,
        cnpj: request.body.cnpj,
        contact: request.body.contact,
        email: request.body.email,
        phone: request.body.phone,
        instance: request.body.instance,
        plan: request.body.plan,
        paymentMethod: request.body.paymentMethod,
        installment: request.body.installment,
        type: request.body.type,
        status: request.body.status,
        csStatus: request.body.csStatus,
        notes: request.body.notes,
        cancelReason: request.body.cancelReason,
        setupInCents: toCents(request.body.setupAmount),
        recurringInCents: toCents(request.body.recurringAmount),
        createdById: request.auth.userId,
        assigneeId: request.body.assigneeId,
        technicalAssigneeId: request.body.technicalAssigneeId,
        completedAt: request.body.completedAt
          ? new Date(request.body.completedAt)
          : null,
        canceledAt: request.body.status === 'cancelado' ? new Date() : null,
        tasks: request.body.tasks?.length
          ? {
              create: request.body.tasks.map((task) => ({
                assigneeId: task.assigneeId,
                title: task.title,
                done: task.done ?? false,
                dueDate: task.dueDate ? new Date(task.dueDate) : null,
              })),
            }
          : undefined,
      },
      include: ticketInclude,
    });

    await writeAuditLog({
      actorUserId: request.auth.userId,
      action: 'TICKET_CREATE',
      entityType: 'Ticket',
      entityId: ticket.id,
      ipAddress: response.locals.ipAddress,
      userAgent: response.locals.userAgent,
    });

    response.status(201).json({ item: serializeTicket(ticket) });
  },
);

ticketsRouter.patch(
  '/:id',
  requireModuleAccess('IMPLANTACAO', 'edit'),
  validate({
    params: z.object({ id: cuidSchema }),
    body: updateTicketSchema,
  }),
  async (request, response) => {
    const existingTicket = await prisma.ticket.findUnique({
      where: { id: request.params.id },
      include: {
        lead: true,
      },
    });

    if (!existingTicket) {
      throw new HttpError(404, 'Ticket não encontrado');
    }

    const nextStatus = request.body.status || existingTicket.status;

    const ticket = await prisma.$transaction(async (tx) => {
      if (existingTicket.leadId && existingTicket.lead && 'site' in request.body) {
        const currentMetadata = parseLeadMetadata(existingTicket.lead.notes);
        await tx.lead.update({
          where: { id: existingTicket.leadId },
          data: {
            notes: buildLeadMetadataNotes({
              ...currentMetadata,
              site: request.body.site,
            }),
          },
        });
      }

      return tx.ticket.update({
        where: { id: request.params.id },
        data: {
          ...('code' in request.body ? { code: request.body.code } : {}),
          ...('leadId' in request.body ? { leadId: request.body.leadId } : {}),
          ...('company' in request.body ? { company: request.body.company } : {}),
          ...('cnpj' in request.body ? { cnpj: request.body.cnpj } : {}),
          ...('contact' in request.body ? { contact: request.body.contact } : {}),
          ...('email' in request.body ? { email: request.body.email } : {}),
          ...('phone' in request.body ? { phone: request.body.phone } : {}),
          ...('instance' in request.body
            ? { instance: request.body.instance }
            : {}),
          ...('plan' in request.body ? { plan: request.body.plan } : {}),
          ...('planId' in request.body ? { planId: request.body.planId } : {}),
          ...('paymentMethod' in request.body
            ? { paymentMethod: request.body.paymentMethod }
            : {}),
          ...('installment' in request.body
            ? { installment: request.body.installment }
            : {}),
          ...('type' in request.body ? { type: request.body.type } : {}),
          ...('status' in request.body ? { status: request.body.status } : {}),
          ...('csStatus' in request.body
            ? { csStatus: request.body.csStatus }
            : {}),
          ...('notes' in request.body ? { notes: request.body.notes } : {}),
          ...('cancelReason' in request.body
            ? { cancelReason: request.body.cancelReason }
            : {}),
          ...('setupAmount' in request.body
            ? { setupInCents: toCents(request.body.setupAmount) }
            : {}),
          ...('recurringAmount' in request.body
            ? { recurringInCents: toCents(request.body.recurringAmount) }
            : {}),
          ...('assigneeId' in request.body
            ? { assigneeId: request.body.assigneeId }
            : {}),
          ...('technicalAssigneeId' in request.body
            ? { technicalAssigneeId: request.body.technicalAssigneeId }
            : {}),
          ...(!('technicalAssigneeId' in request.body) &&
          nextStatus === 'concluido' &&
          !existingTicket.technicalAssigneeId &&
          existingTicket.assigneeId
            ? { technicalAssigneeId: existingTicket.assigneeId }
            : {}),
          ...('completedAt' in request.body
            ? {
                completedAt: request.body.completedAt
                  ? new Date(request.body.completedAt)
                  : null,
              }
            : {}),
          ...(nextStatus === 'cancelado' ? { canceledAt: new Date() } : {}),
          ...(nextStatus === 'concluido' && !existingTicket.completedAt
            ? { completedAt: new Date() }
            : {}),
        },
        include: ticketInclude,
      });
    });

    await writeAuditLog({
      actorUserId: request.auth.userId,
      action: 'TICKET_UPDATE',
      entityType: 'Ticket',
      entityId: ticket.id,
      ipAddress: response.locals.ipAddress,
      userAgent: response.locals.userAgent,
      metadata: request.body,
    });

    response.json({ item: serializeTicket(ticket) });
  },
);

ticketsRouter.delete(
  '/:id',
  requireModuleAccess('IMPLANTACAO', 'manage'),
  validate({
    params: z.object({ id: cuidSchema }),
  }),
  async (request, response) => {
    const ticket = await prisma.ticket.findUnique({
      where: { id: request.params.id },
      include: {
        tasks: true,
        comments: true,
      },
    });

    if (!ticket) {
      throw new HttpError(404, 'Ticket não encontrado');
    }

    await prisma.$transaction(async (tx) => {
      await moveEntityToTrash({
        tx,
        moduleKey: 'IMPLANTACAO',
        entityType: 'Ticket',
        entityId: ticket.id,
        label: ticket.code,
        payload: {
          ticket: {
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
            paymentMethod: ticket.paymentMethod,
            installment: ticket.installment,
            type: ticket.type,
            status: ticket.status,
            csStatus: ticket.csStatus,
            notes: ticket.notes,
            cancelReason: ticket.cancelReason,
            setupInCents: ticket.setupInCents,
            recurringInCents: ticket.recurringInCents,
            createdById: ticket.createdById,
            assigneeId: ticket.assigneeId,
            technicalAssigneeId: ticket.technicalAssigneeId,
            createdAt: ticket.createdAt,
            updatedAt: ticket.updatedAt,
            canceledAt: ticket.canceledAt,
            completedAt: ticket.completedAt,
          },
          tasks: ticket.tasks.map((task) => ({
            id: task.id,
            assigneeId: task.assigneeId,
            title: task.title,
            done: task.done,
            dueDate: task.dueDate,
            createdAt: task.createdAt,
            updatedAt: task.updatedAt,
          })),
          comments: ticket.comments.map((comment) => ({
            id: comment.id,
            authorUserId: comment.authorUserId,
            message: comment.message,
            createdAt: comment.createdAt,
          })),
        },
        deletedById: request.auth.userId,
      });

      await tx.ticket.delete({
        where: { id: ticket.id },
      });
    });

    response.status(204).send();
  },
);

ticketsRouter.post(
  '/:id/attachments',
  requireModuleAccess('IMPLANTACAO', 'edit'),
  validate({
    params: z.object({ id: cuidSchema }),
    body: ticketAttachmentBatchSchema,
  }),
  async (request, response) => {
    const ticket = await prisma.ticket.findUnique({
      where: { id: request.params.id },
    });

    if (!ticket) {
      throw new HttpError(404, 'Ticket não encontrado');
    }

    const created = await prisma.$transaction(
      request.body.files.map((file) =>
        prisma.ticketAttachment.create({
          data: {
            ticketId: ticket.id,
            uploadedById: request.auth.userId,
            fileName: file.fileName,
            mimeType: file.mimeType,
            sizeInBytes: file.sizeInBytes,
            contentBase64: file.contentBase64,
          },
          include: {
            uploadedBy: true,
          },
        }),
      ),
    );

    await writeAuditLog({
      actorUserId: request.auth.userId,
      action: 'TICKET_ATTACHMENT_CREATE',
      entityType: 'TicketAttachment',
      entityId: ticket.id,
      ipAddress: response.locals.ipAddress,
      userAgent: response.locals.userAgent,
      metadata: {
        ticketId: ticket.id,
        fileNames: request.body.files.map((file) => file.fileName),
      },
    });

    response.status(201).json({
      items: created.map((attachment) => ({
        id: attachment.id,
        fileName: attachment.fileName,
        mimeType: attachment.mimeType,
        sizeInBytes: attachment.sizeInBytes,
        createdAt: attachment.createdAt,
      })),
    });
  },
);

ticketsRouter.get(
  '/:id/attachments/:attachmentId',
  requireModuleAccess('IMPLANTACAO', 'view'),
  validate({
    params: z.object({ id: cuidSchema, attachmentId: cuidSchema }),
  }),
  async (request, response) => {
    const attachment = await prisma.ticketAttachment.findFirst({
      where: {
        id: request.params.attachmentId,
        ticketId: request.params.id,
      },
    });

    if (!attachment) {
      throw new HttpError(404, 'Anexo não encontrado');
    }

    const fileBuffer = Buffer.from(attachment.contentBase64, 'base64');
    response.setHeader('Content-Type', attachment.mimeType);
    response.setHeader(
      'Content-Disposition',
      `attachment; filename="${encodeURIComponent(attachment.fileName)}"`,
    );
    response.setHeader('Content-Length', String(fileBuffer.length));
    response.send(fileBuffer);
  },
);

ticketsRouter.delete(
  '/:id/attachments/:attachmentId',
  requireModuleAccess('IMPLANTACAO', 'edit'),
  validate({
    params: z.object({ id: cuidSchema, attachmentId: cuidSchema }),
  }),
  async (request, response) => {
    const attachment = await prisma.ticketAttachment.findFirst({
      where: {
        id: request.params.attachmentId,
        ticketId: request.params.id,
      },
    });

    if (!attachment) {
      throw new HttpError(404, 'Anexo não encontrado');
    }

    await prisma.ticketAttachment.delete({
      where: { id: attachment.id },
    });

    await writeAuditLog({
      actorUserId: request.auth.userId,
      action: 'TICKET_ATTACHMENT_DELETE',
      entityType: 'TicketAttachment',
      entityId: attachment.id,
      ipAddress: response.locals.ipAddress,
      userAgent: response.locals.userAgent,
      metadata: {
        ticketId: request.params.id,
        fileName: attachment.fileName,
      },
    });

    response.status(204).send();
  },
);

ticketsRouter.post(
  '/:id/tasks',
  requireModuleAccess('IMPLANTACAO', 'edit'),
  validate({
    params: z.object({ id: cuidSchema }),
    body: ticketTaskSchema,
  }),
  async (request, response) => {
    const ticket = await prisma.ticket.findUnique({
      where: { id: request.params.id },
    });

    if (!ticket) {
      throw new HttpError(404, 'Ticket não encontrado');
    }

    const task = await prisma.ticketTask.create({
      data: {
        ticketId: ticket.id,
        assigneeId: request.body.assigneeId,
        title: request.body.title,
        done: request.body.done ?? false,
        dueDate: request.body.dueDate ? new Date(request.body.dueDate) : null,
      },
      include: {
        assignee: true,
      },
    });

    await writeAuditLog({
      actorUserId: request.auth.userId,
      action: 'TICKET_TASK_CREATE',
      entityType: 'TicketTask',
      entityId: task.id,
      ipAddress: response.locals.ipAddress,
      userAgent: response.locals.userAgent,
      metadata: { ticketId: ticket.id },
    });

    response.status(201).json({ item: task });
  },
);

ticketsRouter.post(
  '/:id/comments',
  requireModuleAccess('IMPLANTACAO', 'edit'),
  validate({
    params: z.object({ id: cuidSchema }),
    body: ticketCommentSchema,
  }),
  async (request, response) => {
    const ticket = await prisma.ticket.findUnique({
      where: { id: request.params.id },
    });

    if (!ticket) {
      throw new HttpError(404, 'Ticket não encontrado');
    }

    const comment = await prisma.ticketComment.create({
      data: {
        ticketId: ticket.id,
        authorUserId: request.auth.userId,
        message: request.body.message,
      },
      include: {
        author: true,
      },
    });

    await writeAuditLog({
      actorUserId: request.auth.userId,
      action: 'TICKET_COMMENT_CREATE',
      entityType: 'TicketComment',
      entityId: comment.id,
      ipAddress: response.locals.ipAddress,
      userAgent: response.locals.userAgent,
      metadata: { ticketId: ticket.id },
    });

    response.status(201).json({ item: comment });
  },
);
