import {
  DEFAULT_ACTIONS,
  DEFAULT_MODULES,
  DEFAULT_SECTORS,
  SYSTEM_PRESET_DEFINITIONS,
} from "../src/lib/constants.js";
import { prisma } from "../src/lib/prisma.js";
import { hashPassword } from "../src/lib/password.js";

async function syncDefaultSectors() {
  for (const sectorDefinition of DEFAULT_SECTORS) {
    await prisma.sector.upsert({
      where: { key: sectorDefinition.key },
      update: {
        name: sectorDefinition.name,
        description: sectorDefinition.description,
        sortOrder: sectorDefinition.sortOrder,
        active: true,
      },
      create: {
        ...sectorDefinition,
        active: true,
      },
    });
  }
}

async function syncDefaultModules() {
  for (const moduleDefinition of DEFAULT_MODULES) {
    await prisma.accessModule.upsert({
      where: { key: moduleDefinition.key },
      update: {
        name: moduleDefinition.name,
        description: moduleDefinition.description,
        parentKey: moduleDefinition.parentKey || null,
        path: moduleDefinition.path || null,
        scope: moduleDefinition.scope || "MODULE",
        sortOrder: moduleDefinition.sortOrder,
        active: true,
        isSystem: true,
      },
      create: {
        ...moduleDefinition,
        active: true,
        isSystem: true,
      },
    });
  }
}

async function syncDefaultActions() {
  const pageModules = DEFAULT_MODULES.filter((moduleDefinition) => moduleDefinition.scope === "PAGE");

  for (const moduleDefinition of pageModules) {
    for (const actionDefinition of DEFAULT_ACTIONS) {
      await prisma.accessAction.upsert({
        where: {
          moduleKey_key: {
            moduleKey: moduleDefinition.key,
            key: actionDefinition.key,
          },
        },
        update: {
          label: actionDefinition.label,
          description: `${actionDefinition.label} em ${moduleDefinition.name}`,
          sortOrder: actionDefinition.sortOrder,
          active: true,
          isSystem: true,
        },
        create: {
          moduleKey: moduleDefinition.key,
          key: actionDefinition.key,
          label: actionDefinition.label,
          description: `${actionDefinition.label} em ${moduleDefinition.name}`,
          sortOrder: actionDefinition.sortOrder,
          active: true,
          isSystem: true,
        },
      });
    }
  }
}

async function syncSystemPresets() {
  for (const presetDefinition of SYSTEM_PRESET_DEFINITIONS) {
    const preset = await prisma.accessPreset.upsert({
      where: { slug: presetDefinition.slug },
      update: {
        name: presetDefinition.name,
        description: presetDefinition.description,
        role: presetDefinition.role,
        isSystem: true,
      },
      create: {
        slug: presetDefinition.slug,
        name: presetDefinition.name,
        description: presetDefinition.description,
        role: presetDefinition.role,
        isSystem: true,
      },
    });

    await prisma.accessPresetPermission.deleteMany({
      where: { presetId: preset.id },
    });

    if (presetDefinition.modulePermissions.length) {
      await prisma.accessPresetPermission.createMany({
        data: presetDefinition.modulePermissions.map((permission) => ({
          presetId: preset.id,
          moduleKey: permission.moduleKey,
          accessLevel: permission.accessLevel,
        })),
      });
    }
  }
}

async function upsertAdminUser() {
  const adminName = process.env.SEED_ADMIN_NAME || "Gabriel Admin";
  const adminEmail = process.env.SEED_ADMIN_EMAIL || "gabriel@nexu.com.br";
  const adminPassword = process.env.SEED_ADMIN_PASSWORD || "Nexu@123456";
  const adminSectorInput = process.env.SEED_ADMIN_SECTOR || "DESENVOLVIMENTO";
  const passwordHash = await hashPassword(adminPassword);
  const normalizedSector = await prisma.sector.findFirst({
    where: {
      OR: [{ key: adminSectorInput }, { name: adminSectorInput }],
    },
  });

  const user = await prisma.user.upsert({
    where: { email: adminEmail },
    update: {
      name: adminName,
      role: "admin",
      sector: normalizedSector?.key || adminSectorInput,
      accessPresetId: null,
      isActive: true,
      failedLoginAttempts: 0,
      lockedUntil: null,
      passwordHash,
    },
    create: {
      name: adminName,
      email: adminEmail,
      role: "admin",
      sector: normalizedSector?.key || adminSectorInput,
      accessPresetId: null,
      isActive: true,
      failedLoginAttempts: 0,
      lockedUntil: null,
      passwordHash,
    },
  });

  await prisma.userModulePermission.deleteMany({
    where: { userId: user.id },
  });

  await prisma.userActionPermission.deleteMany({
    where: { userId: user.id },
  });

  return user;
}

async function main() {
  await syncDefaultSectors();
  await syncDefaultModules();
  await syncDefaultActions();
  await syncSystemPresets();

  const adminUser = await upsertAdminUser();

  console.log("Seed minimo concluido com sucesso.");
  console.log(`Admin pronto: ${adminUser.email}`);
  console.log("Base criada: setores, modulos, acoes, presets e usuario admin.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
