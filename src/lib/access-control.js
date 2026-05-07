import {
  ACCESS_LEVELS,
  DEFAULT_ACTIONS,
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

export function normalizeActionKey(actionKey) {
  return String(actionKey || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
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

function toActionMap(items = []) {
  return new Map(items.map((item) => [`${item.moduleKey}:${item.actionKey}`, Boolean(item.allowed)]));
}

function getDefaultActionAllowed(accessLevel, actionKey) {
  if (accessLevel === "manage") return true;
  if (accessLevel === "edit") {
    return ["view", "create", "edit", "export", "conclude"].includes(actionKey);
  }
  if (accessLevel === "view") {
    return ["view", "export"].includes(actionKey);
  }
  return false;
}

export async function resolveUserAccess(userId) {
  const [user, modules, actions] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      include: {
        accessPreset: {
          include: {
            modulePermissions: true,
            actionPermissions: true,
          },
        },
        modulePermissions: true,
        actionPermissions: true,
      },
    }),
    prisma.accessModule.findMany({
      where: { active: true },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    }),
    prisma.accessAction.findMany({
      where: { active: true },
      orderBy: [{ moduleKey: "asc" }, { sortOrder: "asc" }, { label: "asc" }],
    }),
  ]);

  if (!user) {
    return null;
  }

  const role = normalizeRole(user.role);

  if (role === "admin") {
    const modulesResult = modules.map((module) => ({
      moduleKey: module.key,
      accessLevel: "manage",
      source: "role",
      module,
    }));
    const actionsResult = actions.map((action) => ({
      moduleKey: action.moduleKey,
      actionKey: action.key,
      allowed: true,
      source: "role",
      action,
    }));

    return {
      role,
      preset: user.accessPreset,
      modules: modulesResult,
      permissionMap: Object.fromEntries(modulesResult.map((module) => [module.moduleKey, module.accessLevel])),
      actions: actionsResult,
      actionPermissionMap: Object.fromEntries(
        actionsResult.map((action) => [`${action.moduleKey}:${action.actionKey}`, true]),
      ),
    };
  }

  const presetMap = toPermissionMap(user.accessPreset?.modulePermissions);
  const overrideMap = toPermissionMap(user.modulePermissions);
  const presetActionMap = toActionMap(user.accessPreset?.actionPermissions);
  const overrideActionMap = toActionMap(user.actionPermissions);

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

  const resolvedActions = actions.map((action) => {
    const compositeKey = `${action.moduleKey}:${action.key}`;
    const moduleAccess = resolvedModules.find((item) => item.moduleKey === action.moduleKey)?.accessLevel || "none";
    const overrideAllowed = overrideActionMap.get(compositeKey);
    const presetAllowed = presetActionMap.get(compositeKey);
    const allowed =
      overrideAllowed !== undefined
        ? overrideAllowed
        : presetAllowed !== undefined
          ? presetAllowed
          : getDefaultActionAllowed(moduleAccess, action.key);

    return {
      moduleKey: action.moduleKey,
      actionKey: action.key,
      allowed,
      source: overrideAllowed !== undefined ? "user" : presetAllowed !== undefined ? "preset" : "role",
      action,
    };
  });

  return {
    role,
    preset: user.accessPreset,
    modules: resolvedModules,
    permissionMap: Object.fromEntries(
      resolvedModules.map((item) => [item.moduleKey, item.accessLevel]),
    ),
    actions: resolvedActions,
    actionPermissionMap: Object.fromEntries(
      resolvedActions.map((item) => [`${item.moduleKey}:${item.actionKey}`, item.allowed]),
    ),
  };
}

export function getDefaultModuleDefinitions() {
  return DEFAULT_MODULES;
}

export function getDefaultActionDefinitions() {
  return DEFAULT_ACTIONS;
}

export function isSystemModuleKey(moduleKey) {
  return MODULE_KEYS.includes(moduleKey);
}
