import { Router } from "express";
import { z } from "zod";

import { writeAuditLog } from "../lib/audit.js";
import { CATALOG_TYPES, DOC_TYPES } from "../lib/constants.js";
import { HttpError } from "../lib/http-error.js";
import { prisma } from "../lib/prisma.js";
import { cuidSchema } from "../lib/schemas.js";
import { slugify } from "../lib/text.js";
import { moveEntityToTrash } from "../lib/trash.js";
import { authenticate } from "../middlewares/authenticate.js";
import { requireModuleAccess } from "../middlewares/require-module-access.js";
import { validate } from "../middlewares/validate.js";

export const catalogRouter = Router();

const catalogTypeSchema = z.enum(CATALOG_TYPES);

const catalogItemSchema = z.object({
  name: z.string().trim().min(2).max(120),
  type: catalogTypeSchema,
  active: z.boolean().optional(),
});

const tagSchema = z.object({
  name: z.string().trim().min(2).max(120),
  color: z.string().trim().regex(/^#(?:[0-9a-fA-F]{3}){1,2}$/),
  active: z.boolean().optional(),
});

const simpleActiveNameSchema = z.object({
  name: z.string().trim().min(2).max(120),
  active: z.boolean().optional(),
});

const indicatorSchema = z.object({
  name: z.string().trim().min(2).max(120),
  docType: z.enum(DOC_TYPES),
  docNumber: z.string().trim().max(32).optional().nullable(),
  contact: z.string().trim().max(120).optional().nullable(),
  email: z.string().email().optional().nullable(),
  percentSetup: z.coerce.number().int().min(0).max(100),
  bank: z.string().trim().max(120).optional().nullable(),
  agency: z.string().trim().max(40).optional().nullable(),
  account: z.string().trim().max(40).optional().nullable(),
  pixKey: z.string().trim().max(120).optional().nullable(),
  active: z.boolean().optional(),
});

catalogRouter.use(authenticate);

catalogRouter.get("/items", requireModuleAccess("CADASTROS", "view"), async (request, response) => {
  const filters = z
    .object({
      type: catalogTypeSchema.optional(),
      active: z.coerce.boolean().optional(),
    })
    .parse(request.query);

  const items = await prisma.catalogItem.findMany({
    where: {
      ...(filters.type ? { type: filters.type } : {}),
      ...(filters.active !== undefined ? { active: filters.active } : {}),
    },
    orderBy: [{ type: "asc" }, { name: "asc" }],
  });

  response.json({ items });
});

catalogRouter.post(
  "/items",
  requireModuleAccess("CADASTROS", "edit"),
  validate({ body: catalogItemSchema }),
  async (request, response) => {
    const item = await prisma.catalogItem.create({
      data: {
        name: request.body.name,
        slug: slugify(`${request.body.type}-${request.body.name}`),
        type: request.body.type,
        active: request.body.active ?? true,
      },
    });

    await writeAuditLog({
      actorUserId: request.auth.userId,
      action: "CATALOG_ITEM_CREATE",
      entityType: "CatalogItem",
      entityId: item.id,
      ipAddress: response.locals.ipAddress,
      userAgent: response.locals.userAgent,
    });

    response.status(201).json({ item });
  },
);

catalogRouter.patch(
  "/items/:id",
  requireModuleAccess("CADASTROS", "edit"),
  validate({
    params: z.object({ id: cuidSchema }),
    body: catalogItemSchema.partial(),
  }),
  async (request, response) => {
    const current = await prisma.catalogItem.findUnique({
      where: { id: request.params.id },
    });

    if (!current) {
      throw new HttpError(404, "Registro nao encontrado");
    }

    const type = request.body.type || current.type;
    const name = request.body.name || current.name;

    const item = await prisma.catalogItem.update({
      where: { id: request.params.id },
      data: {
        ...request.body,
        slug: slugify(`${type}-${name}`),
      },
    });

    await writeAuditLog({
      actorUserId: request.auth.userId,
      action: "CATALOG_ITEM_UPDATE",
      entityType: "CatalogItem",
      entityId: item.id,
      ipAddress: response.locals.ipAddress,
      userAgent: response.locals.userAgent,
      metadata: request.body,
    });

    response.json({ item });
  },
);

catalogRouter.delete(
  "/items/:id",
  requireModuleAccess("CADASTROS", "manage"),
  validate({
    params: z.object({ id: cuidSchema }),
  }),
  async (request, response) => {
    const item = await prisma.catalogItem.findUnique({
      where: { id: request.params.id },
      include: {
        leadSelections: {
          select: { id: true },
          take: 1,
        },
      },
    });

    if (!item) {
      throw new HttpError(404, "Registro nao encontrado");
    }

    if (item.leadSelections.length) {
      throw new HttpError(
        409,
        "Este item esta vinculado a leads e nao pode ser enviado para a lixeira",
      );
    }

    await prisma.$transaction(async (tx) => {
      await moveEntityToTrash({
        tx,
        moduleKey: "CADASTROS",
        entityType: "CatalogItem",
        entityId: item.id,
        label: item.name,
        payload: {
          id: item.id,
          name: item.name,
          slug: item.slug,
          type: item.type,
          active: item.active,
          createdAt: item.createdAt,
          updatedAt: item.updatedAt,
        },
        deletedById: request.auth.userId,
      });

      await tx.catalogItem.delete({
        where: { id: item.id },
      });
    });

    response.status(204).send();
  },
);

function mountSimpleCrud({ path, model, entityType, createAction, updateAction, schema }) {
  catalogRouter.get(
    path,
    requireModuleAccess("CADASTROS", "view"),
    async (_request, response) => {
      const items = await prisma[model].findMany({
        orderBy: { createdAt: "desc" },
      });

      response.json({ items });
    },
  );

  catalogRouter.post(
    path,
    requireModuleAccess("CADASTROS", "edit"),
    validate({ body: schema }),
    async (request, response) => {
      const item = await prisma[model].create({
        data: request.body,
      });

      await writeAuditLog({
        actorUserId: request.auth.userId,
        action: createAction,
        entityType: model,
        entityId: item.id,
        ipAddress: response.locals.ipAddress,
        userAgent: response.locals.userAgent,
      });

      response.status(201).json({ item });
    },
  );

  catalogRouter.patch(
    `${path}/:id`,
    requireModuleAccess("CADASTROS", "edit"),
    validate({
      params: z.object({ id: cuidSchema }),
      body: schema.partial(),
    }),
    async (request, response) => {
      const existing = await prisma[model].findUnique({
        where: { id: request.params.id },
      });

      if (!existing) {
        throw new HttpError(404, "Registro nao encontrado");
      }

      const item = await prisma[model].update({
        where: { id: request.params.id },
        data: request.body,
      });

      await writeAuditLog({
        actorUserId: request.auth.userId,
        action: updateAction,
        entityType: model,
        entityId: item.id,
        ipAddress: response.locals.ipAddress,
        userAgent: response.locals.userAgent,
        metadata: request.body,
      });

      response.json({ item });
    },
  );

  catalogRouter.delete(
    `${path}/:id`,
    requireModuleAccess("CADASTROS", "manage"),
    validate({
      params: z.object({ id: cuidSchema }),
    }),
    async (request, response) => {
      const existing = await prisma[model].findUnique({
        where: { id: request.params.id },
      });

      if (!existing) {
        throw new HttpError(404, "Registro nao encontrado");
      }

      await prisma.$transaction(async (tx) => {
        await moveEntityToTrash({
          tx,
          moduleKey: "CADASTROS",
          entityType,
          entityId: existing.id,
          label: existing.name,
          payload: existing,
          deletedById: request.auth.userId,
        });

        await tx[model].delete({
          where: { id: existing.id },
        });
      });

      response.status(204).send();
    },
  );
}

mountSimpleCrud({
  path: "/tags",
  model: "tag",
  entityType: "Tag",
  createAction: "TAG_CREATE",
  updateAction: "TAG_UPDATE",
  schema: tagSchema,
});

mountSimpleCrud({
  path: "/origins",
  model: "origin",
  entityType: "Origin",
  createAction: "ORIGIN_CREATE",
  updateAction: "ORIGIN_UPDATE",
  schema: simpleActiveNameSchema,
});

mountSimpleCrud({
  path: "/sdrs",
  model: "sdr",
  entityType: "Sdr",
  createAction: "SDR_CREATE",
  updateAction: "SDR_UPDATE",
  schema: simpleActiveNameSchema,
});

mountSimpleCrud({
  path: "/indicators",
  model: "indicator",
  entityType: "Indicator",
  createAction: "INDICATOR_CREATE",
  updateAction: "INDICATOR_UPDATE",
  schema: indicatorSchema,
});
