import crypto from "node:crypto";

import { env } from "../config/env.js";

globalThis.crypto ??= crypto.webcrypto;

const { SignJWT, jwtVerify } = await import("jose");

const accessSecret = new TextEncoder().encode(env.JWT_ACCESS_SECRET);

export async function signAccessToken(user) {
  return new SignJWT({
    role: user.role,
    sessionVersion: user.sessionVersion,
    email: user.email,
  })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(user.id)
    .setIssuer(env.JWT_ISSUER)
    .setAudience(env.JWT_AUDIENCE)
    .setIssuedAt()
    .setJti(crypto.randomUUID())
    .setExpirationTime(env.ACCESS_TOKEN_TTL)
    .sign(accessSecret);
}

export async function verifyAccessToken(token) {
  const { payload } = await jwtVerify(token, accessSecret, {
    issuer: env.JWT_ISSUER,
    audience: env.JWT_AUDIENCE,
  });

  return payload;
}

export function generateOpaqueToken() {
  return crypto.randomBytes(48).toString("base64url");
}

export function hashOpaqueToken(token) {
  return crypto.createHash("sha512").update(token).digest("hex");
}

export function createTokenFamily() {
  return crypto.randomUUID();
}
