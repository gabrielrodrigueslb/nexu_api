import { Router } from "express";
import { z } from "zod";

import { prisma } from "../lib/prisma.js";
import { authenticate } from "../middlewares/authenticate.js";
import { requireModuleAccess } from "../middlewares/require-module-access.js";
import { validate } from "../middlewares/validate.js";

export const overviewRouter = Router();

const querySchema = z.object({
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
});

function sumBy(items, pick) {
  return items.reduce((total, item) => total + pick(item), 0);
}

function countRows(values) {
  const counts = values.reduce((accumulator, value) => {
    if (!value) return accumulator;
    accumulator[value] = (accumulator[value] || 0) + 1;
    return accumulator;
  }, {});

  return Object.entries(counts).sort((left, right) => right[1] - left[1]);
}

function buildCreatedAtFilter(query) {
  if (!query.from && !query.to) return {};

  return {
    createdAt: {
      ...(query.from ? { gte: new Date(query.from) } : {}),
      ...(query.to ? { lte: new Date(query.to) } : {}),
    },
  };
}

function getDevPriorityBucket(ticket) {
  if (ticket.criticalBug) {
    return { label: "Crítica", tone: "red" };
  }

  if (ticket.complexity === "Complexa") {
    return { label: "Alta", tone: "orange" };
  }

  if (ticket.complexity === "Media") {
    return { label: "Média", tone: "yellow" };
  }

  return { label: "Baixa", tone: "green" };
}

overviewRouter.use(authenticate);

overviewRouter.get(
  "/",
  requireModuleAccess("DASHBOARD", "view"),
  validate({ query: querySchema }),
  async (request, response) => {
    const whereByCreatedAt = buildCreatedAtFilter(request.query);

    const [leads, tickets, devTickets] = await Promise.all([
      prisma.lead.findMany({
        where: whereByCreatedAt,
        include: {
          seller: true,
          catalogItems: {
            include: {
              catalogItem: true,
            },
          },
        },
      }),
      prisma.ticket.findMany({
        where: whereByCreatedAt,
        include: {
          assignee: true,
          lead: {
            include: {
              seller: true,
              catalogItems: {
                include: {
                  catalogItem: true,
                },
              },
            },
          },
        },
      }),
      prisma.devTicket.findMany({
        where: whereByCreatedAt,
        select: {
          id: true,
          complexity: true,
          criticalBug: true,
          devStatus: true,
        },
      }),
    ]);

    const approvedTickets = tickets.filter((ticket) =>
      ["pagamento_confirmado", "em_implantacao", "concluido"].includes(ticket.status),
    );
    const pendingTickets = tickets.filter((ticket) => ticket.status === "pendente_financeiro");
    const canceledTickets = tickets.filter((ticket) => ticket.status === "cancelado");
    const pipelineLeads = leads.filter((lead) =>
      [
        "Qualificados",
        "Oportunidade Futura",
        "Apresentacao",
        "No Show",
        "Em Negociacao",
      ].includes(lead.status),
    );

    const expectedSetup = sumBy(tickets, (ticket) => ticket.setupInCents / 100);
    const expectedRecurring = sumBy(tickets, (ticket) => ticket.recurringInCents / 100);
    const approvedSetup = sumBy(approvedTickets, (ticket) => ticket.setupInCents / 100);
    const approvedRecurring = sumBy(approvedTickets, (ticket) => ticket.recurringInCents / 100);
    const pendingSetup = sumBy(pendingTickets, (ticket) => ticket.setupInCents / 100);
    const pendingRecurring = sumBy(pendingTickets, (ticket) => ticket.recurringInCents / 100);

    const productRows = countRows(
      tickets.flatMap((ticket) =>
        (ticket.lead?.catalogItems || [])
          .filter((item) => item.enabled && item.catalogItem.type === "PRODUCT")
          .map((item) => item.catalogItem.name),
      ),
    );
    const integrationRows = countRows(
      tickets.flatMap((ticket) =>
        (ticket.lead?.catalogItems || [])
          .filter((item) => item.enabled && item.catalogItem.type === "INTEGRATION")
          .map((item) => item.catalogItem.name),
      ),
    );

    const rankingMap = tickets.reduce((accumulator, ticket) => {
      const ownerName = ticket.lead?.seller?.name || ticket.assignee?.name || "Sem responsavel";
      const current = accumulator[ownerName] || {
        name: ownerName,
        tickets: 0,
        setup: 0,
        recurring: 0,
      };

      current.tickets += 1;
      current.setup += ticket.setupInCents / 100;
      current.recurring += ticket.recurringInCents / 100;
      accumulator[ownerName] = current;
      return accumulator;
    }, {});

    const devPriorityRows = countRows(devTickets.map((ticket) => getDevPriorityBucket(ticket).label));
    const devPriorityToneMap = Object.fromEntries(
      devTickets.map((ticket) => {
        const bucket = getDevPriorityBucket(ticket);
        return [bucket.label, bucket.tone];
      }),
    );
    const devPriorityMeta = devPriorityRows.map(([label, count]) => ({
      label,
      count,
      tone: devPriorityToneMap[label] || "gray",
    }));

    response.json({
      totals: {
        expectedSetup,
        expectedRecurring,
        expectedTotal: expectedSetup + expectedRecurring,
        approvedSetup,
        approvedRecurring,
        approvedTotal: approvedSetup + approvedRecurring,
        pendingSetup,
        pendingRecurring,
        pendingTotal: pendingSetup + pendingRecurring,
        totalCommercialTickets: tickets.length,
        newClientsCount: tickets.filter((ticket) => ticket.type === "novo").length,
        upsellCount: tickets.filter((ticket) => ticket.type === "upsell").length,
        totalDevTickets: devTickets.length,
        criticalDevCount: devTickets.filter((ticket) => ticket.criticalBug).length,
      },
      charts: {
        products: productRows,
        integrations: integrationRows,
        ranking: Object.values(rankingMap).sort(
          (left, right) =>
            right.setup + right.recurring - (left.setup + left.recurring),
        ),
        commercialStatuses: [
          {
            label: "Leads recebidos",
            count: leads.filter((lead) => lead.status === "Leads").length,
            tone: "gray",
          },
          {
            label: "Em qualificacao",
            count: pipelineLeads.length,
            tone: "blue",
          },
          {
            label: "Aguardando aprovacao",
            count: pendingTickets.length,
            tone: "orange",
          },
          {
            label: "Aprovados",
            count: approvedTickets.length,
            tone: "green",
          },
          {
            label: "Perdidos / cancelados",
            count: leads.filter((lead) => lead.status === "Perdido").length + canceledTickets.length,
            tone: "red",
          },
        ],
        devPriorities: devPriorityMeta,
      },
    });
  },
);
