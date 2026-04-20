import { Router } from "express";

import { prisma } from "../lib/prisma.js";

export const healthRouter = Router();

healthRouter.get("/", (_request, response) => {
  response.json({
    status: "ok",
    service: "nexu-api",
    now: new Date().toISOString(),
  });
});

healthRouter.get("/ready", async (_request, response, next) => {
  try {
    await prisma.$queryRawUnsafe("SELECT 1");
    response.json({ status: "ready" });
  } catch (error) {
    next(error);
  }
});
