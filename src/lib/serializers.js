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

  const metadata = parseLeadMetadata(lead.notes);

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
    planId: lead.planId || null,
    plan: lead.plan
      ? {
          id: lead.plan.id,
          name: lead.plan.name,
          description: lead.plan.description || null,
          setupFee: fromCents(lead.plan.setupFeeInCents),
          monthlyFee: fromCents(lead.plan.monthlyFeeInCents),
          includedAgents: lead.plan.includedAgents,
          includedSupervisors: lead.plan.includedSupervisors,
          includedAdmins: lead.plan.includedAdmins,
          features: lead.plan.features || null,
          restrictions: lead.plan.restrictions || null,
          active: lead.plan.active,
        }
      : null,
    wonAt: lead.wonAt,
    lostAt: lead.lostAt,
    createdAt: lead.createdAt,
    updatedAt: lead.updatedAt,
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
    seller: serializeUser(lead.seller),
    sdr: serializeUser(lead.sdr),
    origin: lead.origin || null,
    indicator: lead.indicator || null,
    tasks: lead.tasks || [],
    comments: lead.comments?.map((comment) => ({
      ...comment,
      author: serializeUser(comment.author),
    })) || [],
    catalogItems: lead.catalogItems || [],
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
    plan,
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
    plan: plan
      ? {
          id: plan.id,
          name: plan.name,
          description: plan.description || null,
          setupFee: fromCents(plan.setupFeeInCents),
          monthlyFee: fromCents(plan.monthlyFeeInCents),
          includedAgents: plan.includedAgents,
          includedSupervisors: plan.includedSupervisors,
          includedAdmins: plan.includedAdmins,
          features: plan.features || null,
          restrictions: plan.restrictions || null,
          active: plan.active,
        }
      : null,
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
    linkedPlan,
    lead,
    tasks,
    comments,
    ...rest
  } = ticket;

  return {
    ...rest,
    setupAmount: fromCents(setupInCents),
    recurringAmount: fromCents(recurringInCents),
    plan: linkedPlan?.name || rest.plan || null,
    planId: rest.planId || lead?.planId || null,
    linkedPlan: linkedPlan
      ? {
          id: linkedPlan.id,
          name: linkedPlan.name,
          description: linkedPlan.description || null,
          setupFee: fromCents(linkedPlan.setupFeeInCents),
          monthlyFee: fromCents(linkedPlan.monthlyFeeInCents),
          includedAgents: linkedPlan.includedAgents,
          includedSupervisors: linkedPlan.includedSupervisors,
          includedAdmins: linkedPlan.includedAdmins,
          features: linkedPlan.features || null,
          restrictions: linkedPlan.restrictions || null,
          active: linkedPlan.active,
        }
      : null,
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
