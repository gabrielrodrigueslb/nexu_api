import { Router } from 'express';
import { z } from 'zod';

import {
  normalizeActionKey,
  normalizeRole,
  normalizeModuleKey,
} from '../lib/access-control.js';
import { writeAuditLog } from '../lib/audit.js';
import { ACCESS_LEVELS, USER_ROLES } from '../lib/constants.js';
import { HttpError } from '../lib/http-error.js';
import { buildPageMeta, getPagination } from '../lib/pagination.js';
import { hashPassword } from '../lib/password.js';
import { prisma } from '../lib/prisma.js';
import {
  cuidSchema,
  paginationSchema,
  passwordSchema,
} from '../lib/schemas.js';
import { serializeUser } from '../lib/serializers.js';
import { moveEntityToTrash } from '../lib/trash.js';
import { normalizeEmail } from '../lib/text.js';
import { authenticate } from '../middlewares/authenticate.js';
import { authorize } from '../middlewares/authorize.js';
import { validate } from '../middlewares/validate.js';

export const usersRouter = Router();

const userRoleSchema = z.enum(USER_ROLES);
const accessLevelSchema = z.enum(ACCESS_LEVELS);
const userModulePermissionSchema = z.object({
  moduleKey: z.string().trim().min(2),
  accessLevel: accessLevelSchema,
});
const userActionPermissionSchema = z.object({
  moduleKey: z.string().trim().min(2),
  actionKey: z.string().trim().min(2),
  allowed: z.boolean(),
});

const listUsersQuerySchema = paginationSchema.extend({
  q: z.string().trim().optional(),
  role: userRoleSchema.optional(),
  sector: z.string().trim().min(2).optional(),
  active: z.coerce.boolean().optional(),
});
const userDirectoryQuerySchema = z.object({
  q: z.string().trim().optional(),
  role: userRoleSchema.optional(),
  sector: z.string().trim().min(2).optional(),
  active: z.coerce.boolean().optional(),
});

const createUserSchema = z.object({
  name: z.string().trim().min(3).max(120),
  email: z.string().email(),
  password: passwordSchema,
  role: userRoleSchema,
  sector: z.string().trim().min(2).max(120),
  accessPresetId: cuidSchema.optional().nullable(),
  modulePermissions: z.array(userModulePermissionSchema).optional(),
  actionPermissions: z.array(userActionPermissionSchema).optional(),
  isActive: z.boolean().optional(),
});

const updateUserSchema = z.object({
  name: z.string().trim().min(3).max(120).optional(),
  role: userRoleSchema.optional(),
  sector: z.string().trim().min(2).max(120).optional(),
  accessPresetId: cuidSchema.optional().nullable(),
  modulePermissions: z.array(userModulePermissionSchema).optional(),
  actionPermissions: z.array(userActionPermissionSchema).optional(),
  isActive: z.boolean().optional(),
});
const updateOwnProfileSchema = z.object({
  name: z.string().trim().min(3).max(120),
});

const resetPasswordSchema = z.object({
  newPassword: passwordSchema,
});

usersRouter.use(authenticate);

async function validateAccessPreset(accessPresetId, role) {
  if (!accessPresetId) {
    return null;
  }

  const preset = await prisma.accessPreset.findUnique({
    where: { id: accessPresetId },
  });

  if (!preset) {
    throw new HttpError(404, 'Preset de acesso não encontrado');
  }

  if (normalizeRole(preset.role) !== normalizeRole(role)) {
    throw new HttpError(
      422,
      'O preset precisa ser do mesmo cargo base do usuário',
    );
  }

  return preset;
}

async function validateSector(sector) {
  if (!sector) return null;
  const existing = await prisma.sector.findFirst({
    where: {
      OR: [{ key: sector }, { name: sector }],
      active: true,
    },
  });

  if (!existing) {
    throw new HttpError(422, 'Setor invalido');
  }

  return existing;
}

function normalizeModulePermissions(modulePermissions = []) {
  return modulePermissions.map((permission) => ({
    moduleKey: normalizeModuleKey(permission.moduleKey),
    accessLevel: permission.accessLevel,
  }));
}

function normalizeActionPermissions(actionPermissions = []) {
  return actionPermissions.map((permission) => ({
    moduleKey: normalizeModuleKey(permission.moduleKey),
    actionKey: normalizeActionKey(permission.actionKey),
    allowed: Boolean(permission.allowed),
  }));
}

async function ensureUserModulesExist(modulePermissions = []) {
  if (!modulePermissions.length) {
    return;
  }

  const moduleKeys = [
    ...new Set(modulePermissions.map((permission) => permission.moduleKey)),
  ];
  const modules = await prisma.accessModule.findMany({
    where: {
      key: { in: moduleKeys },
    },
    select: {
      key: true,
    },
  });

  const existingKeys = new Set(modules.map((module) => module.key));
  const missingKeys = moduleKeys.filter((key) => !existingKeys.has(key));

  if (missingKeys.length) {
    throw new HttpError(422, `Módulos inexistentes: ${missingKeys.join(', ')}`);
  }
}

async function ensureUserActionsExist(actionPermissions = []) {
  if (!actionPermissions.length) {
    return;
  }

  if (typeof prisma.accessAction?.findMany !== 'function') {
    return;
  }

  const actions = await prisma.accessAction.findMany({
    where: {
      OR: actionPermissions.map((permission) => ({
        moduleKey: permission.moduleKey,
        key: permission.actionKey,
      })),
    },
    select: {
      moduleKey: true,
      key: true,
    },
  });

  const existing = new Set(
    actions.map((action) => `${action.moduleKey}:${action.key}`),
  );
  const missing = actionPermissions
    .map((permission) => `${permission.moduleKey}:${permission.actionKey}`)
    .filter((key) => !existing.has(key));

  if (missing.length) {
    throw new HttpError(422, `Acoes inexistentes: ${missing.join(', ')}`);
  }
}

async function getTrashedUserIds() {
  const items = await prisma.trashItem.findMany({
    where: { entityType: 'User' },
    select: { entityId: true },
  });

  return items.map((item) => item.entityId);
}

usersRouter.get(
  '/',
  authorize(['admin']),
  validate({ query: listUsersQuerySchema }),
  async (request, response) => {
    const { page, limit, skip } = getPagination(request.query);
    const trashedUserIds = await getTrashedUserIds();
    const where = {
      ...(request.query.q
        ? {
            OR: [
              { name: { contains: request.query.q } },
              { email: { contains: request.query.q } },
            ],
          }
        : {}),
      ...(request.query.role ? { role: request.query.role } : {}),
      ...(request.query.sector ? { sector: request.query.sector } : {}),
      ...(request.query.active !== undefined
        ? { isActive: request.query.active }
        : {}),
      ...(trashedUserIds.length ? { id: { notIn: trashedUserIds } } : {}),
    };

    const [items, total] = await prisma.$transaction([
      prisma.user.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip,
      }),
      prisma.user.count({ where }),
    ]);

    response.json({
      items: items.map(serializeUser),
      meta: buildPageMeta({ page, limit, total }),
    });
  },
);

usersRouter.get(
  '/directory',
  validate({ query: userDirectoryQuerySchema }),
  async (request, response) => {
    const trashedUserIds = await getTrashedUserIds();
    const where = {
      ...(request.query.q
        ? {
            OR: [
              { name: { contains: request.query.q } },
              { email: { contains: request.query.q } },
            ],
          }
        : {}),
      ...(request.query.role ? { role: request.query.role } : {}),
      ...(request.query.sector ? { sector: request.query.sector } : {}),
      ...(request.query.active !== undefined
        ? { isActive: request.query.active }
        : { isActive: true }),
      ...(trashedUserIds.length ? { id: { notIn: trashedUserIds } } : {}),
    };

    const items = await prisma.user.findMany({
      where,
      orderBy: [{ name: 'asc' }],
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        sector: true,
        isActive: true,
      },
    });

    response.json({
      items: items.map((item) => ({
        ...item,
      })),
    });
  },
);

usersRouter.patch(
  '/me',
  validate({ body: updateOwnProfileSchema }),
  async (request, response) => {
    const user = await prisma.user.update({
      where: { id: request.auth.userId },
      data: {
        name: request.body.name,
      },
    });

    await writeAuditLog({
      actorUserId: request.auth.userId,
      action: 'USER_PROFILE_UPDATE',
      entityType: 'User',
      entityId: user.id,
      ipAddress: response.locals.ipAddress,
      userAgent: response.locals.userAgent,
      metadata: {
        name: request.body.name,
      },
    });

    response.json({ item: serializeUser(user) });
  },
);

usersRouter.get(
  '/:id',
  authorize(['admin']),
  validate({ params: z.object({ id: cuidSchema }) }),
  async (request, response) => {
    const user = await prisma.user.findUnique({
      where: { id: request.params.id },
    });

    if (!user) {
      throw new HttpError(404, 'Usuário não encontrado');
    }

    response.json({ item: serializeUser(user) });
  },
);

usersRouter.post(
  '/',
  authorize(['admin']),
  validate({ body: createUserSchema }),
  async (request, response) => {
    const email = normalizeEmail(request.body.email);
    await validateAccessPreset(request.body.accessPresetId, request.body.role);
    const sector = await validateSector(request.body.sector);
    const modulePermissions = normalizeModulePermissions(
      request.body.modulePermissions,
    );
    const actionPermissions = normalizeActionPermissions(
      request.body.actionPermissions,
    );
    await ensureUserModulesExist(modulePermissions);
    await ensureUserActionsExist(actionPermissions);
    const existingUser = await prisma.user.findUnique({
      where: { email },
    });

    if (existingUser) {
      throw new HttpError(409, 'Já existe usuário com este e-mail');
    }

    const user = await prisma.user.create({
      data: {
        name: request.body.name,
        email,
        passwordHash: await hashPassword(request.body.password),
        role: request.body.role,
        sector: sector?.key || request.body.sector,
        accessPresetId: request.body.accessPresetId,
        isActive: request.body.isActive ?? true,
        modulePermissions: modulePermissions.length
          ? {
              create: modulePermissions,
            }
          : undefined,
        actionPermissions: actionPermissions.length
          ? {
              create: actionPermissions,
            }
          : undefined,
      },
    });

    await writeAuditLog({
      actorUserId: request.auth.userId,
      action: 'USER_CREATE',
      entityType: 'User',
      entityId: user.id,
      ipAddress: response.locals.ipAddress,
      userAgent: response.locals.userAgent,
    });

    response.status(201).json({ item: serializeUser(user) });
  },
);

usersRouter.patch(
  '/:id',
  authorize(['admin']),
  validate({
    params: z.object({ id: cuidSchema }),
    body: updateUserSchema,
  }),
  async (request, response) => {
    const existingUser = await prisma.user.findUnique({
      where: { id: request.params.id },
    });

    if (!existingUser) {
      throw new HttpError(404, 'Usuário não encontrado');
    }

    const nextRole = request.body.role || existingUser.role;
    await validateAccessPreset(
      request.body.accessPresetId !== undefined
        ? request.body.accessPresetId
        : existingUser.accessPresetId,
      nextRole,
    );
    const modulePermissions = request.body.modulePermissions
      ? normalizeModulePermissions(request.body.modulePermissions)
      : null;
    const actionPermissions = request.body.actionPermissions
      ? normalizeActionPermissions(request.body.actionPermissions)
      : null;
    const sector =
      'sector' in request.body
        ? await validateSector(request.body.sector)
        : null;
    await ensureUserModulesExist(modulePermissions || []);
    await ensureUserActionsExist(actionPermissions || []);

    const user = await prisma.$transaction(async (tx) => {
      const updatedUser = await tx.user.update({
        where: { id: request.params.id },
        data: {
          ...('name' in request.body ? { name: request.body.name } : {}),
          ...('role' in request.body ? { role: request.body.role } : {}),
          ...('sector' in request.body
            ? { sector: sector?.key || request.body.sector }
            : {}),
          ...('isActive' in request.body
            ? { isActive: request.body.isActive }
            : {}),
          ...('accessPresetId' in request.body
            ? { accessPresetId: request.body.accessPresetId }
            : {}),
        },
      });

      if (modulePermissions) {
        await tx.userModulePermission.deleteMany({
          where: { userId: request.params.id },
        });

        if (modulePermissions.length) {
          await tx.userModulePermission.createMany({
            data: modulePermissions.map((permission) => ({
              userId: request.params.id,
              moduleKey: permission.moduleKey,
              accessLevel: permission.accessLevel,
            })),
          });
        }
      }

      if (actionPermissions) {
        await tx.userActionPermission.deleteMany({
          where: { userId: request.params.id },
        });

        if (actionPermissions.length) {
          await tx.userActionPermission.createMany({
            data: actionPermissions.map((permission) => ({
              userId: request.params.id,
              moduleKey: permission.moduleKey,
              actionKey: permission.actionKey,
              allowed: permission.allowed,
            })),
          });
        }
      }

      return updatedUser;
    });

    await writeAuditLog({
      actorUserId: request.auth.userId,
      action: 'USER_UPDATE',
      entityType: 'User',
      entityId: user.id,
      ipAddress: response.locals.ipAddress,
      userAgent: response.locals.userAgent,
      metadata: request.body,
    });

    response.json({ item: serializeUser(user) });
  },
);

usersRouter.post(
  '/:id/reset-password',
  authorize(['admin']),
  validate({
    params: z.object({ id: cuidSchema }),
    body: resetPasswordSchema,
  }),
  async (request, response) => {
    const user = await prisma.user.findUnique({
      where: { id: request.params.id },
    });

    if (!user) {
      throw new HttpError(404, 'Usuário não encontrado');
    }

    await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: user.id },
        data: {
          passwordHash: await hashPassword(request.body.newPassword),
          sessionVersion: { increment: 1 },
          failedLoginAttempts: 0,
          lockedUntil: null,
        },
      });

      await tx.refreshToken.updateMany({
        where: {
          userId: user.id,
          revokedAt: null,
        },
        data: {
          revokedAt: new Date(),
        },
      });
    });

    await writeAuditLog({
      actorUserId: request.auth.userId,
      action: 'USER_RESET_PASSWORD',
      entityType: 'User',
      entityId: user.id,
      ipAddress: response.locals.ipAddress,
      userAgent: response.locals.userAgent,
    });

    response.status(204).send();
  },
);

usersRouter.delete(
  '/:id',
  authorize(['admin']),
  validate({
    params: z.object({ id: cuidSchema }),
  }),
  async (request, response) => {
    if (request.params.id === request.auth.userId) {
      throw new HttpError(
        422,
        'Nao e permitido enviar seu proprio usuario para a lixeira',
      );
    }

    const existingUser = await prisma.user.findUnique({
      where: { id: request.params.id },
      include: {
        modulePermissions: true,
        actionPermissions: true,
      },
    });

    if (!existingUser) {
      throw new HttpError(404, 'Usuário nÃ£o encontrado');
    }

    const existingTrash = await prisma.trashItem.findFirst({
      where: {
        entityType: 'User',
        entityId: existingUser.id,
      },
      select: { id: true },
    });

    if (existingTrash) {
      throw new HttpError(409, 'Este usuario ja esta na lixeira');
    }

    await prisma.$transaction(async (tx) => {
      await moveEntityToTrash({
        tx,
        moduleKey: 'USUARIOS',
        entityType: 'User',
        entityId: existingUser.id,
        label: existingUser.name,
        payload: {
          user: {
            id: existingUser.id,
            name: existingUser.name,
            email: existingUser.email,
            passwordHash: existingUser.passwordHash,
            role: existingUser.role,
            sector: existingUser.sector,
            accessPresetId: existingUser.accessPresetId,
            isActive: existingUser.isActive,
            failedLoginAttempts: existingUser.failedLoginAttempts,
            lockedUntil: existingUser.lockedUntil,
            sessionVersion: existingUser.sessionVersion,
            lastLoginAt: existingUser.lastLoginAt,
            createdAt: existingUser.createdAt,
            updatedAt: existingUser.updatedAt,
          },
          modulePermissions: existingUser.modulePermissions,
          actionPermissions: existingUser.actionPermissions,
        },
        deletedById: request.auth.userId,
      });

      await tx.user.update({
        where: { id: existingUser.id },
        data: {
          isActive: false,
          sessionVersion: { increment: 1 },
          failedLoginAttempts: 0,
          lockedUntil: null,
        },
      });

      await tx.refreshToken.updateMany({
        where: {
          userId: existingUser.id,
          revokedAt: null,
        },
        data: {
          revokedAt: new Date(),
        },
      });
    });

    await writeAuditLog({
      actorUserId: request.auth.userId,
      action: 'USER_TRASH',
      entityType: 'User',
      entityId: existingUser.id,
      ipAddress: response.locals.ipAddress,
      userAgent: response.locals.userAgent,
    });

    response.status(204).send();
  },
);
