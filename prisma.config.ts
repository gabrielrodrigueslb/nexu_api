import "dotenv/config";
import path from "node:path";
import { defineConfig } from "prisma/config";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const prismaDirectory = path.resolve(__dirname, "prisma");

function normalizeDatabaseUrl(databaseUrl: string) {
  if (!databaseUrl.startsWith("file:")) {
    return databaseUrl;
  }

  const sqlitePath = databaseUrl.slice("file:".length);

  if (!sqlitePath) {
    return databaseUrl;
  }

  const resolvedPath = path.isAbsolute(sqlitePath)
    ? sqlitePath
    : path.resolve(prismaDirectory, sqlitePath);

  return `file:${resolvedPath.replace(/\\/g, "/")}`;
}

process.env.DATABASE_URL = normalizeDatabaseUrl(process.env.DATABASE_URL ?? "file:./dev.db");

export default defineConfig({
  schema: "prisma/schema.prisma",
  datasource: {
    url: process.env.DATABASE_URL,
  },
  migrations: {
    seed: "node prisma/seed.js",
  },
});
