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
  const normalizedEntityId =
    entityId === null || entityId === undefined || entityId === ""
      ? "system"
      : String(entityId);

  return prisma.auditLog.create({
    data: {
      action,
      entityType,
      entityId: normalizedEntityId,
      ipAddress,
      userAgent,
      metadata: metadata ? JSON.stringify(metadata) : null,
      ...(actorUserId
        ? {
            actor: {
              connect: {
                id: actorUserId,
              },
            },
          }
        : {}),
    },
  });
}
