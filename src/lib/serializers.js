import { parseLeadMetadata } from "./lead-metadata.js";
import { fromCents } from "./money.js";

export function serializeUser(user) {
  if (!user) return null;

  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
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
    createdById: ticket.createdById,
    assigneeId: ticket.assigneeId,
    technicalAssigneeId: ticket.technicalAssigneeId,
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
    notes,
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
  const metadata = parseLeadMetadata(notes);

  return {
    ...rest,
    value: fromCents(valueInCents),
    notes,
    installment: metadata.installment || null,
    consultant: metadata.consultant || null,
    validUntil: metadata.validUntil || null,
    agents: metadata.agents || 0,
    supervisors: metadata.supervisors || 0,
    admins: metadata.admins || 0,
    observations: metadata.observations || null,
    representativeId: metadata.representativeId || null,
    representativeCommission: metadata.representativeCommission || 0,
    passThroughAmount: metadata.passThroughAmount || 0,
    lossReason: metadata.lossReason || null,
    generatedTicketId: ticket?.code || null,
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

export function serializeIndicatorPayment(payment) {
  if (!payment) return null;

  return {
    ...payment,
    amount: fromCents(payment.amountInCents),
    lead: payment.lead
      ? {
          id: payment.lead.id,
          company: payment.lead.company,
          wonAt: payment.lead.wonAt,
          seller: serializeUser(payment.lead.seller),
          ticket: payment.lead.ticket
            ? {
                id: payment.lead.ticket.id,
                code: payment.lead.ticket.code,
                setupAmount: fromCents(payment.lead.ticket.setupInCents),
              }
            : null,
        }
      : null,
    indicator: payment.indicator
      ? {
          id: payment.indicator.id,
          name: payment.indicator.name,
          percentSetup: payment.indicator.percentSetup,
        }
      : null,
    paidBy: serializeUser(payment.paidBy),
  };
}
