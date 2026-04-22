import { Router } from "express";
import { z } from "zod";

import { writeAuditLog } from "../lib/audit.js";
import { TICKET_STATUSES, TICKET_TYPES } from "../lib/constants.js";
import { HttpError } from "../lib/http-error.js";
import { toCents } from "../lib/money.js";
import { buildPageMeta, getPagination } from "../lib/pagination.js";
import { prisma } from "../lib/prisma.js";
import { cuidSchema, paginationSchema } from "../lib/schemas.js";
import { serializeTicket } from "../lib/serializers.js";
import { moveEntityToTrash } from "../lib/trash.js";
import { authenticate } from "../middlewares/authenticate.js";
import { requireModuleAccess } from "../middlewares/require-module-access.js";
import { validate } from "../middlewares/validate.js";

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

const createTicketSchema = z.object({
  code: z.string().trim().min(4).max(40),
  leadId: cuidSchema.optional().nullable(),
  company: z.string().trim().min(2).max(160),
  cnpj: z.string().trim().max(24).optional().nullable(),
  contact: z.string().trim().max(120).optional().nullable(),
  email: z.string().email().optional().nullable(),
  phone: z.string().trim().max(40).optional().nullable(),
  instance: z.string().trim().max(80).optional().nullable(),
  plan: z.string().trim().max(80).optional().nullable(),
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
  lead: true,
  tasks: {
    include: {
      assignee: true,
    },
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
};

ticketsRouter.use(authenticate);

ticketsRouter.get(
  "/",
  requireModuleAccess("IMPLANTACAO", "view"),
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
      ...(request.query.assigneeId ? { assigneeId: request.query.assigneeId } : {}),
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
        orderBy: { createdAt: "desc" },
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
  "/:id",
  requireModuleAccess("IMPLANTACAO", "view"),
  validate({ params: z.object({ id: cuidSchema }) }),
  async (request, response) => {
    const ticket = await prisma.ticket.findUnique({
      where: { id: request.params.id },
      include: ticketInclude,
    });

    if (!ticket) {
      throw new HttpError(404, "Ticket não encontrado");
    }

    response.json({ item: serializeTicket(ticket) });
  },
);

ticketsRouter.post(
  "/",
  requireModuleAccess("IMPLANTACAO", "edit"),
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
        completedAt: request.body.completedAt ? new Date(request.body.completedAt) : null,
        canceledAt: request.body.status === "cancelado" ? new Date() : null,
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
      action: "TICKET_CREATE",
      entityType: "Ticket",
      entityId: ticket.id,
      ipAddress: response.locals.ipAddress,
      userAgent: response.locals.userAgent,
    });

    response.status(201).json({ item: serializeTicket(ticket) });
  },
);

ticketsRouter.patch(
  "/:id",
  requireModuleAccess("IMPLANTACAO", "edit"),
  validate({
    params: z.object({ id: cuidSchema }),
    body: updateTicketSchema,
  }),
  async (request, response) => {
    const existingTicket = await prisma.ticket.findUnique({
      where: { id: request.params.id },
    });

    if (!existingTicket) {
      throw new HttpError(404, "Ticket não encontrado");
    }

    const nextStatus = request.body.status || existingTicket.status;

    const ticket = await prisma.ticket.update({
      where: { id: request.params.id },
      data: {
        ...("code" in request.body ? { code: request.body.code } : {}),
        ...("leadId" in request.body ? { leadId: request.body.leadId } : {}),
        ...("company" in request.body ? { company: request.body.company } : {}),
        ...("cnpj" in request.body ? { cnpj: request.body.cnpj } : {}),
        ...("contact" in request.body ? { contact: request.body.contact } : {}),
        ...("email" in request.body ? { email: request.body.email } : {}),
        ...("phone" in request.body ? { phone: request.body.phone } : {}),
        ...("instance" in request.body ? { instance: request.body.instance } : {}),
        ...("plan" in request.body ? { plan: request.body.plan } : {}),
        ...("paymentMethod" in request.body
          ? { paymentMethod: request.body.paymentMethod }
          : {}),
        ...("installment" in request.body ? { installment: request.body.installment } : {}),
        ...("type" in request.body ? { type: request.body.type } : {}),
        ...("status" in request.body ? { status: request.body.status } : {}),
        ...("csStatus" in request.body ? { csStatus: request.body.csStatus } : {}),
        ...("notes" in request.body ? { notes: request.body.notes } : {}),
        ...("cancelReason" in request.body ? { cancelReason: request.body.cancelReason } : {}),
        ...("setupAmount" in request.body
          ? { setupInCents: toCents(request.body.setupAmount) }
          : {}),
        ...("recurringAmount" in request.body
          ? { recurringInCents: toCents(request.body.recurringAmount) }
          : {}),
        ...("assigneeId" in request.body ? { assigneeId: request.body.assigneeId } : {}),
        ...("technicalAssigneeId" in request.body
          ? { technicalAssigneeId: request.body.technicalAssigneeId }
          : {}),
        ...("completedAt" in request.body
          ? { completedAt: request.body.completedAt ? new Date(request.body.completedAt) : null }
          : {}),
        ...(nextStatus === "cancelado" ? { canceledAt: new Date() } : {}),
        ...(nextStatus === "concluido" && !existingTicket.completedAt
          ? { completedAt: new Date() }
          : {}),
      },
      include: ticketInclude,
    });

    await writeAuditLog({
      actorUserId: request.auth.userId,
      action: "TICKET_UPDATE",
      entityType: "Ticket",
      entityId: ticket.id,
      ipAddress: response.locals.ipAddress,
      userAgent: response.locals.userAgent,
      metadata: request.body,
    });

    response.json({ item: serializeTicket(ticket) });
  },
);

ticketsRouter.delete(
  "/:id",
  requireModuleAccess("IMPLANTACAO", "manage"),
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
      throw new HttpError(404, "Ticket não encontrado");
    }

    await prisma.$transaction(async (tx) => {
      await moveEntityToTrash({
        tx,
        moduleKey: "IMPLANTACAO",
        entityType: "Ticket",
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
  "/:id/tasks",
  requireModuleAccess("IMPLANTACAO", "edit"),
  validate({
    params: z.object({ id: cuidSchema }),
    body: ticketTaskSchema,
  }),
  async (request, response) => {
    const ticket = await prisma.ticket.findUnique({
      where: { id: request.params.id },
    });

    if (!ticket) {
      throw new HttpError(404, "Ticket não encontrado");
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
      action: "TICKET_TASK_CREATE",
      entityType: "TicketTask",
      entityId: task.id,
      ipAddress: response.locals.ipAddress,
      userAgent: response.locals.userAgent,
      metadata: { ticketId: ticket.id },
    });

    response.status(201).json({ item: task });
  },
);

ticketsRouter.post(
  "/:id/comments",
  requireModuleAccess("IMPLANTACAO", "edit"),
  validate({
    params: z.object({ id: cuidSchema }),
    body: ticketCommentSchema,
  }),
  async (request, response) => {
    const ticket = await prisma.ticket.findUnique({
      where: { id: request.params.id },
    });

    if (!ticket) {
      throw new HttpError(404, "Ticket não encontrado");
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
      action: "TICKET_COMMENT_CREATE",
      entityType: "TicketComment",
      entityId: comment.id,
      ipAddress: response.locals.ipAddress,
      userAgent: response.locals.userAgent,
      metadata: { ticketId: ticket.id },
    });

    response.status(201).json({ item: comment });
  },
);
