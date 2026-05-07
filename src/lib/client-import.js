import path from "node:path";

import * as XLSX from "xlsx";

function normalizeTicketStatus(value) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();

  if (normalized === "ag. pagamento") return "pendente_financeiro";
  if (normalized === "pag. confirmado") return "pagamento_confirmado";
  if (normalized === "em implantação" || normalized === "em implantacao") return "em_implantacao";
  if (normalized === "implantado" || normalized === "ativa") return "concluido";
  if (normalized === "cancelado" || normalized === "cancelada" || normalized === "em cancelamento") {
    return "cancelado";
  }
  if (normalized === "trial") return "em_implantacao";

  throw new Error(`Status não reconhecido para importação: ${value}`);
}

function parseCsvLine(line) {
  return line
    .split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/)
    .map((cell) => cell.trim().replace(/^"|"$/g, "").replace(/""/g, '"'));
}

function toNumber(value) {
  const normalized = String(value || "")
    .replace(/\./g, "")
    .replace(",", ".")
    .trim();
  const parsed = Number(normalized);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function normalizeInstanceDomain(value) {
  const trimmed = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^@/, "")
    .replace(/\/+$/, "");

  if (!trimmed) return null;

  return trimmed.endsWith(".atenderbem.com") ? trimmed : `${trimmed}.atenderbem.com`;
}

function normalizeHeader(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function getWorkbookCell(row, headerMap, ...aliases) {
  for (const alias of aliases) {
    const key = normalizeHeader(alias);
    const index = headerMap.get(key);
    if (index === undefined) continue;
    return row[index];
  }

  return null;
}

function normalizeCsvRecord(record) {
  return {
    code: record.Protocolo,
    company: record.Empresa,
    cnpj: record.Documento || null,
    instance: normalizeInstanceDomain(record.Instancia),
    plan: record.Plano || null,
    status: normalizeTicketStatus(record.Status),
    monthlyCost: toNumber(record.Total),
    assigneeName: record.Responsavel || null,
  };
}

function parseCsvBuffer(fileBuffer) {
  const contents = fileBuffer.toString("utf8");
  const lines = contents
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length <= 1) {
    return [];
  }

  const header = parseCsvLine(lines[0]);
  const rows = lines.slice(1).map((line) => parseCsvLine(line));

  return rows.map((row) => {
    const item = Object.fromEntries(header.map((key, index) => [key, row[index] || ""]));
    return normalizeCsvRecord(item);
  });
}

function parseWorkbookBuffer(fileBuffer) {
  const workbook = XLSX.read(fileBuffer, {
    type: "buffer",
    cellDates: true,
  });
  const firstSheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[firstSheetName];
  const rows = XLSX.utils.sheet_to_json(worksheet, {
    header: 1,
    raw: false,
    defval: null,
  });

  if (!rows.length) {
    return [];
  }

  const headerMap = new Map(rows[0].map((value, index) => [normalizeHeader(value), index]));
  const records = [];

  for (const row of rows.slice(1)) {
    const instanceName = getWorkbookCell(row, headerMap, "Instância");
    const identifier = getWorkbookCell(row, headerMap, "ID", "Código", "Protocolo");
    const statusValue = getWorkbookCell(row, headerMap, "Assinatura", "Status");
    const company = String(instanceName || "")
      .trim()
      .toLowerCase();
    const instance = normalizeInstanceDomain(instanceName);

    if (!instance || !identifier || !statusValue || !company) {
      continue;
    }

    records.push({
      code: `INS-${Number(identifier)}`,
      company,
      cnpj: String(getWorkbookCell(row, headerMap, "Documento", "CNPJ", "CPF/CNPJ") || "").trim() || null,
      instance,
      plan: String(getWorkbookCell(row, headerMap, "Plano") || "").trim() || null,
      status: normalizeTicketStatus(statusValue),
      monthlyCost: toNumber(getWorkbookCell(row, headerMap, "Custo Mensal Médio", "Total")),
      assigneeName: null,
    });
  }

  return records;
}

export async function parseImportedClientsFile({ fileName, fileBuffer }) {
  const extension = path.extname(fileName || "").toLowerCase();

  if (extension === ".csv") {
    return parseCsvBuffer(fileBuffer);
  }

  if (extension === ".xlsx" || extension === ".xlsm") {
    return parseWorkbookBuffer(fileBuffer);
  }

  throw new Error("Formato não suportado. Envie um arquivo .csv ou .xlsx.");
}
