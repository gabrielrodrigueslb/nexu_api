import fs from "node:fs/promises";
import path from "node:path";

import { prisma } from "../src/lib/prisma.js";

function parseCsvLine(line) {
  return line
    .split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/)
    .map((cell) => cell.trim().replace(/^"|"$/g, "").replace(/""/g, '"'));
}

function normalizeStatus(value) {
  const normalized = value.trim().toLowerCase();

  if (normalized === "ag. pagamento") return "pendente_financeiro";
  if (normalized === "pag. confirmado") return "pagamento_confirmado";
  if (normalized === "em implantação" || normalized === "em implantaã§ã£o") return "em_implantacao";
  if (normalized === "implantado") return "concluido";
  if (normalized === "cancelado") return "cancelado";

  throw new Error(`Status do CSV não reconhecido: ${value}`);
}

function toCentsFromCsvTotal(value) {
  const normalized = value.replace(/\./g, "").replace(",", ".").trim();
  const numberValue = Number(normalized);

  if (Number.isNaN(numberValue)) {
    throw new Error(`Total inválido no CSV: ${value}`);
  }

  return Math.round(numberValue * 100);
}

async function main() {
  const csvPath = process.argv[2];

  if (!csvPath) {
    throw new Error("Informe o caminho do CSV. Ex.: node scripts/import-clients-csv.js C:\\caminho\\clientes.csv");
  }

  const absolutePath = path.resolve(csvPath);
  const fileContents = await fs.readFile(absolutePath, "utf8");
  const lines = fileContents
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length <= 1) {
    throw new Error("O CSV não possui linhas de dados para importar.");
  }

  const [headerLine, ...dataLines] = lines;
  const header = parseCsvLine(headerLine);
  const expectedHeader = ["Protocolo", "Empresa", "Status", "Responsavel", "Instancia", "Total"];

  if (header.join("|") !== expectedHeader.join("|")) {
    throw new Error(`Cabeçalho inesperado. Recebido: ${header.join(", ")}`);
  }

  const users = await prisma.user.findMany({
    select: {
      id: true,
      name: true,
      isActive: true,
    },
  });

  const fallbackUser =
    users.find((user) => user.name === "Gabriel Admin") ||
    users.find((user) => user.isActive) ||
    users[0];

  if (!fallbackUser) {
    throw new Error("Nenhum usuário encontrado para vincular os registros importados.");
  }

  const existingTickets = await prisma.ticket.findMany({
    select: {
      id: true,
      code: true,
      setupInCents: true,
      recurringInCents: true,
      company: true,
      status: true,
      assigneeId: true,
      instance: true,
    },
  });

  const ticketsByCode = new Map(existingTickets.map((ticket) => [ticket.code, ticket]));
  let created = 0;
  let updated = 0;
  let unchanged = 0;

  for (const line of dataLines) {
    const [code, company, rawStatus, assigneeName, instance, rawTotal] = parseCsvLine(line);
    const status = normalizeStatus(rawStatus);
    const assignee =
      users.find((user) => user.name === assigneeName && user.isActive) ||
      users.find((user) => user.name === assigneeName) ||
      fallbackUser;
    const totalInCents = toCentsFromCsvTotal(rawTotal);
    const existing = ticketsByCode.get(code);

    if (existing) {
      const nextData = {
        company,
        status,
        assigneeId: assignee.id,
        instance: instance || null,
      };

      const shouldBackfillTotal =
        existing.setupInCents + existing.recurringInCents === 0;

      const hasBaseChanges =
        existing.company !== nextData.company ||
        existing.status !== nextData.status ||
        existing.assigneeId !== nextData.assigneeId ||
        (existing.instance || null) !== nextData.instance;

      if (hasBaseChanges || shouldBackfillTotal) {
        await prisma.ticket.update({
          where: { id: existing.id },
          data: {
            ...nextData,
            ...(shouldBackfillTotal
              ? {
                  setupInCents: 0,
                  recurringInCents: totalInCents,
                }
              : {}),
          },
        });
        updated += 1;
      } else {
        unchanged += 1;
      }

      continue;
    }

    await prisma.ticket.create({
      data: {
        code,
        company,
        status,
        type: "novo",
        instance: instance || null,
        createdById: fallbackUser.id,
        assigneeId: assignee.id,
        technicalAssigneeId: null,
        setupInCents: 0,
        recurringInCents: totalInCents,
      },
    });
    created += 1;
  }

  console.log(
    JSON.stringify(
      {
        csvPath: absolutePath,
        processed: dataLines.length,
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
