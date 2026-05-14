import { Router } from "express";
import { z } from "zod";

import { compareAccessLevel, resolveUserAccess } from "../lib/access-control.js";
import { writeAuditLog } from "../lib/audit.js";
import { CATALOG_TYPES, DOC_TYPES } from "../lib/constants.js";
import {
  buildCrmFunnelSlug,
  buildDefaultStagesForNewFunnel,
  listCrmFunnels,
  serializeCrmFunnel,
} from "../lib/crm-funnels.js";
import { HttpError } from "../lib/http-error.js";
import { prisma } from "../lib/prisma.js";
import { cuidSchema, entityIdSchema } from "../lib/schemas.js";
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

const lossReasonSchema = z.object({
  name: z.string().trim().min(2).max(160),
  active: z.boolean().optional(),
});

const planSchema = z.object({
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().max(2000).optional().nullable(),
  features: z.string().trim().max(4000).optional().nullable(),
  restrictions: z.string().trim().max(4000).optional().nullable(),
  setupFee: z.coerce.number().min(0).optional(),
  monthlyFee: z.coerce.number().min(0).optional(),
  includedAgents: z.coerce.number().int().min(0).optional(),
  includedSupervisors: z.coerce.number().int().min(0).optional(),
  includedAdmins: z.coerce.number().int().min(0).optional(),
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

const crmFunnelStageSchema = z.object({
  id: cuidSchema.optional(),
  name: z.string().trim().min(2).max(120),
  sortOrder: z.coerce.number().int().min(0).optional(),
  active: z.boolean().optional(),
});

const crmFunnelSchema = z.object({
  name: z.string().trim().min(2).max(120),
  active: z.boolean().optional(),
  stages: z.array(crmFunnelStageSchema).min(1).optional(),
  lossReasons: z.array(
    z.object({
      id: cuidSchema.optional(),
      name: z.string().trim().min(1).max(160),
      active: z.boolean().optional(),
    }),
  ).optional(),
});

catalogRouter.use(authenticate);

async function ensureAnyModuleAccess(request, moduleKeys, requiredLevel = "view") {
  if (request.auth.role === "admin") {
    return;
  }

  const access = request.auth.access || (await resolveUserAccess(request.auth.userId));
  request.auth.access = access;

  const canAccess = moduleKeys.some((moduleKey) =>
    compareAccessLevel(access?.permissionMap?.[moduleKey] || "none", requiredLevel),
  );

  if (!canAccess) {
    throw new HttpError(403, "Sem permissão para consultar estes dados");
  }
}

catalogRouter.get("/lookups", async (request, response) => {
  await ensureAnyModuleAccess(
    request,
    ["CADASTROS", "COMMERCIAL", "DASHBOARD", "IMPLANTACAO", "CLIENTES"],
    "view",
  );

  const [origins, lossReasons, sdrs, indicators, items, plans] = await prisma.$transaction([
    prisma.origin.findMany({
      where: { active: true },
      orderBy: { name: "asc" },
    }),
    prisma.lossReason.findMany({
      where: { active: true },
      orderBy: { name: "asc" },
    }),
    prisma.user.findMany({
      where: { isActive: true, role: "sdr" },
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        isActive: true,
      },
    }),
    prisma.indicator.findMany({
      where: { active: true },
      orderBy: { name: "asc" },
    }),
    prisma.catalogItem.findMany({
      where: { active: true },
      orderBy: [{ type: "asc" }, { name: "asc" }],
    }),
    prisma.plan.findMany({
      where: { active: true },
      orderBy: [{ name: "asc" }],
    }),
  ]);
  const funnels = await listCrmFunnels(prisma, true);

  response.json({
    origins,
    lossReasons,
    sdrs: sdrs.map((item) => ({
      id: item.id,
      name: item.name,
      active: item.isActive,
    })),
    indicators,
    products: items.filter((item) => item.type === "PRODUCT"),
    integrations: items.filter((item) => item.type === "INTEGRATION"),
    plans: plans.map((plan) => ({
      ...plan,
      setupFee: plan.setupFeeInCents / 100,
      monthlyFee: plan.monthlyFeeInCents / 100,
    })),
    funnels: funnels.map(serializeCrmFunnel),
  });
});

catalogRouter.get(
  "/crm-funnels",
  requireModuleAccess("CADASTROS", "view"),
  async (_request, response) => {
    const items = await listCrmFunnels(prisma, false);
    response.json({ items: items.map(serializeCrmFunnel) });
  },
);

catalogRouter.post(
  "/crm-funnels",
  requireModuleAccess("CADASTROS", "edit"),
  validate({ body: crmFunnelSchema }),
  async (request, response) => {
    const existingCount = await prisma.crmFunnel.count();
    const requestedStages = request.body.stages?.length
      ? request.body.stages
      : buildDefaultStagesForNewFunnel();

    const item = await prisma.crmFunnel.create({
      data: {
        name: request.body.name,
        slug: buildCrmFunnelSlug(request.body.name, Date.now().toString().slice(-4)),
        active: request.body.active ?? true,
        isDefault: existingCount === 0,
        sortOrder: existingCount,
        stages: {
          create: requestedStages.map((stage, index) => ({
            name: stage.name,
            sortOrder: stage.sortOrder ?? index,
            active: stage.active ?? true,
          })),
        },
        lossReasons: request.body.lossReasons?.length
          ? {
              create: request.body.lossReasons.map((reason) => ({
                name: reason.name,
                active: reason.active ?? true,
              })),
            }
          : undefined,
      },
      include: {
        stages: {
          orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
        },
        lossReasons: {
          orderBy: [{ name: "asc" }, { createdAt: "asc" }],
        },
      },
    });

    await writeAuditLog({
      actorUserId: request.auth.userId,
      action: "CRM_FUNNEL_CREATE",
      entityType: "CrmFunnel",
      entityId: item.id,
      ipAddress: response.locals.ipAddress,
      userAgent: response.locals.userAgent,
    });

    response.status(201).json({ item: serializeCrmFunnel(item) });
  },
);

catalogRouter.patch(
  "/crm-funnels/:id",
  requireModuleAccess("CADASTROS", "edit"),
  validate({
    params: z.object({ id: entityIdSchema }),
    body: crmFunnelSchema.partial(),
  }),
  async (request, response) => {
    const existing = await prisma.crmFunnel.findUnique({
      where: { id: request.params.id },
      include: {
        stages: {
          orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
        },
        lossReasons: {
          orderBy: [{ name: "asc" }, { createdAt: "asc" }],
        },
      },
    });

    if (!existing) {
      throw new HttpError(404, "Funil do CRM não encontrado");
    }

    const item = await prisma.$transaction(async (tx) => {
      await tx.crmFunnel.update({
        where: { id: request.params.id },
        data: {
          ...(request.body.name ? { name: request.body.name, slug: buildCrmFunnelSlug(request.body.name, existing.id.slice(-4)) } : {}),
          ...("active" in request.body ? { active: request.body.active } : {}),
        },
      });

      if (Array.isArray(request.body.stages)) {
        const stageNames = new Set();
        for (const stage of request.body.stages) {
          const normalized = stage.name.trim().toLowerCase();
          if (stageNames.has(normalized)) {
            throw new HttpError(409, "Existem colunas duplicadas neste funil");
          }
          stageNames.add(normalized);
        }

        for (const [index, stageInput] of request.body.stages.entries()) {
          if (stageInput.id) {
            const previous = existing.stages.find((item) => item.id === stageInput.id);
            const updatedStage = await tx.crmFunnelStage.update({
              where: { id: stageInput.id },
              data: {
                name: stageInput.name,
                sortOrder: stageInput.sortOrder ?? index,
                active: stageInput.active ?? true,
              },
            });

            if (previous && previous.name !== updatedStage.name) {
              await tx.lead.updateMany({
                where: { stageId: updatedStage.id },
                data: { status: updatedStage.name },
              });
            }
          } else {
            await tx.crmFunnelStage.create({
              data: {
                funnelId: existing.id,
                name: stageInput.name,
                sortOrder: stageInput.sortOrder ?? index,
                active: stageInput.active ?? true,
              },
            });
          }
        }
      }

      if (Array.isArray(request.body.lossReasons)) {
        const reasonNames = new Set();
        for (const reason of request.body.lossReasons) {
          const normalized = reason.name.trim().toLowerCase();
          if (reasonNames.has(normalized)) {
            throw new HttpError(409, "Existem motivos de perda duplicados neste funil");
          }
          reasonNames.add(normalized);
        }

        for (const reasonInput of request.body.lossReasons) {
          if (reasonInput.id) {
            await tx.lossReason.update({
              where: { id: reasonInput.id },
              data: {
                funnelId: existing.id,
                name: reasonInput.name,
                active: reasonInput.active ?? true,
              },
            });
          } else {
            await tx.lossReason.create({
              data: {
                funnelId: existing.id,
                name: reasonInput.name,
                active: reasonInput.active ?? true,
              },
            });
          }
        }

        const incomingReasonIds = new Set(
          request.body.lossReasons.map((reason) => reason.id).filter(Boolean),
        );

        for (const existingReason of existing.lossReasons || []) {
          if (!incomingReasonIds.has(existingReason.id)) {
            await tx.lossReason.delete({
              where: { id: existingReason.id },
            });
          }
        }
      }

      return tx.crmFunnel.findUnique({
        where: { id: existing.id },
        include: {
          stages: {
            orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
          },
          lossReasons: {
            orderBy: [{ name: "asc" }, { createdAt: "asc" }],
          },
        },
      });
    });

    await writeAuditLog({
      actorUserId: request.auth.userId,
      action: "CRM_FUNNEL_UPDATE",
      entityType: "CrmFunnel",
      entityId: request.params.id,
      ipAddress: response.locals.ipAddress,
      userAgent: response.locals.userAgent,
      metadata: request.body,
    });

    response.json({ item: serializeCrmFunnel(item) });
  },
);

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
    params: z.object({ id: entityIdSchema }),
    body: catalogItemSchema.partial(),
  }),
  async (request, response) => {
    const current = await prisma.catalogItem.findUnique({
      where: { id: request.params.id },
    });

    if (!current) {
      throw new HttpError(404, "Registro não encontrado");
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
      throw new HttpError(404, "Registro não encontrado");
    }

    if (item.leadSelections.length) {
      throw new HttpError(
        409,
        "Este item está vinculado a leads e não pode ser enviado para a lixeira",
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
        throw new HttpError(404, "Registro não encontrado");
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
        throw new HttpError(404, "Registro não encontrado");
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
  path: "/indicators",
  model: "indicator",
  entityType: "Indicator",
  createAction: "INDICATOR_CREATE",
  updateAction: "INDICATOR_UPDATE",
  schema: indicatorSchema,
});

catalogRouter.get(
  "/plans",
  requireModuleAccess("CADASTROS", "view"),
  async (_request, response) => {
    const items = await prisma.plan.findMany({
      orderBy: [{ createdAt: "desc" }],
    });

    response.json({
      items: items.map((plan) => ({
        ...plan,
        setupFee: plan.setupFeeInCents / 100,
        monthlyFee: plan.monthlyFeeInCents / 100,
      })),
    });
  },
);

catalogRouter.post(
  "/plans",
  requireModuleAccess("CADASTROS", "edit"),
  validate({ body: planSchema }),
  async (request, response) => {
    const item = await prisma.plan.create({
      data: {
        name: request.body.name,
        slug: slugify(`plan-${request.body.name}`),
        description: request.body.description,
        features: request.body.features,
        restrictions: request.body.restrictions,
        setupFeeInCents: Math.round((request.body.setupFee || 0) * 100),
        monthlyFeeInCents: Math.round((request.body.monthlyFee || 0) * 100),
        includedAgents: request.body.includedAgents ?? 0,
        includedSupervisors: request.body.includedSupervisors ?? 0,
        includedAdmins: request.body.includedAdmins ?? 0,
        active: request.body.active ?? true,
      },
    });

    await writeAuditLog({
      actorUserId: request.auth.userId,
      action: "PLAN_CREATE",
      entityType: "Plan",
      entityId: item.id,
      ipAddress: response.locals.ipAddress,
      userAgent: response.locals.userAgent,
    });

    response.status(201).json({
      item: {
        ...item,
        setupFee: item.setupFeeInCents / 100,
        monthlyFee: item.monthlyFeeInCents / 100,
      },
    });
  },
);

catalogRouter.patch(
  "/plans/:id",
  requireModuleAccess("CADASTROS", "edit"),
  validate({
    params: z.object({ id: cuidSchema }),
    body: planSchema.partial(),
  }),
  async (request, response) => {
    const existing = await prisma.plan.findUnique({
      where: { id: request.params.id },
    });

    if (!existing) {
      throw new HttpError(404, "Registro não encontrado");
    }

    const name = request.body.name || existing.name;
    const item = await prisma.plan.update({
      where: { id: request.params.id },
      data: {
        ...("name" in request.body ? { name: request.body.name } : {}),
        ...("description" in request.body ? { description: request.body.description } : {}),
        ...("features" in request.body ? { features: request.body.features } : {}),
        ...("restrictions" in request.body ? { restrictions: request.body.restrictions } : {}),
        ...("setupFee" in request.body
          ? { setupFeeInCents: Math.round((request.body.setupFee || 0) * 100) }
          : {}),
        ...("monthlyFee" in request.body
          ? { monthlyFeeInCents: Math.round((request.body.monthlyFee || 0) * 100) }
          : {}),
        ...("includedAgents" in request.body ? { includedAgents: request.body.includedAgents } : {}),
        ...("includedSupervisors" in request.body
          ? { includedSupervisors: request.body.includedSupervisors }
          : {}),
        ...("includedAdmins" in request.body ? { includedAdmins: request.body.includedAdmins } : {}),
        ...("active" in request.body ? { active: request.body.active } : {}),
        slug: slugify(`plan-${name}`),
      },
    });

    await writeAuditLog({
      actorUserId: request.auth.userId,
      action: "PLAN_UPDATE",
      entityType: "Plan",
      entityId: item.id,
      ipAddress: response.locals.ipAddress,
      userAgent: response.locals.userAgent,
      metadata: request.body,
    });

    response.json({
      item: {
        ...item,
        setupFee: item.setupFeeInCents / 100,
        monthlyFee: item.monthlyFeeInCents / 100,
      },
    });
  },
);

catalogRouter.delete(
  "/plans/:id",
  requireModuleAccess("CADASTROS", "manage"),
  validate({
    params: z.object({ id: cuidSchema }),
  }),
  async (request, response) => {
    const existing = await prisma.plan.findUnique({
      where: { id: request.params.id },
      include: {
        leads: { select: { id: true }, take: 1 },
        tickets: { select: { id: true }, take: 1 },
      },
    });

    if (!existing) {
      throw new HttpError(404, "Registro não encontrado");
    }

    if (existing.leads.length || existing.tickets.length) {
      throw new HttpError(409, "Este plano está vinculado a clientes e não pode ser removido");
    }

    await prisma.$transaction(async (tx) => {
      await moveEntityToTrash({
        tx,
        moduleKey: "CADASTROS",
        entityType: "Plan",
        entityId: existing.id,
        label: existing.name,
        payload: existing,
        deletedById: request.auth.userId,
      });

      await tx.plan.delete({
        where: { id: existing.id },
      });
    });

    response.status(204).send();
  },
);
