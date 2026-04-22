import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const databaseUrl = process.env.DATABASE_URL || "file:./dev.db";
const relativePath = databaseUrl.replace(/^file:/, "");
const databasePath = path.resolve(__dirname, relativePath);
const journalPath = `${databasePath}-journal`;
const force = process.argv.includes("--force");
const prismaCliPath = path.resolve(__dirname, "../node_modules/prisma/build/index.js");

function normalizeDatabaseUrl(rawDatabaseUrl) {
  if (!rawDatabaseUrl?.startsWith("file:")) {
    return rawDatabaseUrl;
  }

  const sqlitePath = rawDatabaseUrl.slice("file:".length);

  if (!sqlitePath) {
    return rawDatabaseUrl;
  }

  const resolvedPath = path.isAbsolute(sqlitePath)
    ? sqlitePath
    : path.resolve(__dirname, sqlitePath);

  return `file:${resolvedPath.replace(/\\/g, "/")}`;
}

const normalizedDatabaseUrl = normalizeDatabaseUrl(databaseUrl);
const normalizedDatabasePath = normalizedDatabaseUrl.replace(/^file:/, "");

function sqliteTableExists(tableName) {
  if (!fs.existsSync(normalizedDatabasePath) || fs.statSync(normalizedDatabasePath).size === 0) {
    return false;
  }

  const probe = spawnSync(
    process.execPath,
    [
      prismaCliPath,
      "db",
      "execute",
      "--stdin",
      "--schema",
      path.join(__dirname, "schema.prisma"),
    ],
    {
      cwd: path.resolve(__dirname, ".."),
      env: {
        ...process.env,
        DATABASE_URL: normalizedDatabaseUrl,
      },
      input: `SELECT name FROM sqlite_master WHERE type = 'table' AND name = '${tableName}';`,
      encoding: "utf8",
    },
  );

  return probe.status === 0 && probe.stdout.includes(tableName);
}

if (fs.existsSync(normalizedDatabasePath) && !force && sqliteTableExists("User")) {
  console.log(
    `Banco ja inicializado em ${normalizedDatabasePath}. Use "npm run db:init -- --force" para recriar.`,
  );
  process.exit(0);
}

if (force) {
  try {
    fs.rmSync(normalizedDatabasePath, { force: true });
    fs.rmSync(`${normalizedDatabasePath}-journal`, { force: true });
  } catch (error) {
    if (error?.code !== "EBUSY") {
      throw error;
    }

    console.warn(`Nao foi possivel remover ${normalizedDatabasePath} porque o arquivo esta em uso. O schema sera reaplicado no arquivo atual.`);
  }
}

const result = spawnSync(
  process.execPath,
  [
    prismaCliPath,
    "db",
    "execute",
    "--file",
    path.join(__dirname, "init.sql"),
    "--schema",
    path.join(__dirname, "schema.prisma"),
  ],
  {
    cwd: path.resolve(__dirname, ".."),
    env: {
      ...process.env,
      DATABASE_URL: normalizedDatabaseUrl,
    },
    stdio: "inherit",
  },
);

if (result.status !== 0) {
  process.exit(result.status ?? 1);
}

console.log(`Banco SQLite inicializado em ${normalizedDatabasePath}`);
