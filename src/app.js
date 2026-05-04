import compression from "compression";
import cors from "cors";
import express from "express";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import hpp from "hpp";

import { env } from "./config/env.js";
import { requestContext } from "./middlewares/request-context.js";
import { errorHandler } from "./middlewares/error-handler.js";
import { notFound } from "./middlewares/not-found.js";
import { apiRouter } from "./routes/index.js";

export function createApp() {
  const app = express();

  app.disable("x-powered-by");
  app.set("trust proxy", env.TRUST_PROXY);

  app.use(requestContext);
  app.use(
    cors({
      origin(origin, callback) {
        if (!origin || env.corsOrigins.includes(origin)) {
          return callback(null, true);
        }

        return callback(new Error("CORS bloqueado"));
      },
      credentials: false,
      methods: ["GET", "POST", "PATCH", "DELETE"],
      allowedHeaders: ["Authorization", "Content-Type", "X-Request-Id"],
    }),
  );
  app.use(
    helmet({
      crossOriginResourcePolicy: false,
    }),
  );
  app.use(
    rateLimit({
      windowMs: env.RATE_LIMIT_WINDOW_MS,
      limit: env.RATE_LIMIT_MAX,
      standardHeaders: true,
      legacyHeaders: false,
    }),
  );
  app.use(hpp());
  app.use(compression());
  app.use(express.json({ limit: "25mb" }));
  app.use(express.urlencoded({ extended: false, limit: "50kb" }));

  app.use("/api", apiRouter);
  app.use(notFound);
  app.use(errorHandler);

  return app;
}
