import { Router } from "express";
import { z } from "zod";

import { normalizeRole, normalizeModuleKey } from "../lib/access-control.js";
import { writeAuditLog } from "../lib/audit.js";
import { ACCESS_LEVELS, USER_ROLES, USER_SECTORS } from "../lib/constants.js";
import { HttpError } from "../lib/http-error.js";
import { buildPageMeta, getPagination } from "../lib/pagination.js";
import { hashPassword } from "../lib/password.js";
import { prisma } from "../lib/prisma.js";
import { cuidSchema, paginationSchema, passwordSchema } from "../lib/schemas.js";
import { serializeUser } from "../lib/serializers.js";
import { normalizeEmail } from "../lib/text.js";
import { authenticate } from "../middlewares/authenticate.js";
import { authorize } from "../middlewares/authorize.js";
import { validate } from "../middlewares/validate.js";

export const usersRouter = Router();

const userRoleSchema = z.enum(USER_ROLES);
const userSectorSchema = z.enum(USER_SECTORS);
const accessLevelSchema = z.enum(ACCESS_LEVELS);
const userModulePermissionSchema = z.object({
  moduleKey: z.string().trim().min(2),
  accessLevel: accessLevelSchema,
});

const listUsersQuerySchema = paginationSchema.extend({
  q: z.string().trim().optional(),
  role: userRoleSchema.optional(),
  sector: userSectorSchema.optional(),
  active: z.coerce.boolean().optional(),
});

const createUserSchema = z.object({
  name: z.string().trim().min(3).max(120),
  email: z.string().email(),
  password: passwordSchema,
  role: userRoleSchema,
  sector: userSectorSchema,
  accessPresetId: cuidSchema.optional().nullable(),
  modulePermissions: z.array(userModulePermissionSchema).optional(),
  isActive: z.boolean().optional(),
});

const updateUserSchema = z.object({
  name: z.string().trim().min(3).max(120).optional(),
  role: userRoleSchema.optional(),
  sector: userSectorSchema.optional(),
  accessPresetId: cuidSchema.optional().nullable(),
  modulePermissions: z.array(userModulePermissionSchema).optional(),
  isActive: z.boolean().optional(),
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
    throw new HttpError(404, "Preset de acesso nao encontrado");
  }

  if (normalizeRole(preset.role) !== normalizeRole(role)) {
    throw new HttpError(422, "O preset precisa ser do mesmo cargo base do usuario");
  }

  return preset;
}

function normalizeModulePermissions(modulePermissions = []) {
  return modulePermissions.map((permission) => ({
    moduleKey: normalizeModuleKey(permission.moduleKey),
    accessLevel: permission.accessLevel,
  }));
}

async function ensureUserModulesExist(modulePermissions = []) {
  if (!modulePermissions.length) {
    return;
  }

  const moduleKeys = [...new Set(modulePermissions.map((permission) => permission.moduleKey))];
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
    throw new HttpError(422, `Modulos inexistentes: ${missingKeys.join(", ")}`);
  }
}

usersRouter.get(
  "/",
  authorize(["admin"]),
  validate({ query: listUsersQuerySchema }),
  async (request, response) => {
    const { page, limit, skip } = getPagination(request.query);
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
      ...(request.query.active !== undefined ? { isActive: request.query.active } : {}),
    };

    const [items, total] = await prisma.$transaction([
      prisma.user.findMany({
        where,
        orderBy: { createdAt: "desc" },
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
  "/:id",
  authorize(["admin"]),
  validate({ params: z.object({ id: cuidSchema }) }),
  async (request, response) => {
    const user = await prisma.user.findUnique({
      where: { id: request.params.id },
    });

    if (!user) {
      throw new HttpError(404, "Usuario nao encontrado");
    }

    response.json({ item: serializeUser(user) });
  },
);

usersRouter.post("/", authorize(["admin"]), validate({ body: createUserSchema }), async (request, response) => {
  const email = normalizeEmail(request.body.email);
  await validateAccessPreset(request.body.accessPresetId, request.body.role);
  const modulePermissions = normalizeModulePermissions(request.body.modulePermissions);
  await ensureUserModulesExist(modulePermissions);
  const existingUser = await prisma.user.findUnique({
    where: { email },
  });

  if (existingUser) {
    throw new HttpError(409, "Ja existe usuario com este e-mail");
  }

  const user = await prisma.user.create({
    data: {
      name: request.body.name,
      email,
      passwordHash: await hashPassword(request.body.password),
      role: normalizeRole(request.body.role),
      sector: request.body.sector,
      accessPresetId: request.body.accessPresetId,
      isActive: request.body.isActive ?? true,
      modulePermissions: modulePermissions.length
        ? {
            create: modulePermissions,
          }
        : undefined,
    },
  });

  await writeAuditLog({
    actorUserId: request.auth.userId,
    action: "USER_CREATE",
    entityType: "User",
    entityId: user.id,
    ipAddress: response.locals.ipAddress,
    userAgent: response.locals.userAgent,
  });

  response.status(201).json({ item: serializeUser(user) });
});

usersRouter.patch(
  "/:id",
  authorize(["admin"]),
  validate({
    params: z.object({ id: cuidSchema }),
    body: updateUserSchema,
  }),
  async (request, response) => {
    const existingUser = await prisma.user.findUnique({
      where: { id: request.params.id },
    });

    if (!existingUser) {
      throw new HttpError(404, "Usuario nao encontrado");
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
    await ensureUserModulesExist(modulePermissions || []);

    const user = await prisma.$transaction(async (tx) => {
      const updatedUser = await tx.user.update({
        where: { id: request.params.id },
        data: {
          ...("name" in request.body ? { name: request.body.name } : {}),
          ...("role" in request.body ? { role: normalizeRole(request.body.role) } : {}),
          ...("sector" in request.body ? { sector: request.body.sector } : {}),
          ...("isActive" in request.body ? { isActive: request.body.isActive } : {}),
          ...("accessPresetId" in request.body
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

      return updatedUser;
    });

    await writeAuditLog({
      actorUserId: request.auth.userId,
      action: "USER_UPDATE",
      entityType: "User",
      entityId: user.id,
      ipAddress: response.locals.ipAddress,
      userAgent: response.locals.userAgent,
      metadata: request.body,
    });

    response.json({ item: serializeUser(user) });
  },
);

usersRouter.post(
  "/:id/reset-password",
  authorize(["admin"]),
  validate({
    params: z.object({ id: cuidSchema }),
    body: resetPasswordSchema,
  }),
  async (request, response) => {
    const user = await prisma.user.findUnique({
      where: { id: request.params.id },
    });

    if (!user) {
      throw new HttpError(404, "Usuario nao encontrado");
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
      action: "USER_RESET_PASSWORD",
      entityType: "User",
      entityId: user.id,
      ipAddress: response.locals.ipAddress,
      userAgent: response.locals.userAgent,
    });

    response.status(204).send();
  },
);
