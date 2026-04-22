import { Router } from "express";
import { z } from "zod";

import { writeAuditLog } from "../lib/audit.js";
import { HttpError } from "../lib/http-error.js";
import { prisma } from "../lib/prisma.js";
import { cuidSchema, paginationSchema } from "../lib/schemas.js";
import { getTrashItemOrThrow, parseTrashPayload } from "../lib/trash.js";
import { authenticate } from "../middlewares/authenticate.js";
import { requireModuleAccess } from "../middlewares/require-module-access.js";
import { validate } from "../middlewares/validate.js";

export const trashRouter = Router();

const listTrashQuerySchema = paginationSchema.extend({
  q: z.string().trim().optional(),
  moduleKey: z.string().trim().min(2).optional(),
  entityType: z.string().trim().min(2).optional(),
});

function toTrashSummary(item) {
  return {
    id: item.id,
    moduleKey: item.moduleKey,
    entityType: item.entityType,
    entityId: item.entityId,
    label: item.label,
    deletedById: item.deletedById,
    deletedAt: item.deletedAt,
  };
}

async function ensureEntityDoesNotExist(tx, entityType, entityId) {
  const modelMap = {
    CatalogItem: tx.catalogItem,
    Tag: tx.tag,
    Origin: tx.origin,
    Indicator: tx.indicator,
    Lead: tx.lead,
    Ticket: tx.ticket,
  };

  const model = modelMap[entityType];

  if (!model) {
    throw new HttpError(422, "Tipo de item não suportado para restauração");
  }

  const existing = await model.findUnique({
    where: { id: entityId },
  });

  if (existing) {
    throw new HttpError(409, "Ja existe um registro ativo com este identificador");
  }
}

async function restoreTrashItem(tx, trashItem) {
  const payload = parseTrashPayload(trashItem);

  await ensureEntityDoesNotExist(tx, trashItem.entityType, trashItem.entityId);

  switch (trashItem.entityType) {
    case "Tag":
      await tx.tag.create({ data: payload });
      break;
    case "CatalogItem":
      await tx.catalogItem.create({ data: payload });
      break;
    case "Origin":
      await tx.origin.create({ data: payload });
      break;
    case "Indicator":
      await tx.indicator.create({ data: payload });
      break;
    case "Lead":
      await tx.lead.create({
        data: {
          ...payload.lead,
          tasks: payload.tasks?.length ? { create: payload.tasks } : undefined,
          comments: payload.comments?.length ? { create: payload.comments } : undefined,
          catalogItems: payload.catalogItems?.length
            ? { create: payload.catalogItems }
            : undefined,
        },
      });
      break;
    case "Ticket":
      await tx.ticket.create({
        data: {
          ...payload.ticket,
          tasks: payload.tasks?.length ? { create: payload.tasks } : undefined,
          comments: payload.comments?.length ? { create: payload.comments } : undefined,
        },
      });
      break;
    default:
      throw new HttpError(422, "Tipo de item não suportado para restauração");
  }
}

trashRouter.use(authenticate);

trashRouter.get(
  "/",
  requireModuleAccess("LIXEIRA", "view"),
  validate({ query: listTrashQuerySchema }),
  async (request, response) => {
    const page = Number(request.query.page || 1);
    const limit = Math.min(Math.max(Number(request.query.limit || 20), 1), 100);
    const skip = (page - 1) * limit;
    const where = {
      ...(request.query.q
        ? {
            OR: [
              { label: { contains: request.query.q } },
              { entityId: { contains: request.query.q } },
            ],
          }
        : {}),
      ...(request.query.moduleKey ? { moduleKey: request.query.moduleKey } : {}),
      ...(request.query.entityType ? { entityType: request.query.entityType } : {}),
    };

    const [items, total] = await prisma.$transaction([
      prisma.trashItem.findMany({
        where,
        orderBy: { deletedAt: "desc" },
        take: limit,
        skip,
      }),
      prisma.trashItem.count({ where }),
    ]);

    response.json({
      items: items.map(toTrashSummary),
      meta: {
        page,
        limit,
        total,
        totalPages: Math.max(Math.ceil(total / limit), 1),
      },
    });
  },
);

trashRouter.get(
  "/:id",
  requireModuleAccess("LIXEIRA", "view"),
  validate({ params: z.object({ id: cuidSchema }) }),
  async (request, response) => {
    const trashItem = await getTrashItemOrThrow(request.params.id);

    response.json({
      item: {
        ...toTrashSummary(trashItem),
        payload: parseTrashPayload(trashItem),
      },
    });
  },
);

trashRouter.post(
  "/:id/restore",
  requireModuleAccess("LIXEIRA", "edit"),
  validate({ params: z.object({ id: cuidSchema }) }),
  async (request, response) => {
    const trashItem = await getTrashItemOrThrow(request.params.id);

    await prisma.$transaction(async (tx) => {
      await restoreTrashItem(tx, trashItem);
      await tx.trashItem.delete({
        where: { id: trashItem.id },
      });
    });

    await writeAuditLog({
      actorUserId: request.auth.userId,
      action: "TRASH_RESTORE",
      entityType: trashItem.entityType,
      entityId: trashItem.entityId,
      ipAddress: response.locals.ipAddress,
      userAgent: response.locals.userAgent,
      metadata: {
        trashItemId: trashItem.id,
      },
    });

    response.status(204).send();
  },
);

trashRouter.delete(
  "/:id",
  requireModuleAccess("LIXEIRA", "manage"),
  validate({ params: z.object({ id: cuidSchema }) }),
  async (request, response) => {
    const trashItem = await getTrashItemOrThrow(request.params.id);

    await prisma.trashItem.delete({
      where: { id: trashItem.id },
    });

    await writeAuditLog({
      actorUserId: request.auth.userId,
      action: "TRASH_PURGE",
      entityType: trashItem.entityType,
      entityId: trashItem.entityId,
      ipAddress: response.locals.ipAddress,
      userAgent: response.locals.userAgent,
      metadata: {
        trashItemId: trashItem.id,
      },
    });

    response.status(204).send();
  },
);
