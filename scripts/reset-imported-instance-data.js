import fs from "node:fs";
import path from "node:path";

import { prisma } from "../src/lib/prisma.js";
import { parseImportedClientsFile } from "../src/lib/client-import.js";
import { buildUniqueImportedPlans } from "./lib/imported-instance-plans.js";

function parseArgs(argv) {
  const args = {
    file: null,
    apply: false,
  };

  for (let index = 2; index < argv.length; index += 1) {
    const token = argv[index];

    if (token === "--apply") {
      args.apply = true;
      continue;
    }

    if (!args.file) {
      args.file = token;
    }
  }

  return args;
}

async function main() {
  const { file, apply } = parseArgs(process.argv);

  if (!file) {
    throw new Error(
      "Informe o caminho da planilha. Ex.: node scripts/reset-imported-instance-data.js C:\\caminho\\instances.xlsx --apply",
    );
  }

  const absolutePath = path.resolve(file);
  const fileBuffer = fs.readFileSync(absolutePath);
  const importedRecords = await parseImportedClientsFile({
    fileName: path.basename(absolutePath),
    fileBuffer,
  });

  if (!importedRecords.length) {
    throw new Error("A planilha não possui registros válidos.");
  }

  const codes = importedRecords.map((record) => record.code);
  const uniquePlans = buildUniqueImportedPlans(importedRecords);
  const planNames = [...uniquePlans.values()].map((item) => item.name);

  const [tickets, plans] = await Promise.all([
    prisma.ticket.findMany({
      where: {
        code: {
          in: codes,
        },
      },
      select: {
        id: true,
        code: true,
        planId: true,
      },
    }),
    prisma.plan.findMany({
      where: {
        name: {
          in: planNames,
        },
      },
      select: {
        id: true,
        name: true,
        _count: {
          select: {
            tickets: true,
            leads: true,
          },
        },
      },
    }),
  ]);

  const importedTicketCountsByPlanId = new Map();
  for (const ticket of tickets) {
    if (!ticket.planId) continue;
    importedTicketCountsByPlanId.set(
      ticket.planId,
      (importedTicketCountsByPlanId.get(ticket.planId) || 0) + 1,
    );
  }
  const plansToDelete = plans.filter((plan) => {
    const importedRefs = importedTicketCountsByPlanId.get(plan.id) || 0;
    const ticketRefsOutsideImport = plan._count.tickets - importedRefs;
    return ticketRefsOutsideImport <= 0 && plan._count.leads === 0;
  });

  if (apply) {
    if (tickets.length) {
      await prisma.ticket.deleteMany({
        where: {
          id: {
            in: tickets.map((ticket) => ticket.id),
          },
        },
      });
    }

    if (plansToDelete.length) {
      await prisma.plan.deleteMany({
        where: {
          id: {
            in: plansToDelete.map((plan) => plan.id),
          },
        },
      });
    }
  }

  console.log(
    JSON.stringify(
      {
        mode: apply ? "apply" : "dry-run",
        file: absolutePath,
        importedRecords: importedRecords.length,
        ticketsToDelete: tickets.length,
        plansMatched: plans.length,
        plansSafeToDelete: plansToDelete.length,
        sampleTickets: tickets.slice(0, 10).map((ticket) => ticket.code),
        samplePlansSafeToDelete: plansToDelete.slice(0, 10).map((plan) => plan.name),
      },
      null,
      2,
    ),
  );
}

main()
  .catch(async (error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
