import crypto from "node:crypto";

export function requestContext(request, response, next) {
  response.locals.requestId = request.headers["x-request-id"] || crypto.randomUUID();
  response.locals.ipAddress =
    request.ip ||
    request.headers["x-forwarded-for"]?.toString().split(",")[0]?.trim() ||
    "unknown";
  response.locals.userAgent = request.headers["user-agent"] || "unknown";
  response.setHeader("x-request-id", response.locals.requestId);
  next();
}
