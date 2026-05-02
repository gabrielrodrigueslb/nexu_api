import { Router } from "express";
import { z } from "zod";

import { writeAuditLog } from "../lib/audit.js";
import { HttpError } from "../lib/http-error.js";
import { buildPageMeta, getPagination } from "../lib/pagination.js";
import { prisma } from "../lib/prisma.js";
import { cuidSchema, instanceDomainSchema, paginationSchema } from "../lib/schemas.js";
import { authenticate } from "../middlewares/authenticate.js";
import { requireModuleAccess } from "../middlewares/require-module-access.js";
import { validate } from "../middlewares/validate.js";

export const developmentRouter = Router();

const devStatusSchema = z.enum([
  "Backlog",
  "Analise",
  "Pronto para Desenvolver",
  "Em Desenvolvimento",
  "Testes",
  "Code Review",
  "Concluido",
]);
const devTypeSchema = z.enum(["Epic", "Feature", "Task", "Bug"]);
const complexitySchema = z.enum(["Simples", "Media", "Complexa"]);

const criteriaSchema = z.object({
  imp: z.coerce.number().min(0).max(5),
  ris: z.coerce.number().min(0).max(5),
  fre: z.coerce.number().min(0).max(5),
  esf: z.coerce.number().min(0).max(5),
  deb: z.coerce.number().min(0).max(5),
});

const historyItemSchema = z.object({
  id: z.string().trim().min(1).max(120),
  user: z.string().trim().min(1).max(120),
  message: z.string().trim().min(1).max(1000),
  createdAt: z.string().trim().min(4).max(80),
});

const devTicketSchema = z.object({
  proto: z.string().trim().min(4).max(40),
  title: z.string().trim().min(3).max(200),
  category: z.string().trim().min(2).max(120),
  devType: devTypeSchema,
  devStatus: devStatusSchema,
  complexity: complexitySchema.default("Media"),
  score: z.coerce.number().int().min(0).max(100),
  totalPts: z.coerce.number().int().min(0).max(100),
  assigneeId: cuidSchema.optional().nullable(),
  sprintId: cuidSchema.optional().nullable(),
  parentId: z.coerce.number().int().positive().optional().nullable(),
  clientName: z.string().trim().max(160).optional().nullable(),
  protoExt: z.string().trim().max(120).optional().nullable(),
  instance: instanceDomainSchema.optional().nullable(),
  cnpj: z.string().trim().max(24).optional().nullable(),
  clientPhone: z.string().trim().max(40).optional().nullable(),
  description: z.string().trim().min(3).max(5000),
  tags: z.array(z.string().trim().min(1).max(80)).optional(),
  criteria: criteriaSchema.optional(),
  history: z.array(historyItemSchema).optional(),
  incident: z.boolean().optional(),
  compliment: z.boolean().optional(),
  docDone: z.boolean().optional(),
  prodBug: z.boolean().optional(),
  reopened: z.boolean().optional(),
  criticalBug: z.boolean().optional(),
  createdAt: z.string().datetime().optional(),
  startDate: z.string().datetime().optional().nullable(),
  deadline: z.string().datetime().optional().nullable(),
  resolvedAt: z.string().datetime().optional().nullable(),
});

const devTicketCommentSchema = z.object({
  message: z.string().trim().min(1).max(2000),
});

const sprintSchema = z.object({
  name: z.string().trim().min(3).max(120),
  goal: z.string().trim().max(1000).optional().nullable(),
  startDate: z.string().datetime(),
  endDate: z.string().datetime(),
  closed: z.boolean().optional(),
  closedAt: z.string().datetime().optional().nullable(),
});

const listTicketsQuerySchema = paginationSchema.extend({
  q: z.string().trim().optional(),
  devStatus: devStatusSchema.optional(),
  devType: devTypeSchema.optional(),
  sprintId: cuidSchema.optional(),
  assigneeId: cuidSchema.optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
});

function safeJsonParse(value, fallback) {
  try {
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

function normalizeDisplayStatus(status) {
  if (status === "Analise") return "Análise";
  if (status === "Concluido") return "Concluído";
  return status;
}

function normalizeDisplayComplexity(complexity) {
  if (complexity === "Media") return "Média";
  return complexity;
}

function serializeDevSprint(sprint) {
  return {
    id: sprint.id,
    name: sprint.name,
    goal: sprint.goal,
    start: sprint.startDate.toISOString().slice(0, 10),
    end: sprint.endDate.toISOString().slice(0, 10),
    closed: sprint.closed,
    createdAt: sprint.createdAt.toISOString().slice(0, 10),
    closedAt: sprint.closedAt ? sprint.closedAt.toISOString().slice(0, 10) : null,
  };
}

function serializeDevTicket(ticket) {
  return {
    id: ticket.id,
    proto: ticket.proto,
    title: ticket.title,
    category: ticket.category,
    devType: ticket.devType,
    devStatus: normalizeDisplayStatus(ticket.devStatus),
    complexity: normalizeDisplayComplexity(ticket.complexity),
    resp: ticket.assigneeId || "",
    score: ticket.score,
    totalPts: ticket.totalPts,
    createdAt: ticket.createdAt.toISOString().slice(0, 10),
    updatedAt: ticket.updatedAt ? ticket.updatedAt.toISOString().slice(0, 10) : null,
    startDate: ticket.startDate ? ticket.startDate.toISOString().slice(0, 10) : null,
    deadline: ticket.deadline ? ticket.deadline.toISOString().slice(0, 10) : null,
    concludedAt: ticket.resolvedAt ? ticket.resolvedAt.toISOString().slice(0, 10) : null,
    sprintId: ticket.sprintId,
    parentId: ticket.parentId,
    clientName: ticket.clientName,
    description: ticket.description,
    createdBy: ticket.createdById,
    protoExt: ticket.protoExt,
    instance: ticket.instance,
    cnpj: ticket.cnpj,
    clientPhone: ticket.clientPhone,
    tags: safeJsonParse(ticket.tagsJson, []),
    criteria: safeJsonParse(ticket.criteriaJson, {}),
    history: safeJsonParse(ticket.historyJson, []),
    incident: ticket.incident,
    compliment: ticket.compliment,
    docDone: ticket.docDone,
    prodBug: ticket.prodBug,
    reopened: ticket.reopened,
    criticalBug: ticket.criticalBug,
    assignee: ticket.assignee
      ? {
          id: ticket.assignee.id,
          name: ticket.assignee.name,
        }
      : null,
    createdByUser: ticket.createdBy
      ? {
          id: ticket.createdBy.id,
          name: ticket.createdBy.name,
        }
      : null,
    sprint: ticket.sprint ? serializeDevSprint(ticket.sprint) : null,
    comments: (ticket.comments || []).map((comment) => ({
      id: comment.id,
      author: comment.author?.name || "Usuário",
      authorId: comment.authorUserId,
      message: comment.message,
      createdAt: comment.createdAt.toLocaleString("pt-BR", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      }),
    })),
  };
}

const devTicketInclude = {
  assignee: true,
  createdBy: true,
  sprint: true,
  comments: {
    include: {
      author: true,
    },
    orderBy: {
      createdAt: "asc",
    },
  },
};

developmentRouter.use(authenticate);

developmentRouter.get(
  "/lookups",
  requireModuleAccess("DESENVOLVIMENTO", "view"),
  async (_request, response) => {
    const [users, sprints] = await Promise.all([
      prisma.user.findMany({
        where: {
          sector: "Desenvolvimento",
          isActive: true,
        },
        orderBy: { name: "asc" },
        select: {
          id: true,
          name: true,
        },
      }),
      prisma.devSprint.findMany({
        orderBy: [{ startDate: "asc" }],
      }),
    ]);

    response.json({
      users,
      sprints: sprints.map(serializeDevSprint),
    });
  },
);

developmentRouter.get(
  "/tickets",
  requireModuleAccess("DESENVOLVIMENTO", "view"),
  validate({ query: listTicketsQuerySchema }),
  async (request, response) => {
    const { page, limit, skip } = getPagination(request.query);
    const where = {
      ...(request.query.q
        ? {
            OR: [
              { proto: { contains: request.query.q } },
              { title: { contains: request.query.q } },
              { category: { contains: request.query.q } },
              { clientName: { contains: request.query.q } },
            ],
          }
        : {}),
      ...(request.query.devStatus
        ? {
            devStatus: request.query.devStatus === "Concluido" ? "Concluido" : request.query.devStatus,
          }
        : {}),
      ...(request.query.devType ? { devType: request.query.devType } : {}),
      ...(request.query.sprintId ? { sprintId: request.query.sprintId } : {}),
      ...(request.query.assigneeId ? { assigneeId: request.query.assigneeId } : {}),
      ...((request.query.from || request.query.to) && {
        createdAt: {
          ...(request.query.from ? { gte: new Date(request.query.from) } : {}),
          ...(request.query.to ? { lte: new Date(request.query.to) } : {}),
        },
      }),
    };

    const [items, total] = await prisma.$transaction([
      prisma.devTicket.findMany({
        where,
        include: devTicketInclude,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: limit,
        skip,
      }),
      prisma.devTicket.count({ where }),
    ]);

    response.json({
      items: items.map(serializeDevTicket),
      meta: buildPageMeta({ page, limit, total }),
    });
  },
);

developmentRouter.post(
  "/tickets",
  requireModuleAccess("DESENVOLVIMENTO", "edit"),
  validate({ body: devTicketSchema }),
  async (request, response) => {
    const ticket = await prisma.devTicket.create({
      data: {
        proto: request.body.proto,
        title: request.body.title,
        category: request.body.category,
        devType: request.body.devType,
        devStatus: request.body.devStatus,
        complexity: request.body.complexity,
        score: request.body.score,
        totalPts: request.body.totalPts,
        createdById: request.auth.userId,
        assigneeId: request.body.assigneeId,
        sprintId: request.body.sprintId,
        parentId: request.body.parentId,
        clientName: request.body.clientName,
        protoExt: request.body.protoExt,
        instance: request.body.instance,
        cnpj: request.body.cnpj,
        clientPhone: request.body.clientPhone,
        description: request.body.description,
        tagsJson: JSON.stringify(request.body.tags || []),
        criteriaJson: JSON.stringify(request.body.criteria || {}),
        historyJson: JSON.stringify(request.body.history || []),
        incident: request.body.incident ?? false,
        compliment: request.body.compliment ?? false,
        docDone: request.body.docDone ?? false,
        prodBug: request.body.prodBug ?? false,
        reopened: request.body.reopened ?? false,
        criticalBug: request.body.criticalBug ?? false,
        createdAt: request.body.createdAt ? new Date(request.body.createdAt) : undefined,
        startDate: request.body.startDate ? new Date(request.body.startDate) : null,
        deadline: request.body.deadline ? new Date(request.body.deadline) : null,
        resolvedAt: request.body.resolvedAt ? new Date(request.body.resolvedAt) : null,
      },
      include: devTicketInclude,
    });

    await writeAuditLog({
      actorUserId: request.auth.userId,
      action: "DEV_TICKET_CREATE",
      entityType: "DevTicket",
      entityId: String(ticket.id),
      ipAddress: response.locals.ipAddress,
      userAgent: response.locals.userAgent,
    });

    response.status(201).json({ item: serializeDevTicket(ticket) });
  },
);

developmentRouter.patch(
  "/tickets/:id",
  requireModuleAccess("DESENVOLVIMENTO", "edit"),
  validate({
    params: z.object({ id: z.coerce.number().int().positive() }),
    body: devTicketSchema.partial(),
  }),
  async (request, response) => {
    const existing = await prisma.devTicket.findUnique({
      where: { id: request.params.id },
    });

    if (!existing) {
      throw new HttpError(404, "Ticket de desenvolvimento não encontrado");
    }

    const nextStatus = request.body.devStatus || existing.devStatus;
    const ticket = await prisma.devTicket.update({
      where: { id: request.params.id },
      data: {
        ...("proto" in request.body ? { proto: request.body.proto } : {}),
        ...("title" in request.body ? { title: request.body.title } : {}),
        ...("category" in request.body ? { category: request.body.category } : {}),
        ...("devType" in request.body ? { devType: request.body.devType } : {}),
        ...("devStatus" in request.body ? { devStatus: request.body.devStatus } : {}),
        ...("complexity" in request.body ? { complexity: request.body.complexity } : {}),
        ...("score" in request.body ? { score: request.body.score } : {}),
        ...("totalPts" in request.body ? { totalPts: request.body.totalPts } : {}),
        ...("assigneeId" in request.body ? { assigneeId: request.body.assigneeId } : {}),
        ...("sprintId" in request.body ? { sprintId: request.body.sprintId } : {}),
        ...("parentId" in request.body ? { parentId: request.body.parentId } : {}),
        ...("clientName" in request.body ? { clientName: request.body.clientName } : {}),
        ...("protoExt" in request.body ? { protoExt: request.body.protoExt } : {}),
        ...("instance" in request.body ? { instance: request.body.instance } : {}),
        ...("cnpj" in request.body ? { cnpj: request.body.cnpj } : {}),
        ...("clientPhone" in request.body ? { clientPhone: request.body.clientPhone } : {}),
        ...("description" in request.body ? { description: request.body.description } : {}),
        ...("tags" in request.body ? { tagsJson: JSON.stringify(request.body.tags || []) } : {}),
        ...("criteria" in request.body
          ? { criteriaJson: JSON.stringify(request.body.criteria || {}) }
          : {}),
        ...("history" in request.body
          ? { historyJson: JSON.stringify(request.body.history || []) }
          : {}),
        ...("incident" in request.body ? { incident: request.body.incident } : {}),
        ...("compliment" in request.body ? { compliment: request.body.compliment } : {}),
        ...("docDone" in request.body ? { docDone: request.body.docDone } : {}),
        ...("prodBug" in request.body ? { prodBug: request.body.prodBug } : {}),
        ...("reopened" in request.body ? { reopened: request.body.reopened } : {}),
        ...("criticalBug" in request.body
          ? { criticalBug: request.body.criticalBug }
          : {}),
        ...("createdAt" in request.body
          ? { createdAt: request.body.createdAt ? new Date(request.body.createdAt) : existing.createdAt }
          : {}),
        ...("startDate" in request.body
          ? { startDate: request.body.startDate ? new Date(request.body.startDate) : null }
          : {}),
        ...("deadline" in request.body
          ? { deadline: request.body.deadline ? new Date(request.body.deadline) : null }
          : {}),
        ...("resolvedAt" in request.body
          ? { resolvedAt: request.body.resolvedAt ? new Date(request.body.resolvedAt) : null }
          : {}),
        ...(nextStatus === "Concluido" && !("resolvedAt" in request.body)
          ? { resolvedAt: existing.resolvedAt || new Date() }
          : {}),
      },
      include: devTicketInclude,
    });

    await writeAuditLog({
      actorUserId: request.auth.userId,
      action: "DEV_TICKET_UPDATE",
      entityType: "DevTicket",
      entityId: String(ticket.id),
      ipAddress: response.locals.ipAddress,
      userAgent: response.locals.userAgent,
      metadata: request.body,
    });

    response.json({ item: serializeDevTicket(ticket) });
  },
);

developmentRouter.delete(
  "/tickets/:id",
  requireModuleAccess("DESENVOLVIMENTO", "manage"),
  validate({
    params: z.object({ id: z.coerce.number().int().positive() }),
  }),
  async (request, response) => {
    const existing = await prisma.devTicket.findUnique({
      where: { id: request.params.id },
    });

    if (!existing) {
      throw new HttpError(404, "Ticket de desenvolvimento não encontrado");
    }

    await prisma.devTicket.delete({
      where: { id: existing.id },
    });

    await writeAuditLog({
      actorUserId: request.auth.userId,
      action: "DEV_TICKET_DELETE",
      entityType: "DevTicket",
      entityId: String(existing.id),
      ipAddress: response.locals.ipAddress,
      userAgent: response.locals.userAgent,
    });

    response.status(204).send();
  },
);

developmentRouter.post(
  "/tickets/:id/comments",
  requireModuleAccess("DESENVOLVIMENTO", "edit"),
  validate({
    params: z.object({ id: z.coerce.number().int().positive() }),
    body: devTicketCommentSchema,
  }),
  async (request, response) => {
    const existing = await prisma.devTicket.findUnique({
      where: { id: request.params.id },
    });

    if (!existing) {
      throw new HttpError(404, "Ticket de desenvolvimento não encontrado");
    }

    const comment = await prisma.devTicketComment.create({
      data: {
        ticketId: existing.id,
        authorUserId: request.auth.userId,
        message: request.body.message,
      },
      include: {
        author: true,
      },
    });

    response.status(201).json({
      item: {
        id: comment.id,
        author: comment.author?.name || "Usuário",
        authorId: comment.authorUserId,
        message: comment.message,
        createdAt: comment.createdAt.toLocaleString("pt-BR", {
          day: "2-digit",
          month: "2-digit",
          year: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        }),
      },
    });
  },
);

developmentRouter.get(
  "/sprints",
  requireModuleAccess("DESENVOLVIMENTO", "view"),
  async (_request, response) => {
    const items = await prisma.devSprint.findMany({
      orderBy: [{ closed: "asc" }, { startDate: "asc" }],
    });

    response.json({
      items: items.map(serializeDevSprint),
    });
  },
);

developmentRouter.post(
  "/sprints",
  requireModuleAccess("DESENVOLVIMENTO", "edit"),
  validate({ body: sprintSchema }),
  async (request, response) => {
    const sprint = await prisma.devSprint.create({
      data: {
        name: request.body.name,
        goal: request.body.goal,
        startDate: new Date(request.body.startDate),
        endDate: new Date(request.body.endDate),
        closed: request.body.closed ?? false,
        closedAt: request.body.closedAt ? new Date(request.body.closedAt) : null,
      },
    });

    response.status(201).json({ item: serializeDevSprint(sprint) });
  },
);

developmentRouter.patch(
  "/sprints/:id",
  requireModuleAccess("DESENVOLVIMENTO", "edit"),
  validate({
    params: z.object({ id: cuidSchema }),
    body: sprintSchema.partial(),
  }),
  async (request, response) => {
    const sprint = await prisma.devSprint.findUnique({
      where: { id: request.params.id },
    });

    if (!sprint) {
      throw new HttpError(404, "Sprint não encontrada");
    }

    const updated = await prisma.devSprint.update({
      where: { id: sprint.id },
      data: {
        ...("name" in request.body ? { name: request.body.name } : {}),
        ...("goal" in request.body ? { goal: request.body.goal } : {}),
        ...("startDate" in request.body
          ? { startDate: request.body.startDate ? new Date(request.body.startDate) : sprint.startDate }
          : {}),
        ...("endDate" in request.body
          ? { endDate: request.body.endDate ? new Date(request.body.endDate) : sprint.endDate }
          : {}),
        ...("closed" in request.body ? { closed: request.body.closed } : {}),
        ...("closedAt" in request.body
          ? { closedAt: request.body.closedAt ? new Date(request.body.closedAt) : null }
          : {}),
      },
    });

    response.json({ item: serializeDevSprint(updated) });
  },
);
