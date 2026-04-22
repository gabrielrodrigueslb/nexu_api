import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const prismaDirectory = path.resolve(__dirname, "../../prisma");

function normalizeDatabaseUrl(databaseUrl) {
  if (!databaseUrl?.startsWith("file:")) {
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

process.env.DATABASE_URL = normalizeDatabaseUrl(process.env.DATABASE_URL || "file:./dev.db");

const isProduction = process.env.NODE_ENV === "production";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3333),
  DATABASE_URL: z.string().min(1).default(process.env.DATABASE_URL),
  CORS_ORIGINS: z.string().default("http://localhost:3000"),
  TRUST_PROXY: z.coerce.number().int().min(0).default(0),
  JWT_ISSUER: z.string().min(1).default("nexu-api"),
  JWT_AUDIENCE: z.string().min(1).default("nexu-clients"),
  JWT_ACCESS_SECRET: z
    .string()
    .min(32, "JWT_ACCESS_SECRET deve ter ao menos 32 caracteres")
    .default("desenvolvimento-apenas-troque-esta-chave-por-uma-chave-real-segura"),
  ACCESS_TOKEN_TTL: z.string().min(2).default("15m"),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).max(30).default(7),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().min(60000).default(15 * 60 * 1000),
  RATE_LIMIT_MAX: z.coerce.number().int().min(10).default(200),
  AUTH_RATE_LIMIT_MAX: z.coerce.number().int().min(3).default(10),
  MAX_LOGIN_ATTEMPTS: z.coerce.number().int().min(3).max(20).default(5),
  ACCOUNT_LOCK_MINUTES: z.coerce.number().int().min(1).max(1440).default(15),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("Falha ao validar variaveis de ambiente", parsed.error.flatten().fieldErrors);
  process.exit(1);
}

if (isProduction && parsed.data.JWT_ACCESS_SECRET.includes("desenvolvimento-apenas")) {
  console.error("JWT_ACCESS_SECRET precisa ser trocada em producao.");
  process.exit(1);
}

process.env.NODE_ENV ??= parsed.data.NODE_ENV;
process.env.DATABASE_URL ??= parsed.data.DATABASE_URL;

export const env = {
  ...parsed.data,
  isProduction,
  corsOrigins: parsed.data.CORS_ORIGINS.split(",")
    .map((item) => item.trim())
    .filter(Boolean),
};
