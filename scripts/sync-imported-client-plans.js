import fs from "node:fs";
import path from "node:path";

import { prisma } from "../src/lib/prisma.js";
import { parseImportedClientsFile } from "../src/lib/client-import.js";
import {
  buildPlanDraftsToCreate,
  buildUniqueImportedPlans,
} from "./lib/imported-instance-plans.js";

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
      "Informe o caminho da planilha. Ex.: node scripts/sync-imported-client-plans.js C:\\caminho\\instances.xlsx --apply",
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

  const uniquePlans = buildUniqueImportedPlans(importedRecords);

  const [existingPlans, tickets] = await Promise.all([
    prisma.plan.findMany({
      select: {
        id: true,
        name: true,
        slug: true,
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
        plan: true,
        planId: true,
      },
    }),
  ]);

  const plansByLowerName = new Map(existingPlans.map((plan) => [plan.name.toLowerCase(), plan]));
  const draftsToCreate = buildPlanDraftsToCreate(uniquePlans, existingPlans);

  const createdPlans = [];
  if (apply) {
    for (const draft of draftsToCreate) {
      const created = await prisma.plan.create({
        data: draft,
        select: {
          id: true,
          name: true,
          slug: true,
        },
      });
      createdPlans.push(created);
      plansByLowerName.set(created.name.toLowerCase(), created);
    }
  } else {
    for (const draft of draftsToCreate) {
      createdPlans.push({
        id: null,
        name: draft.name,
        slug: draft.slug,
      });
      plansByLowerName.set(draft.name.toLowerCase(), {
        id: null,
        name: draft.name,
        slug: draft.slug,
      });
    }
  }

  const ticketsByCode = new Map(tickets.map((ticket) => [ticket.code, ticket]));
  const updates = [];

  for (const record of importedRecords) {
    const existing = ticketsByCode.get(record.code);
    if (!existing) continue;

    const linkedPlan = plansByLowerName.get(String(record.plan || "").trim().toLowerCase()) || null;
    if (!linkedPlan) continue;

    const nextPlanName = linkedPlan.name;
    const nextPlanId = linkedPlan.id;
    const hasChanges =
      (existing.plan || null) !== nextPlanName ||
      (existing.planId || null) !== (nextPlanId || null);

    if (!hasChanges) continue;

    updates.push({
      id: existing.id,
      code: existing.code,
      previousPlan: existing.plan,
      previousPlanId: existing.planId,
      nextPlan: nextPlanName,
      nextPlanId,
    });
  }

  if (apply) {
    for (let index = 0; index < updates.length; index += 50) {
      const chunk = updates.slice(index, index + 50);
      await prisma.$transaction(
        chunk.map((item) =>
          prisma.ticket.update({
            where: { id: item.id },
            data: {
              plan: item.nextPlan,
              planId: item.nextPlanId,
            },
          }),
        ),
      );
    }
  }

  console.log(
    JSON.stringify(
      {
        mode: apply ? "apply" : "dry-run",
        file: absolutePath,
        importedRecords: importedRecords.length,
        uniquePlans: uniquePlans.size,
        plansToCreate: draftsToCreate.length,
        ticketLinksToUpdate: updates.length,
        samplePlansToCreate: draftsToCreate.slice(0, 10).map((item) => ({
          name: item.name,
          monthlyFee: item.monthlyFeeInCents / 100,
          includedAgents: item.includedAgents,
          includedSupervisors: item.includedSupervisors,
          includedAdmins: item.includedAdmins,
          restrictions: item.restrictions,
        })),
        sampleTicketUpdates: updates.slice(0, 10).map((item) => ({
          code: item.code,
          previousPlan: item.previousPlan,
          nextPlan: item.nextPlan,
        })),
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
