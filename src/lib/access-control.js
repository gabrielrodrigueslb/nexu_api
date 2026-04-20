import {
  ACCESS_LEVELS,
  DEFAULT_MODULES,
  LEGACY_ROLE_ALIASES,
  MODULE_KEYS,
} from "./constants.js";
import { prisma } from "./prisma.js";

const accessRank = Object.fromEntries(ACCESS_LEVELS.map((value, index) => [value, index]));

export function normalizeRole(role) {
  return LEGACY_ROLE_ALIASES[String(role || "").trim().toLowerCase()] || "basic";
}

export function normalizeModuleKey(moduleKey) {
  return String(moduleKey || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export function compareAccessLevel(currentAccessLevel, requiredAccessLevel) {
  return (accessRank[currentAccessLevel] || 0) >= (accessRank[requiredAccessLevel] || 0);
}

export function getRoleDefaultAccess(role) {
  return normalizeRole(role) === "admin" ? "manage" : "none";
}

function toPermissionMap(items = []) {
  return new Map(items.map((item) => [item.moduleKey, item.accessLevel]));
}

export async function resolveUserAccess(userId) {
  const [user, modules] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      include: {
        accessPreset: {
          include: {
            modulePermissions: true,
          },
        },
        modulePermissions: true,
      },
    }),
    prisma.accessModule.findMany({
      where: { active: true },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    }),
  ]);

  if (!user) {
    return null;
  }

  const role = normalizeRole(user.role);

  if (role === "admin") {
    return {
      role,
      preset: user.accessPreset,
      modules: modules.map((module) => ({
        moduleKey: module.key,
        accessLevel: "manage",
        source: "role",
        module,
      })),
      permissionMap: Object.fromEntries(modules.map((module) => [module.key, "manage"])),
    };
  }

  const presetMap = toPermissionMap(user.accessPreset?.modulePermissions);
  const overrideMap = toPermissionMap(user.modulePermissions);

  const resolvedModules = modules.map((module) => {
    const overrideAccess = overrideMap.get(module.key);
    const presetAccess = presetMap.get(module.key);
    const accessLevel = overrideAccess || presetAccess || getRoleDefaultAccess(role);

    return {
      moduleKey: module.key,
      accessLevel,
      source: overrideAccess ? "user" : presetAccess ? "preset" : "role",
      module,
    };
  });

  return {
    role,
    preset: user.accessPreset,
    modules: resolvedModules,
    permissionMap: Object.fromEntries(
      resolvedModules.map((item) => [item.moduleKey, item.accessLevel]),
    ),
  };
}

export function getDefaultModuleDefinitions() {
  return DEFAULT_MODULES;
}

export function isSystemModuleKey(moduleKey) {
  return MODULE_KEYS.includes(moduleKey);
}
