import { Router } from "express";
import { z } from "zod";

import {
  ACCESS_LEVELS,
  USER_ROLES,
} from "../lib/constants.js";
import {
  getDefaultModuleDefinitions,
  normalizeModuleKey,
  normalizeRole,
  resolveUserAccess,
} from "../lib/access-control.js";
import { writeAuditLog } from "../lib/audit.js";
import { HttpError } from "../lib/http-error.js";
import { prisma } from "../lib/prisma.js";
import { cuidSchema } from "../lib/schemas.js";
import { slugify } from "../lib/text.js";
import { authenticate } from "../middlewares/authenticate.js";
import { authorize } from "../middlewares/authorize.js";
import { validate } from "../middlewares/validate.js";

export const accessRouter = Router();

const userRoleSchema = z.enum(USER_ROLES);
const accessLevelSchema = z.enum(ACCESS_LEVELS);

const modulePermissionSchema = z.object({
  moduleKey: z.string().trim().min(2),
  accessLevel: accessLevelSchema,
});

const moduleSchema = z.object({
  key: z.string().trim().min(2).max(60).optional(),
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().max(240).optional().nullable(),
  active: z.boolean().optional(),
  sortOrder: z.coerce.number().int().min(0).max(1000).optional(),
});

const presetSchema = z.object({
  name: z.string().trim().min(2).max(120),
  slug: z.string().trim().min(2).max(120).optional(),
  description: z.string().trim().max(240).optional().nullable(),
  role: userRoleSchema,
  modulePermissions: z.array(modulePermissionSchema).min(1),
});

const updateUserAccessSchema = z.object({
  accessPresetId: cuidSchema.nullable().optional(),
  modulePermissions: z.array(modulePermissionSchema).optional(),
});

async function ensureModulesExist(moduleKeys) {
  const normalizedKeys = [...new Set(moduleKeys.map(normalizeModuleKey))];
  const existing = await prisma.accessModule.findMany({
    where: {
      key: { in: normalizedKeys },
    },
    select: {
      key: true,
    },
  });

  const existingSet = new Set(existing.map((item) => item.key));
  const missingKeys = normalizedKeys.filter((key) => !existingSet.has(key));

  if (missingKeys.length) {
    throw new HttpError(422, `Modulos inexistentes: ${missingKeys.join(", ")}`);
  }
}

function normalizePermissionInput(modulePermissions = []) {
  return modulePermissions.map((permission) => ({
    moduleKey: normalizeModuleKey(permission.moduleKey),
    accessLevel: permission.accessLevel,
  }));
}

accessRouter.use(authenticate, authorize(["admin"]));

accessRouter.get("/modules", async (_request, response) => {
  const modules = await prisma.accessModule.findMany({
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  });

  response.json({
    items: modules,
    defaults: getDefaultModuleDefinitions(),
    accessLevels: ACCESS_LEVELS,
  });
});

accessRouter.post("/modules", validate({ body: moduleSchema }), async (request, response) => {
  const key = normalizeModuleKey(request.body.key || request.body.name);

  if (!key) {
    throw new HttpError(422, "Chave de modulo invalida");
  }

  const module = await prisma.accessModule.create({
    data: {
      key,
      name: request.body.name,
      description: request.body.description,
      active: request.body.active ?? true,
      sortOrder: request.body.sortOrder ?? 999,
      isSystem: false,
    },
  });

  await writeAuditLog({
    actorUserId: request.auth.userId,
    action: "ACCESS_MODULE_CREATE",
    entityType: "AccessModule",
    entityId: module.key,
    ipAddress: response.locals.ipAddress,
    userAgent: response.locals.userAgent,
  });

  response.status(201).json({ item: module });
});

accessRouter.patch(
  "/modules/:key",
  validate({
    params: z.object({ key: z.string().trim().min(2) }),
    body: moduleSchema.partial(),
  }),
  async (request, response) => {
    const currentKey = normalizeModuleKey(request.params.key);
    const current = await prisma.accessModule.findUnique({
      where: { key: currentKey },
    });

    if (!current) {
      throw new HttpError(404, "Modulo nao encontrado");
    }

    const nextKey =
      request.body.key && !current.isSystem
        ? normalizeModuleKey(request.body.key)
        : current.key;

    if (current.isSystem && request.body.key && nextKey !== current.key) {
      throw new HttpError(422, "Nao e permitido alterar a chave de um modulo padrao");
    }

    const module = await prisma.accessModule.update({
      where: { key: current.key },
      data: {
        key: nextKey,
        ...("name" in request.body ? { name: request.body.name } : {}),
        ...("description" in request.body ? { description: request.body.description } : {}),
        ...("active" in request.body ? { active: request.body.active } : {}),
        ...("sortOrder" in request.body ? { sortOrder: request.body.sortOrder } : {}),
      },
    });

    await writeAuditLog({
      actorUserId: request.auth.userId,
      action: "ACCESS_MODULE_UPDATE",
      entityType: "AccessModule",
      entityId: module.key,
      ipAddress: response.locals.ipAddress,
      userAgent: response.locals.userAgent,
      metadata: request.body,
    });

    response.json({ item: module });
  },
);

accessRouter.get("/presets", async (_request, response) => {
  const items = await prisma.accessPreset.findMany({
    include: {
      modulePermissions: {
        orderBy: { moduleKey: "asc" },
      },
    },
    orderBy: [{ isSystem: "desc" }, { name: "asc" }],
  });

  response.json({ items });
});

accessRouter.post("/presets", validate({ body: presetSchema }), async (request, response) => {
  const permissions = normalizePermissionInput(request.body.modulePermissions);
  await ensureModulesExist(permissions.map((item) => item.moduleKey));

  const preset = await prisma.accessPreset.create({
    data: {
      name: request.body.name,
      slug: slugify(request.body.slug || request.body.name),
      description: request.body.description,
      role: normalizeRole(request.body.role),
      isSystem: false,
      modulePermissions: {
        create: permissions,
      },
    },
    include: {
      modulePermissions: {
        orderBy: { moduleKey: "asc" },
      },
    },
  });

  await writeAuditLog({
    actorUserId: request.auth.userId,
    action: "ACCESS_PRESET_CREATE",
    entityType: "AccessPreset",
    entityId: preset.id,
    ipAddress: response.locals.ipAddress,
    userAgent: response.locals.userAgent,
  });

  response.status(201).json({ item: preset });
});

accessRouter.patch(
  "/presets/:id",
  validate({
    params: z.object({ id: cuidSchema }),
    body: presetSchema.partial(),
  }),
  async (request, response) => {
    const current = await prisma.accessPreset.findUnique({
      where: { id: request.params.id },
      include: {
        modulePermissions: true,
      },
    });

    if (!current) {
      throw new HttpError(404, "Preset nao encontrado");
    }

    const permissions = request.body.modulePermissions
      ? normalizePermissionInput(request.body.modulePermissions)
      : null;

    if (permissions) {
      await ensureModulesExist(permissions.map((item) => item.moduleKey));
    }

    const preset = await prisma.$transaction(async (tx) => {
      const updated = await tx.accessPreset.update({
        where: { id: current.id },
        data: {
          ...("name" in request.body ? { name: request.body.name } : {}),
          ...("slug" in request.body
            ? {
                slug: current.isSystem
                  ? current.slug
                  : slugify(request.body.slug || request.body.name || current.name),
              }
            : {}),
          ...("description" in request.body ? { description: request.body.description } : {}),
          ...("role" in request.body ? { role: normalizeRole(request.body.role) } : {}),
        },
      });

      if (permissions) {
        await tx.accessPresetPermission.deleteMany({
          where: { presetId: current.id },
        });

        await tx.accessPresetPermission.createMany({
          data: permissions.map((permission) => ({
            presetId: current.id,
            moduleKey: permission.moduleKey,
            accessLevel: permission.accessLevel,
          })),
        });
      }

      return tx.accessPreset.findUnique({
        where: { id: updated.id },
        include: {
          modulePermissions: {
            orderBy: { moduleKey: "asc" },
          },
        },
      });
    });

    await writeAuditLog({
      actorUserId: request.auth.userId,
      action: "ACCESS_PRESET_UPDATE",
      entityType: "AccessPreset",
      entityId: current.id,
      ipAddress: response.locals.ipAddress,
      userAgent: response.locals.userAgent,
      metadata: request.body,
    });

    response.json({ item: preset });
  },
);

accessRouter.get(
  "/users/:id",
  validate({ params: z.object({ id: cuidSchema }) }),
  async (request, response) => {
    const user = await prisma.user.findUnique({
      where: { id: request.params.id },
      include: {
        accessPreset: true,
        modulePermissions: {
          orderBy: { moduleKey: "asc" },
        },
      },
    });

    if (!user) {
      throw new HttpError(404, "Usuario nao encontrado");
    }

    response.json({
      item: {
        userId: user.id,
        role: normalizeRole(user.role),
        accessPresetId: user.accessPresetId,
        accessPreset: user.accessPreset,
        modulePermissions: user.modulePermissions,
        effectiveAccess: await resolveUserAccess(user.id),
      },
    });
  },
);

accessRouter.put(
  "/users/:id",
  validate({
    params: z.object({ id: cuidSchema }),
    body: updateUserAccessSchema,
  }),
  async (request, response) => {
    const user = await prisma.user.findUnique({
      where: { id: request.params.id },
    });

    if (!user) {
      throw new HttpError(404, "Usuario nao encontrado");
    }

    if (request.body.accessPresetId) {
      const preset = await prisma.accessPreset.findUnique({
        where: { id: request.body.accessPresetId },
      });

      if (!preset) {
        throw new HttpError(404, "Preset de acesso nao encontrado");
      }

      if (normalizeRole(preset.role) !== normalizeRole(user.role)) {
        throw new HttpError(422, "O preset precisa ser do mesmo cargo base do usuario");
      }
    }

    const permissions = request.body.modulePermissions
      ? normalizePermissionInput(request.body.modulePermissions)
      : null;

    if (permissions) {
      await ensureModulesExist(permissions.map((item) => item.moduleKey));
    }

    await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: user.id },
        data: {
          ...(request.body.accessPresetId !== undefined
            ? { accessPresetId: request.body.accessPresetId }
            : {}),
        },
      });

      if (permissions) {
        await tx.userModulePermission.deleteMany({
          where: { userId: user.id },
        });

        if (permissions.length) {
          await tx.userModulePermission.createMany({
            data: permissions.map((permission) => ({
              userId: user.id,
              moduleKey: permission.moduleKey,
              accessLevel: permission.accessLevel,
            })),
          });
        }
      }
    });

    await writeAuditLog({
      actorUserId: request.auth.userId,
      action: "USER_ACCESS_UPDATE",
      entityType: "User",
      entityId: user.id,
      ipAddress: response.locals.ipAddress,
      userAgent: response.locals.userAgent,
      metadata: {
        accessPresetId: request.body.accessPresetId,
        modulePermissions: permissions,
      },
    });

    response.json({
      item: await resolveUserAccess(user.id),
    });
  },
);
