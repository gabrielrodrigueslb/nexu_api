import { createApp } from "./app.js";
import { env } from "./config/env.js";
import { prisma } from "./lib/prisma.js";

const app = createApp();

const server = app.listen(env.PORT, () => {
  console.log(`API rodando na porta ${env.PORT}`);
});

async function shutdown(signal) {
  console.log(`Recebido ${signal}. Encerrando API...`);
  server.close(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
