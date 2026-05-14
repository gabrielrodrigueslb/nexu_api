import { HttpError } from "./http-error.js";
import { prisma } from "./prisma.js";

export const TRASH_RETENTION_DAYS = 30;

export async function moveEntityToTrash({
  tx,
  moduleKey,
  entityType,
  entityId,
  label,
  payload,
  deletedById,
}) {
  return tx.trashItem.create({
    data: {
      moduleKey,
      entityType,
      entityId,
      label,
      payload: JSON.stringify(payload),
      deletedById,
    },
  });
}

export function getTrashExpiresAt(deletedAt) {
  const value = deletedAt instanceof Date ? deletedAt : new Date(deletedAt);
  return new Date(value.getTime() + TRASH_RETENTION_DAYS * 24 * 60 * 60 * 1000);
}

export async function purgeExpiredTrashItems(tx = prisma) {
  const threshold = new Date(Date.now() - TRASH_RETENTION_DAYS * 24 * 60 * 60 * 1000);
  return tx.trashItem.deleteMany({
    where: {
      deletedAt: {
        lt: threshold,
      },
    },
  });
}

export function parseTrashPayload(trashItem) {
  try {
    return JSON.parse(trashItem.payload);
  } catch {
    throw new HttpError(500, "Payload da lixeira corrompido");
  }
}

export async function getTrashItemOrThrow(id) {
  await purgeExpiredTrashItems();

  const item = await prisma.trashItem.findUnique({
    where: { id },
    include: {
      module: true,
    },
  });

  if (!item) {
    throw new HttpError(404, "Item não encontrado na lixeira");
  }

  return item;
}
