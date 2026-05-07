import { Router } from "express";
import { z } from "zod";

import {
  ACCESS_LEVELS,
  DEFAULT_SECTORS,
  USER_ROLES,
} from "../lib/constants.js";
import {
  getDefaultActionDefinitions,
  getDefaultModuleDefinitions,
  normalizeActionKey,
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

const actionPermissionSchema = z.object({
  moduleKey: z.string().trim().min(2),
  actionKey: z.string().trim().min(2),
  allowed: z.boolean(),
});

const sectorSchema = z.object({
  key: z.string().trim().min(2).max(80).optional(),
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().max(240).optional().nullable(),
  active: z.boolean().optional(),
});

const moduleSchema = z.object({
  key: z.string().trim().min(2).max(60).optional(),
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().max(240).optional().nullable(),
  parentKey: z.string().trim().min(2).max(60).optional().nullable(),
  path: z.string().trim().max(240).optional().nullable(),
  scope: z.enum(["MODULE", "PAGE"]).optional(),
  active: z.boolean().optional(),
  sortOrder: z.coerce.number().int().min(0).max(1000).optional(),
});

const actionSchema = z.object({
  moduleKey: z.string().trim().min(2).max(60),
  key: z.string().trim().min(2).max(60).optional(),
  label: z.string().trim().min(2).max(120),
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
  actionPermissions: z.array(actionPermissionSchema).optional(),
});

const updateUserAccessSchema = z.object({
  accessPresetId: cuidSchema.nullable().optional(),
  modulePermissions: z.array(modulePermissionSchema).optional(),
  actionPermissions: z.array(actionPermissionSchema).optional(),
});

function normalizeSectorKey(value) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function hasAccessActionModel() {
  return typeof prisma.accessAction?.findMany === "function";
}

async function ensureModulesExist(moduleKeys) {
  const normalizedKeys = [...new Set(moduleKeys.map(normalizeModuleKey))];
  if (!normalizedKeys.length) return;

  const existing = await prisma.accessModule.findMany({
    where: { key: { in: normalizedKeys } },
    select: { key: true },
  });

  const existingSet = new Set(existing.map((item) => item.key));
  const missingKeys = normalizedKeys.filter((key) => !existingSet.has(key));

  if (missingKeys.length) {
    throw new HttpError(422, `Modulos inexistentes: ${missingKeys.join(", ")}`);
  }
}

async function ensureActionsExist(actionPermissions = []) {
  if (!actionPermissions.length) return;
  if (!hasAccessActionModel()) return;

  const compositeKeys = actionPermissions.map((permission) => ({
    moduleKey: normalizeModuleKey(permission.moduleKey),
    actionKey: normalizeActionKey(permission.actionKey),
  }));

  const modules = [...new Set(compositeKeys.map((item) => item.moduleKey))];
  const actions = await prisma.accessAction.findMany({
    where: {
      OR: compositeKeys.map((item) => ({
        moduleKey: item.moduleKey,
        key: item.actionKey,
      })),
    },
    select: {
      moduleKey: true,
      key: true,
    },
  });

  await ensureModulesExist(modules);

  const existingSet = new Set(actions.map((item) => `${item.moduleKey}:${item.key}`));
  const missing = compositeKeys
    .map((item) => `${item.moduleKey}:${item.actionKey}`)
    .filter((item) => !existingSet.has(item));

  if (missing.length) {
    throw new HttpError(422, `Acoes inexistentes: ${missing.join(", ")}`);
  }
}

function normalizePermissionInput(modulePermissions = []) {
  return modulePermissions.map((permission) => ({
    moduleKey: normalizeModuleKey(permission.moduleKey),
    accessLevel: permission.accessLevel,
  }));
}

function normalizeActionPermissionInput(actionPermissions = []) {
  return actionPermissions.map((permission) => ({
    moduleKey: normalizeModuleKey(permission.moduleKey),
    actionKey: normalizeActionKey(permission.actionKey),
    allowed: Boolean(permission.allowed),
  }));
}

accessRouter.use(authenticate, authorize(["admin"]));

accessRouter.get("/sectors", async (_request, response) => {
  const items = await prisma.sector.findMany({
    orderBy: [{ name: "asc" }],
  });

  response.json({
    items,
    defaults: DEFAULT_SECTORS,
  });
});

accessRouter.post("/sectors", validate({ body: sectorSchema }), async (request, response) => {
  const key = normalizeSectorKey(request.body.key || request.body.name);
  if (!key) {
    throw new HttpError(422, "Chave de setor invalida");
  }

  const item = await prisma.sector.create({
    data: {
      key,
      name: request.body.name,
      description: request.body.description,
      active: request.body.active ?? true,
      sortOrder: 0,
    },
  });

  await writeAuditLog({
    actorUserId: request.auth.userId,
    action: "SECTOR_CREATE",
    entityType: "Sector",
    entityId: item.id,
    ipAddress: response.locals.ipAddress,
    userAgent: response.locals.userAgent,
  });

  response.status(201).json({ item });
});

accessRouter.patch(
  "/sectors/:id",
  validate({
    params: z.object({ id: cuidSchema }),
    body: sectorSchema.partial(),
  }),
  async (request, response) => {
    const current = await prisma.sector.findUnique({ where: { id: request.params.id } });
    if (!current) {
      throw new HttpError(404, "Setor nao encontrado");
    }

    const item = await prisma.sector.update({
      where: { id: current.id },
      data: {
        ...("key" in request.body ? { key: normalizeSectorKey(request.body.key || current.key) } : {}),
        ...("name" in request.body ? { name: request.body.name } : {}),
        ...("description" in request.body ? { description: request.body.description } : {}),
        ...("active" in request.body ? { active: request.body.active } : {}),
      },
    });

    await writeAuditLog({
      actorUserId: request.auth.userId,
      action: "SECTOR_UPDATE",
      entityType: "Sector",
      entityId: item.id,
      ipAddress: response.locals.ipAddress,
      userAgent: response.locals.userAgent,
      metadata: request.body,
    });

    response.json({ item });
  },
);

accessRouter.get("/modules", async (_request, response) => {
  const modules = await prisma.accessModule.findMany({
    include: {
      actions: {
        where: { active: true },
        orderBy: [{ sortOrder: "asc" }, { label: "asc" }],
      },
    },
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

  if (request.body.parentKey) {
    await ensureModulesExist([request.body.parentKey]);
  }

  const item = await prisma.accessModule.create({
    data: {
      key,
      name: request.body.name,
      description: request.body.description,
      parentKey: request.body.parentKey ? normalizeModuleKey(request.body.parentKey) : null,
      path: request.body.path || null,
      scope: request.body.scope || "MODULE",
      active: request.body.active ?? true,
      sortOrder: request.body.sortOrder ?? 999,
      isSystem: false,
    },
  });

  await writeAuditLog({
    actorUserId: request.auth.userId,
    action: "ACCESS_MODULE_CREATE",
    entityType: "AccessModule",
    entityId: item.key,
    ipAddress: response.locals.ipAddress,
    userAgent: response.locals.userAgent,
  });

  response.status(201).json({ item });
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

    if (request.body.parentKey) {
      await ensureModulesExist([request.body.parentKey]);
    }

    const item = await prisma.accessModule.update({
      where: { key: current.key },
      data: {
        key: nextKey,
        ...("name" in request.body ? { name: request.body.name } : {}),
        ...("description" in request.body ? { description: request.body.description } : {}),
        ...("parentKey" in request.body
          ? { parentKey: request.body.parentKey ? normalizeModuleKey(request.body.parentKey) : null }
          : {}),
        ...("path" in request.body ? { path: request.body.path || null } : {}),
        ...("scope" in request.body ? { scope: request.body.scope } : {}),
        ...("active" in request.body ? { active: request.body.active } : {}),
        ...("sortOrder" in request.body ? { sortOrder: request.body.sortOrder } : {}),
      },
    });

    await writeAuditLog({
      actorUserId: request.auth.userId,
      action: "ACCESS_MODULE_UPDATE",
      entityType: "AccessModule",
      entityId: item.key,
      ipAddress: response.locals.ipAddress,
      userAgent: response.locals.userAgent,
      metadata: request.body,
    });

    response.json({ item });
  },
);

accessRouter.get("/actions", async (_request, response) => {
  const items = hasAccessActionModel()
    ? await prisma.accessAction.findMany({
        where: { active: true },
        orderBy: [{ moduleKey: "asc" }, { sortOrder: "asc" }, { label: "asc" }],
      })
    : [];

  response.json({
    items,
    defaults: getDefaultActionDefinitions(),
  });
});

accessRouter.post("/actions", validate({ body: actionSchema }), async (request, response) => {
  if (!hasAccessActionModel()) {
    throw new HttpError(503, "Modelo de ações de acesso indisponível no runtime atual.");
  }

  const moduleKey = normalizeModuleKey(request.body.moduleKey);
  await ensureModulesExist([moduleKey]);

  const key = normalizeActionKey(request.body.key || request.body.label);
  if (!key) {
    throw new HttpError(422, "Chave de acao invalida");
  }

  const item = await prisma.accessAction.create({
    data: {
      moduleKey,
      key,
      label: request.body.label,
      description: request.body.description,
      active: request.body.active ?? true,
      isSystem: false,
      sortOrder: request.body.sortOrder ?? 999,
    },
  });

  await writeAuditLog({
    actorUserId: request.auth.userId,
    action: "ACCESS_ACTION_CREATE",
    entityType: "AccessAction",
    entityId: item.id,
    ipAddress: response.locals.ipAddress,
    userAgent: response.locals.userAgent,
  });

  response.status(201).json({ item });
});

accessRouter.patch(
  "/actions/:id",
  validate({
    params: z.object({ id: cuidSchema }),
    body: actionSchema.partial(),
  }),
  async (request, response) => {
    if (!hasAccessActionModel()) {
      throw new HttpError(503, "Modelo de ações de acesso indisponível no runtime atual.");
    }

    const current = await prisma.accessAction.findUnique({ where: { id: request.params.id } });
    if (!current) {
      throw new HttpError(404, "Acao nao encontrada");
    }

    const nextModuleKey =
      request.body.moduleKey !== undefined
        ? normalizeModuleKey(request.body.moduleKey)
        : current.moduleKey;

    await ensureModulesExist([nextModuleKey]);

    const item = await prisma.accessAction.update({
      where: { id: current.id },
      data: {
        moduleKey: nextModuleKey,
        ...("key" in request.body
          ? { key: normalizeActionKey(request.body.key || current.key) }
          : {}),
        ...("label" in request.body ? { label: request.body.label } : {}),
        ...("description" in request.body ? { description: request.body.description } : {}),
        ...("active" in request.body ? { active: request.body.active } : {}),
        ...("sortOrder" in request.body ? { sortOrder: request.body.sortOrder } : {}),
      },
    });

    await writeAuditLog({
      actorUserId: request.auth.userId,
      action: "ACCESS_ACTION_UPDATE",
      entityType: "AccessAction",
      entityId: item.id,
      ipAddress: response.locals.ipAddress,
      userAgent: response.locals.userAgent,
      metadata: request.body,
    });

    response.json({ item });
  },
);

accessRouter.get("/presets", async (_request, response) => {
  const items = await prisma.accessPreset.findMany({
    include: {
      modulePermissions: {
        orderBy: { moduleKey: "asc" },
      },
      actionPermissions: {
        orderBy: [{ moduleKey: "asc" }, { actionKey: "asc" }],
      },
    },
    orderBy: [{ isSystem: "desc" }, { name: "asc" }],
  });

  response.json({ items });
});

accessRouter.post("/presets", validate({ body: presetSchema }), async (request, response) => {
  const permissions = normalizePermissionInput(request.body.modulePermissions);
  const actionPermissions = normalizeActionPermissionInput(request.body.actionPermissions || []);
  await ensureModulesExist(permissions.map((item) => item.moduleKey));
  await ensureActionsExist(actionPermissions);

  const item = await prisma.accessPreset.create({
    data: {
      name: request.body.name,
      slug: slugify(request.body.slug || request.body.name),
      description: request.body.description,
      role: normalizeRole(request.body.role),
      isSystem: false,
      modulePermissions: {
        create: permissions,
      },
      actionPermissions: actionPermissions.length
        ? {
            create: actionPermissions,
          }
        : undefined,
    },
    include: {
      modulePermissions: { orderBy: { moduleKey: "asc" } },
      actionPermissions: { orderBy: [{ moduleKey: "asc" }, { actionKey: "asc" }] },
    },
  });

  await writeAuditLog({
    actorUserId: request.auth.userId,
    action: "ACCESS_PRESET_CREATE",
    entityType: "AccessPreset",
    entityId: item.id,
    ipAddress: response.locals.ipAddress,
    userAgent: response.locals.userAgent,
  });

  response.status(201).json({ item });
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
        actionPermissions: true,
      },
    });

    if (!current) {
      throw new HttpError(404, "Preset nao encontrado");
    }

    const permissions = request.body.modulePermissions
      ? normalizePermissionInput(request.body.modulePermissions)
      : null;
    const actionPermissions = request.body.actionPermissions
      ? normalizeActionPermissionInput(request.body.actionPermissions)
      : null;

    if (permissions) {
      await ensureModulesExist(permissions.map((item) => item.moduleKey));
    }
    if (actionPermissions) {
      await ensureActionsExist(actionPermissions);
    }

    const item = await prisma.$transaction(async (tx) => {
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
        if (permissions.length) {
          await tx.accessPresetPermission.createMany({
            data: permissions.map((permission) => ({
              presetId: current.id,
              moduleKey: permission.moduleKey,
              accessLevel: permission.accessLevel,
            })),
          });
        }
      }

      if (actionPermissions) {
        await tx.accessPresetActionPermission.deleteMany({
          where: { presetId: current.id },
        });
        if (actionPermissions.length) {
          await tx.accessPresetActionPermission.createMany({
            data: actionPermissions.map((permission) => ({
              presetId: current.id,
              moduleKey: permission.moduleKey,
              actionKey: permission.actionKey,
              allowed: permission.allowed,
            })),
          });
        }
      }

      return tx.accessPreset.findUnique({
        where: { id: updated.id },
        include: {
          modulePermissions: { orderBy: { moduleKey: "asc" } },
          actionPermissions: { orderBy: [{ moduleKey: "asc" }, { actionKey: "asc" }] },
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

    response.json({ item });
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
        actionPermissions: {
          orderBy: [{ moduleKey: "asc" }, { actionKey: "asc" }],
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
        actionPermissions: user.actionPermissions,
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
    const actionPermissions = request.body.actionPermissions
      ? normalizeActionPermissionInput(request.body.actionPermissions)
      : null;

    if (permissions) {
      await ensureModulesExist(permissions.map((item) => item.moduleKey));
    }
    if (actionPermissions) {
      await ensureActionsExist(actionPermissions);
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

      if (actionPermissions) {
        await tx.userActionPermission.deleteMany({
          where: { userId: user.id },
        });
        if (actionPermissions.length) {
          await tx.userActionPermission.createMany({
            data: actionPermissions.map((permission) => ({
              userId: user.id,
              moduleKey: permission.moduleKey,
              actionKey: permission.actionKey,
              allowed: permission.allowed,
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
        actionPermissions,
      },
    });

    response.json({
      item: await resolveUserAccess(user.id),
    });
  },
);
