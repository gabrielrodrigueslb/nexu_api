import crypto from "node:crypto";

import { Router } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";

import { env } from "../config/env.js";
import { resolveUserAccess } from "../lib/access-control.js";
import { writeAuditLog } from "../lib/audit.js";
import { HttpError } from "../lib/http-error.js";
import { hashPassword, verifyPassword } from "../lib/password.js";
import { prisma } from "../lib/prisma.js";
import { passwordSchema } from "../lib/schemas.js";
import { serializeUser } from "../lib/serializers.js";
import {
  createTokenFamily,
  generateOpaqueToken,
  hashOpaqueToken,
  signAccessToken,
} from "../lib/tokens.js";
import { normalizeEmail } from "../lib/text.js";
import { authenticate } from "../middlewares/authenticate.js";
import { validate } from "../middlewares/validate.js";

export const authRouter = Router();

const authLimiter = rateLimit({
  windowMs: env.RATE_LIMIT_WINDOW_MS,
  limit: env.AUTH_RATE_LIMIT_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: {
    error: {
      message: "Muitas tentativas. Aguarde antes de tentar novamente.",
    },
  },
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const refreshSchema = z.object({
  refreshToken: z.string().min(40),
});

const logoutSchema = z.object({
  refreshToken: z.string().min(40),
});

const changeOwnPasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: passwordSchema,
});

async function createSession({ user, family, ipAddress, userAgent }) {
  const refreshToken = generateOpaqueToken();
  const refreshTokenHash = hashOpaqueToken(refreshToken);
  const expiresAt = new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);

  await prisma.refreshToken.create({
    data: {
      userId: user.id,
      family,
      tokenHash: refreshTokenHash,
      expiresAt,
      ipAddress,
      userAgent,
    },
  });

  return {
    tokenType: "Bearer",
    accessToken: await signAccessToken(user),
    refreshToken,
    expiresIn: env.ACCESS_TOKEN_TTL,
  };
}

async function revokeTokenFamily(family) {
  await prisma.refreshToken.updateMany({
    where: {
      family,
      revokedAt: null,
    },
    data: {
      revokedAt: new Date(),
    },
  });
}

authRouter.post("/login", authLimiter, validate({ body: loginSchema }), async (request, response) => {
  const email = normalizeEmail(request.body.email);
  const user = await prisma.user.findUnique({
    where: { email },
  });

  const invalidCredentials = new HttpError(401, "Credenciais inválidas");

  if (!user || !user.isActive) {
    throw invalidCredentials;
  }

  if (user.lockedUntil && user.lockedUntil > new Date()) {
      throw new HttpError(423, "Conta temporariamente bloqueada por excesso de tentativas");
  }

  const isValidPassword = await verifyPassword(request.body.password, user.passwordHash);

  if (!isValidPassword) {
    const failedLoginAttempts = user.failedLoginAttempts + 1;
    const mustLock = failedLoginAttempts >= env.MAX_LOGIN_ATTEMPTS;

    await prisma.user.update({
      where: { id: user.id },
      data: {
        failedLoginAttempts,
        lockedUntil: mustLock
          ? new Date(Date.now() + env.ACCOUNT_LOCK_MINUTES * 60 * 1000)
          : null,
      },
    });

    throw invalidCredentials;
  }

  const updatedUser = await prisma.user.update({
    where: { id: user.id },
    data: {
      failedLoginAttempts: 0,
      lockedUntil: null,
      lastLoginAt: new Date(),
    },
  });

  const session = await createSession({
    user: updatedUser,
    family: createTokenFamily(),
    ipAddress: response.locals.ipAddress,
    userAgent: response.locals.userAgent,
  });

  await writeAuditLog({
    actorUserId: updatedUser.id,
    action: "AUTH_LOGIN",
    entityType: "User",
    entityId: updatedUser.id,
    ipAddress: response.locals.ipAddress,
    userAgent: response.locals.userAgent,
  });

  response.json({
    ...session,
    user: serializeUser(updatedUser),
    access: await resolveUserAccess(updatedUser.id),
  });
});

authRouter.post("/refresh", validate({ body: refreshSchema }), async (request, response) => {
  const tokenHash = hashOpaqueToken(request.body.refreshToken);
  const currentToken = await prisma.refreshToken.findUnique({
    where: { tokenHash },
    include: {
      user: true,
    },
  });

  if (!currentToken) {
    throw new HttpError(401, "Refresh token inválido");
  }

  if (currentToken.revokedAt || currentToken.expiresAt <= new Date()) {
    await revokeTokenFamily(currentToken.family);
    throw new HttpError(401, "Refresh token expirado ou revogado");
  }

  if (!currentToken.user.isActive) {
    await revokeTokenFamily(currentToken.family);
    throw new HttpError(401, "Usuário desativado");
  }

  const nextRefreshToken = generateOpaqueToken();
  const nextRefreshHash = hashOpaqueToken(nextRefreshToken);

  const createdToken = await prisma.$transaction(async (tx) => {
    const created = await tx.refreshToken.create({
      data: {
        userId: currentToken.user.id,
        family: currentToken.family,
        tokenHash: nextRefreshHash,
        expiresAt: new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000),
        ipAddress: response.locals.ipAddress,
        userAgent: response.locals.userAgent,
      },
    });

    await tx.refreshToken.update({
      where: { id: currentToken.id },
      data: {
        revokedAt: new Date(),
        replacedByTokenId: created.id || crypto.randomUUID(),
      },
    });

    return created;
  });

  await writeAuditLog({
    actorUserId: currentToken.user.id,
    action: "AUTH_REFRESH",
    entityType: "RefreshToken",
    entityId: createdToken.id,
    ipAddress: response.locals.ipAddress,
    userAgent: response.locals.userAgent,
  });

  response.json({
    tokenType: "Bearer",
    accessToken: await signAccessToken(currentToken.user),
    refreshToken: nextRefreshToken,
    expiresIn: env.ACCESS_TOKEN_TTL,
    user: serializeUser(currentToken.user),
    access: await resolveUserAccess(currentToken.user.id),
  });
});

authRouter.post("/logout", validate({ body: logoutSchema }), async (request, response) => {
  const tokenHash = hashOpaqueToken(request.body.refreshToken);

  await prisma.refreshToken.updateMany({
    where: {
      tokenHash,
      revokedAt: null,
    },
    data: {
      revokedAt: new Date(),
    },
  });

  response.status(204).send();
});

authRouter.get("/me", authenticate, async (request, response) => {
  response.json({
    user: request.auth.user,
    access: await resolveUserAccess(request.auth.userId),
  });
});

authRouter.post(
  "/change-password",
  authenticate,
  validate({ body: changeOwnPasswordSchema }),
  async (request, response) => {
    const user = await prisma.user.findUnique({
      where: { id: request.auth.userId },
    });

    if (!user) {
      throw new HttpError(404, "Usuário não encontrado");
    }

    const isValidPassword = await verifyPassword(
      request.body.currentPassword,
      user.passwordHash,
    );

    if (!isValidPassword) {
      throw new HttpError(401, "Senha atual inválida");
    }

    await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: user.id },
        data: {
          passwordHash: await hashPassword(request.body.newPassword),
          sessionVersion: { increment: 1 },
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
      actorUserId: user.id,
      action: "AUTH_CHANGE_PASSWORD",
      entityType: "User",
      entityId: user.id,
      ipAddress: response.locals.ipAddress,
      userAgent: response.locals.userAgent,
    });

    response.status(204).send();
  },
);
