import {
  DEFAULT_MODULES,
  SYSTEM_PRESET_DEFINITIONS,
} from "../src/lib/constants.js";
import { prisma } from "../src/lib/prisma.js";
import { hashPassword } from "../src/lib/password.js";

async function syncDefaultModules() {
  for (const moduleDefinition of DEFAULT_MODULES) {
    await prisma.accessModule.upsert({
      where: { key: moduleDefinition.key },
      update: {
        name: moduleDefinition.name,
        description: moduleDefinition.description,
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

    await prisma.accessPresetPermission.createMany({
      data: presetDefinition.modulePermissions.map((permission) => ({
        presetId: preset.id,
        moduleKey: permission.moduleKey,
        accessLevel: permission.accessLevel,
      })),
    });
  }
}

async function getPresetBySlug(slug) {
  return prisma.accessPreset.findUnique({
    where: { slug },
  });
}

async function upsertUser({ name, email, role, sector, password, accessPresetId, modulePermissions = [] }) {
  const passwordHash = await hashPassword(password);

  const user = await prisma.user.upsert({
    where: { email },
    update: {
      name,
      role,
      sector,
      accessPresetId: accessPresetId || null,
      isActive: true,
      passwordHash,
    },
    create: {
      name,
      email,
      role,
      sector,
      accessPresetId: accessPresetId || null,
      isActive: true,
      passwordHash,
    },
  });

  await prisma.userModulePermission.deleteMany({
    where: { userId: user.id },
  });

  if (modulePermissions.length) {
    await prisma.userModulePermission.createMany({
      data: modulePermissions.map((permission) => ({
        userId: user.id,
        moduleKey: permission.moduleKey,
        accessLevel: permission.accessLevel,
      })),
    });
  }

  return user;
}

async function main() {
  await syncDefaultModules();
  await syncSystemPresets();

  const basicCommercialPreset = await getPresetBySlug("basic-commercial-view");
  const leaderDevelopmentPreset = await getPresetBySlug("leader-development");

  const admin = await upsertUser({
    name: "Gabriel Admin",
    email: "gabriel@nexu.com.br",
    role: "admin",
    sector: "Desenvolvimento",
    password: "Nexu@12345",
  });

  const leader = await upsertUser({
    name: "Moara Pereira",
    email: "moara@nexu.com.br",
    role: "leader",
    sector: "Desenvolvimento",
    password: "Nexu@12345",
    accessPresetId: leaderDevelopmentPreset?.id,
  });

  const seller = await upsertUser({
    name: "Bianca Souza",
    email: "bianca@nexu.com.br",
    role: "basic",
    sector: "Comercial",
    password: "Nexu@12345",
    accessPresetId: basicCommercialPreset?.id,
    modulePermissions: [
      { moduleKey: "COMMERCIAL", accessLevel: "edit" },
      { moduleKey: "DASHBOARD", accessLevel: "view" },
    ],
  });

  await Promise.all([
    prisma.origin.upsert({
      where: { name: "Inbound" },
      update: { active: true },
      create: { name: "Inbound", active: true },
    }),
    prisma.origin.upsert({
      where: { name: "Indicacao" },
      update: { active: true },
      create: { name: "Indicacao", active: true },
    }),
    prisma.sdr.upsert({
      where: { name: "Marina" },
      update: { active: true },
      create: { name: "Marina", active: true },
    }),
    prisma.sdr.upsert({
      where: { name: "Leo" },
      update: { active: true },
      create: { name: "Leo", active: true },
    }),
    prisma.tag.upsert({
      where: { name: "Urgente" },
      update: { color: "#ef4444", active: true },
      create: { name: "Urgente", color: "#ef4444", active: true },
    }),
    prisma.indicator.upsert({
      where: { docNumber: "11.222.333/0001-44" },
      update: {
        name: "Canal Parceiros Sul",
        docType: "CNPJ",
        percentSetup: 12,
        active: true,
      },
      create: {
        name: "Canal Parceiros Sul",
        docType: "CNPJ",
        docNumber: "11.222.333/0001-44",
        contact: "Renato Lima",
        email: "renato@parceirossul.com.br",
        percentSetup: 12,
        bank: "Banco do Brasil",
        agency: "1234",
        account: "99881-2",
        pixKey: "financeiro@parceirossul.com.br",
        active: true,
      },
    }),
    prisma.catalogItem.upsert({
      where: { slug: "product-crm" },
      update: { name: "CRM", type: "PRODUCT", active: true },
      create: { slug: "product-crm", name: "CRM", type: "PRODUCT", active: true },
    }),
    prisma.catalogItem.upsert({
      where: { slug: "product-pabx" },
      update: { name: "PABX", type: "PRODUCT", active: true },
      create: { slug: "product-pabx", name: "PABX", type: "PRODUCT", active: true },
    }),
    prisma.catalogItem.upsert({
      where: { slug: "integration-whatsapp-oficial" },
      update: { name: "WhatsApp Oficial", type: "INTEGRATION", active: true },
      create: {
        slug: "integration-whatsapp-oficial",
        name: "WhatsApp Oficial",
        type: "INTEGRATION",
        active: true,
      },
    }),
  ]);

  const inboundOrigin = await prisma.origin.findUnique({ where: { name: "Inbound" } });
  const marina = await prisma.sdr.findUnique({ where: { name: "Marina" } });

  const existingLead = await prisma.lead.findFirst({
    where: { company: "Atlas Energia" },
  });

  const lead =
    existingLead ||
    (await prisma.lead.create({
      data: {
        company: "Atlas Energia",
        cnpj: "12.345.678/0001-10",
        contact: "Renata Moura",
        email: "renata@atlasenergia.com.br",
        phone: "11999999999",
        status: "Leads",
        valueInCents: 520000,
        paymentMethod: "Cartao",
        isLite: true,
        sellerId: seller.id,
        sdrId: marina?.id,
        originId: inboundOrigin?.id,
        createdById: admin.id,
        tasks: {
          create: {
            title: "Primeiro contato",
            type: "reuniao",
            dueDate: new Date(),
          },
        },
      },
    }));

  const existingTicket = await prisma.ticket.findFirst({
    where: { code: "COM-100001" },
  });

  if (!existingTicket) {
    await prisma.ticket.create({
      data: {
        code: "COM-100001",
        leadId: lead.id,
        company: lead.company,
        cnpj: lead.cnpj,
        contact: lead.contact,
        email: lead.email,
        phone: lead.phone,
        type: "novo",
        status: "pendente_financeiro",
        setupInCents: 320000,
        recurringInCents: 89000,
        createdById: leader.id,
        assigneeId: seller.id,
      },
    });
  }

  console.log("Seed concluido com sucesso.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
