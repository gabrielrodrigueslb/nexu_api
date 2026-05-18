import "dotenv/config";
import { defineConfig } from "prisma/config";

process.env.DATABASE_URL =
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@localhost:5432/nexu_next?schema=public";

export default defineConfig({
  schema: "prisma/schema.prisma",
  datasource: {
    url: process.env.DATABASE_URL,
  },
  migrations: {
    seed: "node prisma/seed.js",
  },
});
