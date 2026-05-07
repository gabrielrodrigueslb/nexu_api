import fs from "node:fs";
import path from "node:path";

import { prisma } from "../src/lib/prisma.js";
import { parseImportedClientsFile } from "../src/lib/client-import.js";
import { toCents } from "../src/lib/money.js";
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
      "Informe o caminho da planilha. Ex.: node scripts/import-instances-workbook.js C:\\caminho\\instances.xlsx --apply",
    );
  }

  const absolutePath = path.resolve(file);
  const fileBuffer = fs.readFileSync(absolutePath);
  const importedRecords = await parseImportedClientsFile({
    fileName: path.basename(absolutePath),
    fileBuffer,
  });

  if (!importedRecords.length) {
    throw new Error("A planilha não possui registros válidos para importar.");
  }

  const [users, existingPlans, existingTickets] = await Promise.all([
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

  const fallbackUser =
    users.find((user) => user.name === "Gabriel Admin") ||
    users.find((user) => user.isActive) ||
    users[0];

  if (!fallbackUser) {
    throw new Error("Nenhum usuário disponível para vincular a importação.");
  }

  const uniquePlans = buildUniqueImportedPlans(importedRecords);
  const draftsToCreate = buildPlanDraftsToCreate(uniquePlans, existingPlans);
  const plansByLowerName = new Map(existingPlans.map((plan) => [plan.name.toLowerCase(), plan]));
  let createdPlans = 0;

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
      plansByLowerName.set(created.name.toLowerCase(), created);
      createdPlans += 1;
    }
  } else {
    for (const draft of draftsToCreate) {
      plansByLowerName.set(draft.name.toLowerCase(), {
        id: null,
        name: draft.name,
        slug: draft.slug,
      });
    }
    createdPlans = draftsToCreate.length;
  }

  const existingByCode = new Map(existingTickets.map((ticket) => [ticket.code, ticket]));
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
      plansByLowerName.get(String(record.plan || "").trim().toLowerCase()) || null;

    const nextData = {
      company: record.company,
      cnpj: record.cnpj || null,
      instance: record.instance || null,
      plan: linkedPlan?.name || record.plan || null,
      planId: linkedPlan?.id || null,
      type: "novo",
      status: record.status,
      setupInCents: 0,
      recurringInCents: toCents(record.monthlyCost || 0),
      createdById: fallbackUser.id,
      assigneeId: assignee.id,
      technicalAssigneeId: null,
      completedAt: record.status === "concluido" ? new Date() : null,
      canceledAt: record.status === "cancelado" ? new Date() : null,
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

  if (apply) {
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
  }

  console.log(
    JSON.stringify(
      {
        mode: apply ? "apply" : "dry-run",
        file: absolutePath,
        processed: importedRecords.length,
        createdPlans,
        created,
        updated,
        unchanged,
        samplePlansToCreate: draftsToCreate.slice(0, 10).map((item) => ({
          name: item.name,
          monthlyFee: item.monthlyFeeInCents / 100,
          includedAgents: item.includedAgents,
          includedSupervisors: item.includedSupervisors,
          includedAdmins: item.includedAdmins,
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
