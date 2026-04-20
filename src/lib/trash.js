import { HttpError } from "./http-error.js";
import { prisma } from "./prisma.js";

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

export function parseTrashPayload(trashItem) {
  try {
    return JSON.parse(trashItem.payload);
  } catch {
    throw new HttpError(500, "Payload da lixeira corrompido");
  }
}

export async function getTrashItemOrThrow(id) {
  const item = await prisma.trashItem.findUnique({
    where: { id },
    include: {
      module: true,
    },
  });

  if (!item) {
    throw new HttpError(404, "Item nao encontrado na lixeira");
  }

  return item;
}
