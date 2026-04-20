import { hash, verify } from "@node-rs/argon2";

export async function hashPassword(password) {
  return hash(password, {
    algorithm: 2,
    memoryCost: 19456,
    timeCost: 3,
    parallelism: 1,
  });
}

export async function verifyPassword(password, passwordHash) {
  return verify(passwordHash, password);
}
