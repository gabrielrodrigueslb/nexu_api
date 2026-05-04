import fs from "node:fs/promises";
import path from "node:path";

import { prisma } from "../src/lib/prisma.js";

function toCents(value) {
  const numberValue = Number(value);
  if (Number.isNaN(numberValue)) {
    throw new Error(`Valor monetário inválido: ${value}`);
  }

  return Math.round(numberValue * 100);
}

async function main() {
  const jsonPath = process.argv[2];
  const startArg = Number(process.argv[3] || 0);
  const limitArg = Number(process.argv[4] || 0);

  if (!jsonPath) {
    throw new Error("Informe o caminho do JSON normalizado.");
  }

  const absolutePath = path.resolve(jsonPath);
  const records = JSON.parse(await fs.readFile(absolutePath, "utf8"));

  if (!Array.isArray(records) || !records.length) {
    throw new Error("O JSON informado não possui registros para importar.");
  }

  const slicedRecords =
    limitArg > 0 ? records.slice(startArg, startArg + limitArg) : records.slice(startArg);

  if (!slicedRecords.length) {
    throw new Error("O recorte solicitado não possui registros para importar.");
  }

  const users = await prisma.user.findMany({
    select: { id: true, name: true, isActive: true },
  });
  const plans = await prisma.plan.findMany({
    select: { id: true, name: true },
  });

  const fallbackUser =
    users.find((user) => user.name === "Gabriel Admin") ||
    users.find((user) => user.isActive) ||
    users[0];

  if (!fallbackUser) {
    throw new Error("Nenhum usuário encontrado para vincular os registros importados.");
  }

  const existingTickets = await prisma.ticket.findMany({
    where: {
      code: {
        in: slicedRecords.map((record) => record.code),
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
      paymentMethod: true,
      installment: true,
      setupInCents: true,
      recurringInCents: true,
      createdById: true,
      assigneeId: true,
      technicalAssigneeId: true,
    },
  });

  const existingByCode = new Map(existingTickets.map((ticket) => [ticket.code, ticket]));
  let created = 0;
  let updated = 0;
  let unchanged = 0;

  for (const record of slicedRecords) {
    const assignee =
      users.find((user) => user.name === record.assigneeName && user.isActive) ||
      users.find((user) => user.name === record.assigneeName) ||
      fallbackUser;
    const linkedPlan =
      plans.find((plan) => plan.name === record.plan) ||
      plans.find((plan) => plan.name.toLowerCase() === String(record.plan || "").toLowerCase()) ||
      null;

    const data = {
      code: record.code,
      company: record.company,
      cnpj: record.cnpj || null,
      instance: record.instance || null,
      plan: record.plan || null,
      planId: linkedPlan?.id || null,
      type: "novo",
      status: record.status,
      paymentMethod: null,
      installment: null,
      setupInCents: 0,
      recurringInCents: toCents(record.monthlyCost || 0),
      createdById: fallbackUser.id,
      assigneeId: assignee.id,
      technicalAssigneeId: null,
      completedAt: record.status === "concluido" ? new Date() : null,
      canceledAt: record.status === "cancelado" ? new Date() : null,
    };

    const existing = existingByCode.get(record.code);

    if (existing) {
      const hasChanges =
        existing.company !== data.company ||
        (existing.cnpj || null) !== data.cnpj ||
        (existing.instance || null) !== data.instance ||
        (existing.plan || null) !== data.plan ||
        (existing.planId || null) !== data.planId ||
        existing.type !== data.type ||
        existing.status !== data.status ||
        (existing.paymentMethod || null) !== data.paymentMethod ||
        (existing.installment || null) !== data.installment ||
        existing.setupInCents !== data.setupInCents ||
        existing.recurringInCents !== data.recurringInCents ||
        existing.createdById !== data.createdById ||
        existing.assigneeId !== data.assigneeId ||
        (existing.technicalAssigneeId || null) !== data.technicalAssigneeId;

      if (!hasChanges) {
        unchanged += 1;
        continue;
      }

      await prisma.ticket.update({
        where: { code: record.code },
        data,
      });
      updated += 1;
    } else {
      await prisma.ticket.upsert({
        where: { code: record.code },
        update: data,
        create: data,
      });
      created += 1;
    }
  }

  console.log(
    JSON.stringify(
      {
        jsonPath: absolutePath,
        processed: slicedRecords.length,
        start: startArg,
        limit: limitArg || null,
        created,
        updated,
        unchanged,
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
