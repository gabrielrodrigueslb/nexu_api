import { Router } from "express";

import { accessRouter } from "./access.routes.js";
import { authRouter } from "./auth.routes.js";
import { catalogRouter } from "./catalog.routes.js";
import { healthRouter } from "./health.routes.js";
import { indicatorPaymentsRouter } from "./indicator-payments.routes.js";
import { leadsRouter } from "./leads.routes.js";
import { ticketsRouter } from "./tickets.routes.js";
import { trashRouter } from "./trash.routes.js";
import { usersRouter } from "./users.routes.js";

export const apiRouter = Router();

apiRouter.get("/", (_request, response) => {
  response.json({
    service: "nexu-api",
    version: "1.0.0",
  });
});

apiRouter.use("/health", healthRouter);
apiRouter.use("/auth", authRouter);
apiRouter.use("/access", accessRouter);
apiRouter.use("/users", usersRouter);
apiRouter.use("/catalog", catalogRouter);
apiRouter.use("/indicator-payments", indicatorPaymentsRouter);
apiRouter.use("/leads", leadsRouter);
apiRouter.use("/tickets", ticketsRouter);
apiRouter.use("/trash", trashRouter);
