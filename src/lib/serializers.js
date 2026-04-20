import { normalizeRole } from "./access-control.js";
import { fromCents } from "./money.js";

export function serializeUser(user) {
  if (!user) return null;

  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: normalizeRole(user.role),
    sector: user.sector,
    accessPresetId: user.accessPresetId || null,
    isActive: user.isActive,
    lastLoginAt: user.lastLoginAt,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

function serializeLeadReference(lead) {
  if (!lead) return null;

  return {
    id: lead.id,
    company: lead.company,
    cnpj: lead.cnpj,
    contact: lead.contact,
    email: lead.email,
    phone: lead.phone,
    status: lead.status,
    value: fromCents(lead.valueInCents),
    paymentMethod: lead.paymentMethod,
    isLite: lead.isLite,
    wonAt: lead.wonAt,
    lostAt: lead.lostAt,
    createdAt: lead.createdAt,
    updatedAt: lead.updatedAt,
  };
}

function serializeTicketReference(ticket) {
  if (!ticket) return null;

  return {
    id: ticket.id,
    code: ticket.code,
    leadId: ticket.leadId,
    company: ticket.company,
    status: ticket.status,
    type: ticket.type,
    csStatus: ticket.csStatus,
    setupAmount: fromCents(ticket.setupInCents),
    recurringAmount: fromCents(ticket.recurringInCents),
    createdAt: ticket.createdAt,
    updatedAt: ticket.updatedAt,
    completedAt: ticket.completedAt,
    canceledAt: ticket.canceledAt,
  };
}

export function serializeLead(lead) {
  const {
    valueInCents,
    seller,
    sdr,
    origin,
    indicator,
    tasks,
    comments,
    catalogItems,
    createdBy,
    ticket,
    ...rest
  } = lead;

  return {
    ...rest,
    value: fromCents(valueInCents),
    seller: serializeUser(seller),
    sdr,
    origin,
    indicator,
    tasks,
    comments: comments?.map((comment) => ({
      ...comment,
      author: serializeUser(comment.author),
    })),
    catalogItems,
    createdBy: serializeUser(createdBy),
    ticket: serializeTicketReference(ticket),
  };
}

export function serializeTicket(ticket) {
  const {
    setupInCents,
    recurringInCents,
    createdBy,
    assignee,
    technicalAssignee,
    lead,
    tasks,
    comments,
    ...rest
  } = ticket;

  return {
    ...rest,
    setupAmount: fromCents(setupInCents),
    recurringAmount: fromCents(recurringInCents),
    createdBy: serializeUser(createdBy),
    assignee: serializeUser(assignee),
    technicalAssignee: serializeUser(technicalAssignee),
    lead: serializeLeadReference(lead),
    tasks: tasks?.map((task) => ({
      ...task,
      assignee: serializeUser(task.assignee),
    })),
    comments: comments?.map((comment) => ({
      ...comment,
      author: serializeUser(comment.author),
    })),
  };
}
