import { Router } from "express";
import { z } from "zod";

import { writeAuditLog } from "../lib/audit.js";
import { HttpError } from "../lib/http-error.js";
import { prisma } from "../lib/prisma.js";
import { cuidSchema, paginationSchema } from "../lib/schemas.js";
import {
  getTrashExpiresAt,
  getTrashItemOrThrow,
  parseTrashPayload,
  purgeExpiredTrashItems,
} from "../lib/trash.js";
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
    expiresAt: getTrashExpiresAt(item.deletedAt),
  };
}

async function ensureEntityDoesNotExist(tx, entityType, entityId) {
  const modelMap = {
    User: tx.user,
    Sector: tx.sector,
    AccessPreset: tx.accessPreset,
    Plan: tx.plan,
    CatalogItem: tx.catalogItem,
    Tag: tx.tag,
    Origin: tx.origin,
    LossReason: tx.lossReason,
    Indicator: tx.indicator,
    Lead: tx.lead,
    Ticket: tx.ticket,
    TicketAttachment: tx.ticketAttachment,
  };

  const model = modelMap[entityType];

  if (entityType === "User") {
    return;
  }

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
    case "User": {
      const accessPreset = payload.user?.accessPresetId
        ? await tx.accessPreset.findUnique({
            where: { id: payload.user.accessPresetId },
            select: { id: true },
          })
        : null;

      const existing = await tx.user.findUnique({
        where: { id: payload.user.id },
      });

      const userData = {
        ...payload.user,
        accessPresetId: accessPreset?.id || null,
        isActive: true,
        failedLoginAttempts: 0,
        lockedUntil: null,
      };

      if (existing) {
        await tx.user.update({
          where: { id: payload.user.id },
          data: userData,
        });
      } else {
        await tx.user.create({
          data: userData,
        });
      }

      await tx.userModulePermission.deleteMany({
        where: { userId: payload.user.id },
      });

      if (payload.modulePermissions?.length) {
        await tx.userModulePermission.createMany({
          data: payload.modulePermissions,
        });
      }

      await tx.userActionPermission.deleteMany({
        where: { userId: payload.user.id },
      });

      if (payload.actionPermissions?.length) {
        await tx.userActionPermission.createMany({
          data: payload.actionPermissions,
        });
      }
      break;
    }
    case "Sector":
      await tx.sector.create({ data: payload });
      break;
    case "AccessPreset":
      await tx.accessPreset.create({
        data: {
          ...payload.preset,
          modulePermissions: payload.modulePermissions?.length
            ? { create: payload.modulePermissions }
            : undefined,
          actionPermissions: payload.actionPermissions?.length
            ? { create: payload.actionPermissions }
            : undefined,
        },
      });

      if (payload.linkedUserIds?.length) {
        await tx.user.updateMany({
          where: {
            id: { in: payload.linkedUserIds },
          },
          data: {
            accessPresetId: payload.preset.id,
          },
        });
      }
      break;
    case "Plan":
      await tx.plan.create({ data: payload });
      break;
    case "Tag":
      await tx.tag.create({ data: payload });
      break;
    case "CatalogItem":
      await tx.catalogItem.create({ data: payload });
      break;
    case "Origin":
      await tx.origin.create({ data: payload });
      break;
    case "LossReason":
      await tx.lossReason.create({ data: payload });
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
    case "TicketAttachment":
      await tx.ticketAttachment.create({
        data: payload.attachment,
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
    await purgeExpiredTrashItems();

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
