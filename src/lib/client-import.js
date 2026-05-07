import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

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

async function parseCsvFile(filePath) {
  const contents = await fs.readFile(filePath, "utf8");
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

async function parseWorkbookFile(filePath) {
  const script = `
import json, re, sys, unicodedata
import openpyxl

path = sys.argv[1]
wb = openpyxl.load_workbook(path, data_only=True)
ws = wb[wb.sheetnames[0]]
rows = list(ws.iter_rows(values_only=True))
records = []

def normalize_header(value):
    raw = unicodedata.normalize('NFKD', str(value or ''))
    raw = raw.encode('ascii', 'ignore').decode('ascii')
    return re.sub(r'[^a-z0-9]+', ' ', raw.lower()).strip()

def map_status(value):
    raw = str(value or '').strip()
    if raw == 'Ativa':
        return 'concluido'
    if raw in ('Cancelada', 'Em cancelamento'):
        return 'cancelado'
    if raw == 'Trial':
        return 'em_implantacao'
    raise ValueError(f'Status não mapeado: {raw}')

def normalize_instance(value):
    raw = str(value or '').strip().lower()
    raw = re.sub(r'^https?://', '', raw)
    raw = raw.lstrip('@').rstrip('/')
    if not raw:
        return None
    if raw.endswith('.atenderbem.com'):
        return raw
    return f'{raw}.atenderbem.com'

def get_value(row, header_map, *aliases):
    for alias in aliases:
        idx = header_map.get(alias)
        if idx is None:
            continue
        if idx < len(row):
            return row[idx]
    return None

if not rows:
    print('[]')
    raise SystemExit(0)

header_map = {
    normalize_header(value): index
    for index, value in enumerate(rows[0])
}

for row in rows[1:]:
    instance_name = get_value(row, header_map, 'instancia')
    instance = normalize_instance(instance_name)
    identifier = get_value(row, header_map, 'id', 'codigo', 'protocolo')
    status_value = get_value(row, header_map, 'assinatura', 'status')
    company = str(instance_name or '').strip().lower()

    if not instance or not identifier or not status_value or not company:
        continue

    document = str(get_value(row, header_map, 'documento', 'cnpj', 'cpf cnpj') or '').strip()
    plan = str(get_value(row, header_map, 'plano') or '').strip() or None
    monthly_cost = float(get_value(row, header_map, 'custo mensal medio', 'total') or 0)

    records.append({
        'code': f"INS-{int(identifier)}",
        'company': company,
        'cnpj': document or None,
        'instance': instance,
        'plan': plan,
        'status': map_status(status_value),
        'monthlyCost': monthly_cost,
        'assigneeName': None,
    })

print(json.dumps(records, ensure_ascii=False))
`;

  const { stdout } = await execFileAsync("python", ["-c", script, filePath], {
    maxBuffer: 50 * 1024 * 1024,
  });

  return JSON.parse(stdout);
}

export async function parseImportedClientsFile({ fileName, fileBuffer }) {
  const extension = path.extname(fileName || "").toLowerCase();
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "nexu-client-import-"));
  const tempPath = path.join(tempDir, `upload${extension || ".bin"}`);

  try {
    await fs.writeFile(tempPath, fileBuffer);

    if (extension === ".csv") {
      return parseCsvFile(tempPath);
    }

    if (extension === ".xlsx" || extension === ".xlsm") {
      return parseWorkbookFile(tempPath);
    }

    throw new Error("Formato não suportado. Envie um arquivo .csv ou .xlsx.");
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}
