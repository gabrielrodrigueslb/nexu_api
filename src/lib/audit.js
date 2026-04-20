import { prisma } from "./prisma.js";

export async function writeAuditLog({
  actorUserId,
  action,
  entityType,
  entityId,
  ipAddress,
  userAgent,
  metadata,
}) {
  return prisma.auditLog.create({
    data: {
      actorUserId,
      action,
      entityType,
      entityId,
      ipAddress,
      userAgent,
      metadata: metadata ? JSON.stringify(metadata) : null,
    },
  });
}
