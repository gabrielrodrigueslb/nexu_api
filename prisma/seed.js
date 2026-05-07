import {
  DEFAULT_ACTIONS,
  DEFAULT_MODULES,
  DEFAULT_SECTORS,
  SYSTEM_PRESET_DEFINITIONS,
} from "../src/lib/constants.js";
import { buildLeadMetadataNotes } from "../src/lib/lead-metadata.js";
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

async function upsertUser({
  name,
  email,
  role,
  sector,
  password,
  accessPresetId,
  modulePermissions = [],
}) {
  const passwordHash = await hashPassword(password);
  const normalizedSector = await prisma.sector.findFirst({
    where: {
      OR: [{ key: sector }, { name: sector }],
    },
  });

  const user = await prisma.user.upsert({
    where: { email },
    update: {
      name,
      role,
      sector: normalizedSector?.key || sector,
      accessPresetId: accessPresetId || null,
      isActive: true,
      passwordHash,
    },
    create: {
      name,
      email,
      role,
      sector: normalizedSector?.key || sector,
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

async function upsertLookupData() {
  const origins = await Promise.all(
    [
      { name: "Inbound" },
      { name: "Indicacao" },
      { name: "Meta Ads" },
      { name: "Evento" },
    ].map((origin) =>
      prisma.origin.upsert({
        where: { name: origin.name },
        update: { active: true },
        create: { ...origin, active: true },
      }),
    ),
  );

  await Promise.all(
    [
      { name: "Urgente", color: "#ef4444" },
      { name: "Premium", color: "#2563eb" },
      { name: "Financeiro", color: "#16a34a" },
    ].map((tag) =>
      prisma.tag.upsert({
        where: { name: tag.name },
        update: { color: tag.color, active: true },
        create: { ...tag, active: true },
      }),
    ),
  );

  const indicators = await Promise.all(
    [
      {
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
      },
      {
        name: "Rede Growth Norte",
        docType: "CNPJ",
        docNumber: "22.333.444/0001-55",
        contact: "Aline Rocha",
        email: "aline@growthnorte.com.br",
        percentSetup: 8,
        bank: "Itaú",
        agency: "4455",
        account: "17738-9",
        pixKey: "pix@growthnorte.com.br",
      },
    ].map((indicator) =>
      prisma.indicator.upsert({
        where: { docNumber: indicator.docNumber },
        update: { ...indicator, active: true },
        create: { ...indicator, active: true },
      }),
    ),
  );

  const catalogItems = await Promise.all(
    [
      { slug: "product-implantacao", name: "Implantacao", type: "PRODUCT" },
      { slug: "product-ura", name: "URA", type: "PRODUCT" },
      { slug: "product-consultoria", name: "Consultoria", type: "PRODUCT" },
      { slug: "product-importacao-de-contato", name: "Importacao de Contato", type: "PRODUCT" },
      { slug: "product-crm", name: "CRM", type: "PRODUCT" },
      { slug: "product-pabx", name: "PABX", type: "PRODUCT" },
      { slug: "integration-whatsapp-oficial", name: "WhatsApp Oficial", type: "INTEGRATION" },
      { slug: "integration-meta-ads", name: "Meta Ads", type: "INTEGRATION" },
      { slug: "integration-erp", name: "ERP", type: "INTEGRATION" },
      { slug: "integration-webhook-financeiro", name: "Webhook Financeiro", type: "INTEGRATION" },
      { slug: "integration-api-atendimento", name: "API Atendimento", type: "INTEGRATION" },
    ].map((item) =>
      prisma.catalogItem.upsert({
        where: { slug: item.slug },
        update: { name: item.name, type: item.type, active: true },
        create: { ...item, active: true },
      }),
    ),
  );

  return {
    originsByName: Object.fromEntries(origins.map((item) => [item.name, item])),
    indicatorsByName: Object.fromEntries(indicators.map((item) => [item.name, item])),
    catalogByName: Object.fromEntries(catalogItems.map((item) => [item.name, item])),
  };
}

async function replaceLeadRelations(leadId, { tasks = [], comments = [], catalogItems = [] }, usersByEmail, catalogByName) {
  await prisma.leadTask.deleteMany({ where: { leadId } });
  await prisma.leadComment.deleteMany({ where: { leadId } });
  await prisma.leadCatalogItem.deleteMany({ where: { leadId } });

  if (tasks.length) {
    await prisma.leadTask.createMany({
      data: tasks.map((task) => ({
        leadId,
        title: task.title,
        type: task.type,
        done: task.done ?? false,
        dueDate: task.dueDate ? new Date(task.dueDate) : null,
        notes: task.notes || null,
      })),
    });
  }

  for (const comment of comments) {
    await prisma.leadComment.create({
      data: {
        leadId,
        authorUserId: usersByEmail[comment.authorEmail].id,
        message: comment.message,
        createdAt: new Date(comment.createdAt),
      },
    });
  }

  if (catalogItems.length) {
    await prisma.leadCatalogItem.createMany({
      data: catalogItems.map((item) => ({
        leadId,
        catalogItemId: catalogByName[item.name].id,
        enabled: item.enabled ?? true,
        setupInCents: Math.round((item.setupAmount || 0) * 100),
        recurringInCents: Math.round((item.recurringAmount || 0) * 100),
      })),
    });
  }
}

async function upsertLead(definition, context) {
  const existing = await prisma.lead.findFirst({
    where: { company: definition.company },
  });

  const payload = {
    company: definition.company,
    cnpj: definition.cnpj || null,
    contact: definition.contact || null,
    email: definition.email || null,
    phone: definition.phone || null,
    status: definition.status,
    valueInCents: Math.round(definition.value * 100),
    paymentMethod: definition.paymentMethod || null,
    isLite: Boolean(definition.isLite),
    sellerId: definition.sellerEmail ? context.usersByEmail[definition.sellerEmail].id : null,
    sdrId: definition.sdrEmail ? context.usersByEmail[definition.sdrEmail].id : null,
    originId: definition.originName ? context.originsByName[definition.originName].id : null,
    indicatorId: definition.indicatorName
      ? context.indicatorsByName[definition.indicatorName].id
      : null,
    createdById: context.usersByEmail[definition.createdByEmail].id,
    wonAt: definition.wonAt ? new Date(definition.wonAt) : null,
    lostAt: definition.lostAt ? new Date(definition.lostAt) : null,
    notes: buildLeadMetadataNotes({
      installment: definition.installment,
      consultant: definition.consultant,
      validUntil: definition.validUntil,
      agents: definition.agents,
      supervisors: definition.supervisors,
      admins: definition.admins,
      observations: definition.observations,
      representativeId: definition.indicatorName
        ? context.indicatorsByName[definition.indicatorName].id
        : undefined,
      representativeCommission: definition.representativeCommission,
      passThroughAmount: definition.passThroughAmount,
      lossReason: definition.lossReason,
    }),
  };

  const lead = existing
    ? await prisma.lead.update({
        where: { id: existing.id },
        data: payload,
      })
    : await prisma.lead.create({
        data: payload,
      });

  await replaceLeadRelations(
    lead.id,
    {
      tasks: definition.tasks,
      comments: definition.comments,
      catalogItems: definition.catalogItems,
    },
    context.usersByEmail,
    context.catalogByName,
  );

  return prisma.lead.findUnique({
    where: { id: lead.id },
    include: {
      ticket: true,
    },
  });
}

async function replaceTicketRelations(ticketId, { tasks = [], comments = [] }, usersByEmail) {
  await prisma.ticketTask.deleteMany({ where: { ticketId } });
  await prisma.ticketComment.deleteMany({ where: { ticketId } });

  if (tasks.length) {
    await prisma.ticketTask.createMany({
      data: tasks.map((task) => ({
        ticketId,
        assigneeId: task.assigneeEmail ? usersByEmail[task.assigneeEmail].id : null,
        title: task.title,
        done: task.done ?? false,
        dueDate: task.dueDate ? new Date(task.dueDate) : null,
      })),
    });
  }

  for (const comment of comments) {
    await prisma.ticketComment.create({
      data: {
        ticketId,
        authorUserId: usersByEmail[comment.authorEmail].id,
        message: comment.message,
        createdAt: new Date(comment.createdAt),
      },
    });
  }
}

async function upsertTicket(definition, context) {
  const existing = await prisma.ticket.findUnique({
    where: { code: definition.code },
  });

  const payload = {
    code: definition.code,
    leadId: definition.leadId || null,
    company: definition.company,
    cnpj: definition.cnpj || null,
    contact: definition.contact || null,
    email: definition.email || null,
    phone: definition.phone || null,
    instance: definition.instance || null,
    plan: definition.plan || null,
    paymentMethod: definition.paymentMethod || null,
    installment: definition.installment || null,
    type: definition.type,
    status: definition.status,
    csStatus: definition.csStatus || null,
    notes: definition.notes || null,
    cancelReason: definition.cancelReason || null,
    setupInCents: Math.round(definition.setupAmount * 100),
    recurringInCents: Math.round(definition.recurringAmount * 100),
    createdById: context.usersByEmail[definition.createdByEmail].id,
    assigneeId: context.usersByEmail[definition.assigneeEmail].id,
    technicalAssigneeId: definition.technicalAssigneeEmail
      ? context.usersByEmail[definition.technicalAssigneeEmail].id
      : null,
    canceledAt: definition.status === "cancelado" ? new Date(definition.updatedAt || definition.createdAt) : null,
    completedAt: definition.status === "concluido" ? new Date(definition.updatedAt || definition.createdAt) : null,
    createdAt: new Date(definition.createdAt),
    updatedAt: new Date(definition.updatedAt || definition.createdAt),
  };

  const ticket = existing
    ? await prisma.ticket.update({
        where: { id: existing.id },
        data: payload,
      })
    : await prisma.ticket.create({
        data: payload,
      });

  await replaceTicketRelations(
    ticket.id,
    {
      tasks: definition.tasks,
      comments: definition.comments,
    },
    context.usersByEmail,
  );

  return ticket;
}

async function seedBusinessData(context) {
  const leadDefinitions = [
    {
      company: "Atlas Energia",
      cnpj: "12.345.678/0001-10",
      contact: "Renata Moura",
      email: "renata@atlasenergia.com.br",
      phone: "11999999999",
      status: "Leads",
      value: 5200,
      paymentMethod: "Cartao",
      isLite: true,
      sellerEmail: "bianca@nexu.com.br",
      sdrEmail: "marina@nexu.com.br",
      originName: "Indicacao",
      createdByEmail: "gabriel@nexu.com.br",
      installment: "À vista",
      consultant: "Bianca Souza",
      validUntil: "2026-04-30",
      agents: 4,
      supervisors: 1,
      admins: 1,
      observations: "Lead recém-qualificado aguardando proposta final.",
      tasks: [
        {
          title: "Primeiro contato",
          type: "reuniao",
          done: false,
          dueDate: "2026-03-20T15:00:00.000Z",
        },
      ],
      comments: [
        {
          authorEmail: "bianca@nexu.com.br",
          message: "Cliente solicitou proposta com foco em WhatsApp oficial.",
          createdAt: "2026-03-18T14:30:00.000Z",
        },
      ],
      catalogItems: [
        { name: "CRM", setupAmount: 1900, recurringAmount: 690 },
        { name: "WhatsApp Oficial", setupAmount: 0, recurringAmount: 190 },
      ],
    },
    {
      company: "Prisma Log",
      cnpj: "33.109.887/0001-22",
      contact: "Marcos Teixeira",
      email: "marcos@prismalog.com.br",
      phone: "11988887777",
      status: "Qualificados",
      value: 8600,
      paymentMethod: "Boleto Bancário",
      sellerEmail: "lucas@nexu.com.br",
      sdrEmail: "leo@nexu.com.br",
      originName: "Inbound",
      createdByEmail: "gabriel@nexu.com.br",
      installment: "3x",
      consultant: "Lucas Lima",
      validUntil: "2026-05-05",
      agents: 8,
      supervisors: 2,
      admins: 1,
      observations: "Operação logística quer integração ERP e implantação dedicada.",
      tasks: [
        {
          title: "Demo comercial",
          type: "demo",
          done: true,
          dueDate: "2026-03-15T13:00:00.000Z",
          notes: "Demo aprovada pelo gerente de operações.",
        },
        {
          title: "Apresentação executiva",
          type: "reuniao",
          done: false,
          dueDate: "2026-03-21T17:00:00.000Z",
        },
      ],
      comments: [
        {
          authorEmail: "lucas@nexu.com.br",
          message: "Concorrendo com fornecedor local, preço ainda é ponto sensível.",
          createdAt: "2026-03-16T09:00:00.000Z",
        },
      ],
      catalogItems: [
        { name: "PABX", setupAmount: 2400, recurringAmount: 980 },
        { name: "ERP", setupAmount: 800, recurringAmount: 220 },
      ],
    },
    {
      company: "Nova Clin",
      cnpj: "08.556.910/0001-70",
      contact: "Patricia Nunes",
      email: "patricia@novaclin.com.br",
      phone: "11977776666",
      status: "Oportunidade Futura",
      value: 4700,
      paymentMethod: "Pix",
      sellerEmail: "carla@nexu.com.br",
      sdrEmail: "marina@nexu.com.br",
      originName: "Meta Ads",
      createdByEmail: "gabriel@nexu.com.br",
      consultant: "Carla Mendes",
      observations: "Voltar a falar após expansão da clínica no próximo trimestre.",
      tasks: [
        {
          title: "Visita técnica",
          type: "visita",
          done: false,
          dueDate: "2026-03-22T12:00:00.000Z",
        },
      ],
      comments: [],
      catalogItems: [
        { name: "CRM", setupAmount: 1500, recurringAmount: 450 },
      ],
    },
    {
      company: "ValeNet",
      cnpj: "45.222.900/0001-18",
      contact: "Eduardo Paes",
      email: "eduardo@valenet.com.br",
      phone: "11966665555",
      status: "Ganho",
      value: 9400,
      paymentMethod: "Cartao",
      sellerEmail: "bianca@nexu.com.br",
      sdrEmail: "joao@nexu.com.br",
      originName: "Evento",
      indicatorName: "Canal Parceiros Sul",
      createdByEmail: "gabriel@nexu.com.br",
      isLite: false,
      wonAt: "2026-03-14T11:30:00.000Z",
      consultant: "Bianca Souza",
      installment: "À vista",
      passThroughAmount: 1128,
      observations: "Cliente enterprise, contrato com implantação acelerada.",
      tasks: [
        {
          title: "Reunião de proposta",
          type: "reuniao",
          done: true,
          dueDate: "2026-03-14T11:30:00.000Z",
        },
      ],
      comments: [
        {
          authorEmail: "bianca@nexu.com.br",
          message: "Fechamento confirmado após aprovação do jurídico.",
          createdAt: "2026-03-14T12:15:00.000Z",
        },
      ],
      catalogItems: [
        { name: "Implantacao", setupAmount: 3200, recurringAmount: 0 },
        { name: "CRM", setupAmount: 1500, recurringAmount: 820 },
        { name: "API Atendimento", setupAmount: 500, recurringAmount: 90 },
      ],
    },
    {
      company: "Orbit Telecom",
      cnpj: "17.888.332/0001-49",
      contact: "Camila Porto",
      email: "camila@orbittelecom.com.br",
      phone: "11955554444",
      status: "Ganho",
      value: 12800,
      paymentMethod: "Boleto Bancário",
      sellerEmail: "lucas@nexu.com.br",
      sdrEmail: "leo@nexu.com.br",
      originName: "Inbound",
      indicatorName: "Rede Growth Norte",
      createdByEmail: "gabriel@nexu.com.br",
      wonAt: "2026-03-18T10:00:00.000Z",
      consultant: "Lucas Lima",
      installment: "4x",
      observations: "Projeto fechado mas implementação foi cancelada após mudança interna do cliente.",
      tasks: [
        {
          title: "Negociação final",
          type: "follow",
          done: true,
          dueDate: "2026-03-18T10:00:00.000Z",
        },
      ],
      comments: [
        {
          authorEmail: "lucas@nexu.com.br",
          message: "Cliente pediu cancelamento antes do início do onboarding.",
          createdAt: "2026-03-20T09:00:00.000Z",
        },
      ],
      catalogItems: [
        { name: "PABX", setupAmount: 1800, recurringAmount: 580 },
        { name: "URA", setupAmount: 900, recurringAmount: 210 },
        { name: "ERP", setupAmount: 1200, recurringAmount: 0 },
      ],
    },
    {
      company: "Aster Labs",
      cnpj: "52.310.440/0001-61",
      contact: "Diego Ferreira",
      email: "diego@asterlabs.com.br",
      phone: "11944443333",
      status: "No Show",
      value: 3900,
      paymentMethod: "Pix",
      sellerEmail: "bianca@nexu.com.br",
      sdrEmail: "joao@nexu.com.br",
      originName: "Evento",
      createdByEmail: "gabriel@nexu.com.br",
      observations: "Reagendar em abril com nova agenda do decisor.",
      tasks: [
        {
          title: "Nova tentativa",
          type: "reuniao",
          done: false,
          dueDate: "2026-03-20T16:00:00.000Z",
        },
      ],
      comments: [],
      catalogItems: [
        { name: "CRM", setupAmount: 800, recurringAmount: 390 },
      ],
    },
    {
      company: "Urban Food",
      cnpj: "64.221.330/0001-09",
      contact: "Talita Sampaio",
      email: "talita@urbanfood.com.br",
      phone: "11933332222",
      status: "Ganho",
      value: 8100,
      paymentMethod: "Boleto Bancário",
      sellerEmail: "carla@nexu.com.br",
      sdrEmail: "leo@nexu.com.br",
      originName: "Inbound",
      indicatorName: "Canal Parceiros Sul",
      createdByEmail: "gabriel@nexu.com.br",
      isLite: true,
      wonAt: "2026-03-16T14:45:00.000Z",
      consultant: "Carla Mendes",
      installment: "À vista",
      observations: "Cliente de food service com onboarding rápido.",
      tasks: [
        {
          title: "Kickoff inicial",
          type: "reuniao",
          done: true,
          dueDate: "2026-03-16T14:45:00.000Z",
        },
      ],
      comments: [
        {
          authorEmail: "carla@nexu.com.br",
          message: "Venda concluída com foco em CRM + WhatsApp.",
          createdAt: "2026-03-16T15:00:00.000Z",
        },
      ],
      catalogItems: [
        { name: "Implantacao", setupAmount: 1700, recurringAmount: 0 },
        { name: "CRM", setupAmount: 1200, recurringAmount: 690 },
        { name: "WhatsApp Oficial", setupAmount: 300, recurringAmount: 200 },
      ],
    },
    {
      company: "Solaris Hub",
      cnpj: "70.112.220/0001-33",
      contact: "Bianca Prado",
      email: "bianca@solarishub.com.br",
      phone: "11922221111",
      status: "Ganho",
      value: 10400,
      paymentMethod: "Cartao",
      sellerEmail: "bianca@nexu.com.br",
      sdrEmail: "marina@nexu.com.br",
      originName: "Indicacao",
      indicatorName: "Rede Growth Norte",
      createdByEmail: "gabriel@nexu.com.br",
      isLite: true,
      wonAt: "2026-03-19T13:20:00.000Z",
      consultant: "Bianca Souza",
      installment: "2x",
      observations: "Cliente já com pagamento confirmado, aguardando implantação.",
      tasks: [
        {
          title: "Demo final",
          type: "demo",
          done: true,
          dueDate: "2026-03-13T10:00:00.000Z",
        },
        {
          title: "Visita de implantação",
          type: "visita",
          done: true,
          dueDate: "2026-03-16T11:00:00.000Z",
        },
      ],
      comments: [
        {
          authorEmail: "bianca@nexu.com.br",
          message: "Pagamento confirmado com cartão corporativo.",
          createdAt: "2026-03-19T15:00:00.000Z",
        },
      ],
      catalogItems: [
        { name: "Implantacao", setupAmount: 2400, recurringAmount: 0 },
        { name: "CRM", setupAmount: 1600, recurringAmount: 890 },
        { name: "Consultoria", setupAmount: 700, recurringAmount: 0 },
      ],
    },
    {
      company: "Nexa Tech",
      cnpj: "14.980.776/0001-52",
      contact: "Henrique Luz",
      email: "henrique@nexatech.com.br",
      phone: "11911110000",
      status: "Perdido",
      value: 5300,
      paymentMethod: "Pix",
      sellerEmail: "carla@nexu.com.br",
      sdrEmail: "marina@nexu.com.br",
      originName: "Meta Ads",
      createdByEmail: "gabriel@nexu.com.br",
      lostAt: "2026-03-21T18:00:00.000Z",
      lossReason: "Concorrente já homologado pelo grupo.",
      observations: "Perda por fornecedor legado.",
      tasks: [
        {
          title: "Último follow-up",
          type: "follow",
          done: false,
          dueDate: "2026-03-19T18:00:00.000Z",
        },
      ],
      comments: [
        {
          authorEmail: "carla@nexu.com.br",
          message: "Encerrar negociação e retomar em 6 meses.",
          createdAt: "2026-03-21T18:10:00.000Z",
        },
      ],
      catalogItems: [
        { name: "CRM", setupAmount: 1100, recurringAmount: 430 },
      ],
    },
    {
      company: "Bravus Seg",
      cnpj: "29.775.001/0001-61",
      contact: "Luciana Mello",
      email: "luciana@bravusseg.com.br",
      phone: "11910101010",
      status: "Ganho",
      value: 9600,
      paymentMethod: "Boleto Bancário",
      sellerEmail: "bianca@nexu.com.br",
      sdrEmail: "joao@nexu.com.br",
      originName: "Indicacao",
      indicatorName: "Canal Parceiros Sul",
      createdByEmail: "gabriel@nexu.com.br",
      wonAt: "2026-03-22T09:30:00.000Z",
      consultant: "Bianca Souza",
      installment: "À vista",
      observations: "Projeto já em implantação com técnico dedicado.",
      tasks: [
        {
          title: "Documentação inicial",
          type: "visita",
          done: false,
          dueDate: "2026-03-23T14:00:00.000Z",
        },
      ],
      comments: [
        {
          authorEmail: "bianca@nexu.com.br",
          message: "Cliente priorizou go-live ainda em março.",
          createdAt: "2026-03-22T10:00:00.000Z",
        },
      ],
      catalogItems: [
        { name: "Implantacao", setupAmount: 2700, recurringAmount: 0 },
        { name: "PABX", setupAmount: 1800, recurringAmount: 740 },
        { name: "Webhook Financeiro", setupAmount: 700, recurringAmount: 120 },
      ],
    },
    {
      company: "Horizonte ERP",
      cnpj: "54.876.900/0001-28",
      contact: "Rafael Gomes",
      email: "rafael@horizonteerp.com.br",
      phone: "11920202020",
      status: "Em Negociacao",
      value: 15600,
      paymentMethod: "Transferência",
      sellerEmail: "lucas@nexu.com.br",
      sdrEmail: "leo@nexu.com.br",
      originName: "Evento",
      createdByEmail: "gabriel@nexu.com.br",
      consultant: "Lucas Lima",
      observations: "Negociação em andamento com operação nacional.",
      tasks: [
        {
          title: "Reunião financeira",
          type: "reuniao",
          done: false,
          dueDate: "2026-03-24T15:00:00.000Z",
        },
      ],
      comments: [],
      catalogItems: [
        { name: "Consultoria", setupAmount: 3500, recurringAmount: 0 },
        { name: "ERP", setupAmount: 2200, recurringAmount: 290 },
      ],
    },
  ];

  const leads = [];
  for (const definition of leadDefinitions) {
    leads.push(await upsertLead(definition, context));
  }

  const leadsByCompany = Object.fromEntries(leads.map((lead) => [lead.company, lead]));

  const ticketDefinitions = [
    {
      code: "COM-100001",
      leadId: leadsByCompany["Urban Food"].id,
      company: "Urban Food",
      cnpj: "64.221.330/0001-09",
      contact: "Talita Sampaio",
      email: "talita@urbanfood.com.br",
      phone: "11933332222",
      instance: "urbanfood",
      plan: "Lite",
      paymentMethod: "Boleto Bancário",
      installment: "À vista",
      type: "novo",
      status: "pendente_financeiro",
      csStatus: "Novo Ticket",
      notes: "Aguardando geração de cobrança e assinatura do contrato.",
      setupAmount: 3200,
      recurringAmount: 890,
      createdByEmail: "moara@nexu.com.br",
      assigneeEmail: "carla@nexu.com.br",
      createdAt: "2026-03-16T16:00:00.000Z",
      updatedAt: "2026-03-16T16:00:00.000Z",
      tasks: [],
      comments: [
        {
          authorEmail: "carla@nexu.com.br",
          message: "Time financeiro precisa emitir a primeira cobrança.",
          createdAt: "2026-03-16T16:10:00.000Z",
        },
      ],
    },
    {
      code: "COM-100002",
      leadId: leadsByCompany["Solaris Hub"].id,
      company: "Solaris Hub",
      cnpj: "70.112.220/0001-33",
      contact: "Bianca Prado",
      email: "bianca@solarishub.com.br",
      phone: "11922221111",
      instance: "solaris-hub",
      plan: "Lite",
      paymentMethod: "Cartao",
      installment: "2x",
      type: "upsell",
      status: "pagamento_confirmado",
      csStatus: "Pagamento Confirmado",
      notes: "Pagamento aprovado e aguardando disponibilidade técnica.",
      setupAmount: 4700,
      recurringAmount: 890,
      createdByEmail: "moara@nexu.com.br",
      assigneeEmail: "bianca@nexu.com.br",
      technicalAssigneeEmail: "igor@nexu.com.br",
      createdAt: "2026-03-19T14:00:00.000Z",
      updatedAt: "2026-03-20T10:00:00.000Z",
      tasks: [
        {
          title: "Checklist comercial",
          assigneeEmail: "igor@nexu.com.br",
          done: true,
          dueDate: "2026-03-20T10:00:00.000Z",
        },
      ],
      comments: [
        {
          authorEmail: "bianca@nexu.com.br",
          message: "Cliente já enviou documentação fiscal.",
          createdAt: "2026-03-20T09:30:00.000Z",
        },
      ],
    },
    {
      code: "COM-100003",
      leadId: leadsByCompany["Bravus Seg"].id,
      company: "Bravus Seg",
      cnpj: "29.775.001/0001-61",
      contact: "Luciana Mello",
      email: "luciana@bravusseg.com.br",
      phone: "11910101010",
      instance: "bravus-seg",
      plan: "Profissional",
      paymentMethod: "Boleto Bancário",
      installment: "À vista",
      type: "novo",
      status: "em_implantacao",
      csStatus: "Configuração",
      notes: "Projeto em implantação com integrações fiscais.",
      setupAmount: 5200,
      recurringAmount: 860,
      createdByEmail: "moara@nexu.com.br",
      assigneeEmail: "bianca@nexu.com.br",
      technicalAssigneeEmail: "igor@nexu.com.br",
      createdAt: "2026-03-22T10:20:00.000Z",
      updatedAt: "2026-03-24T09:30:00.000Z",
      tasks: [
        {
          title: "Configuração inicial da plataforma",
          assigneeEmail: "igor@nexu.com.br",
          done: true,
          dueDate: "2026-03-23T15:00:00.000Z",
        },
        {
          title: "Integração fiscal",
          assigneeEmail: "igor@nexu.com.br",
          done: false,
          dueDate: "2026-03-26T18:00:00.000Z",
        },
        {
          title: "Treinamento com operação",
          assigneeEmail: "paula@nexu.com.br",
          done: false,
          dueDate: "2026-03-27T13:00:00.000Z",
        },
      ],
      comments: [
        {
          authorEmail: "igor@nexu.com.br",
          message: "Kickoff realizado, cliente aprovou cronograma técnico.",
          createdAt: "2026-03-23T16:30:00.000Z",
        },
      ],
    },
    {
      code: "COM-100004",
      leadId: leadsByCompany["ValeNet"].id,
      company: "ValeNet",
      cnpj: "45.222.900/0001-18",
      contact: "Eduardo Paes",
      email: "eduardo@valenet.com.br",
      phone: "11966665555",
      instance: "valenet",
      plan: "Profissional",
      paymentMethod: "Cartao",
      installment: "À vista",
      type: "novo",
      status: "concluido",
      csStatus: "Bercario",
      notes: "Cliente concluído e entregue para acompanhamento do CS.",
      setupAmount: 5200,
      recurringAmount: 910,
      createdByEmail: "moara@nexu.com.br",
      assigneeEmail: "bianca@nexu.com.br",
      technicalAssigneeEmail: "paula@nexu.com.br",
      createdAt: "2026-03-14T13:00:00.000Z",
      updatedAt: "2026-03-25T11:00:00.000Z",
      tasks: [
        {
          title: "Configuração inicial da plataforma",
          assigneeEmail: "paula@nexu.com.br",
          done: true,
          dueDate: "2026-03-17T18:00:00.000Z",
        },
        {
          title: "Validação final com o cliente",
          assigneeEmail: "paula@nexu.com.br",
          done: true,
          dueDate: "2026-03-24T18:00:00.000Z",
        },
      ],
      comments: [
        {
          authorEmail: "paula@nexu.com.br",
          message: "Onboarding concluído e cliente já operando.",
          createdAt: "2026-03-25T11:00:00.000Z",
        },
      ],
    },
    {
      code: "COM-100005",
      leadId: leadsByCompany["Orbit Telecom"].id,
      company: "Orbit Telecom",
      cnpj: "17.888.332/0001-49",
      contact: "Camila Porto",
      email: "camila@orbittelecom.com.br",
      phone: "11955554444",
      instance: "orbit-telecom",
      plan: "Profissional",
      paymentMethod: "Boleto Bancário",
      installment: "4x",
      type: "upsell",
      status: "cancelado",
      csStatus: "Cancelado",
      notes: "Cancelamento solicitado antes do início do onboarding.",
      cancelReason: "Reestruturação interna do cliente.",
      setupAmount: 3900,
      recurringAmount: 790,
      createdByEmail: "moara@nexu.com.br",
      assigneeEmail: "lucas@nexu.com.br",
      technicalAssigneeEmail: "igor@nexu.com.br",
      createdAt: "2026-03-18T12:00:00.000Z",
      updatedAt: "2026-03-20T09:00:00.000Z",
      tasks: [],
      comments: [
        {
          authorEmail: "lucas@nexu.com.br",
          message: "Ticket cancelado após solicitação formal do cliente.",
          createdAt: "2026-03-20T09:15:00.000Z",
        },
      ],
    },
  ];

  const tickets = [];
  for (const definition of ticketDefinitions) {
    tickets.push(await upsertTicket(definition, context));
  }

  const ticketsByCode = Object.fromEntries(tickets.map((ticket) => [ticket.code, ticket]));

  await prisma.indicatorPayment.upsert({
    where: { leadId: leadsByCompany["Urban Food"].id },
    create: {
      leadId: leadsByCompany["Urban Food"].id,
      indicatorId: context.indicatorsByName["Canal Parceiros Sul"].id,
      indicatorNameSnapshot: "Canal Parceiros Sul",
      leadCompanySnapshot: "Urban Food",
      amountInCents: 38400,
      status: "pending",
      dueDate: new Date("2026-03-20T00:00:00.000Z"),
      notes: "Pagamento previsto para o fechamento da semana.",
    },
    update: {
      indicatorId: context.indicatorsByName["Canal Parceiros Sul"].id,
      indicatorNameSnapshot: "Canal Parceiros Sul",
      leadCompanySnapshot: "Urban Food",
      amountInCents: 38400,
      status: "pending",
      dueDate: new Date("2026-03-20T00:00:00.000Z"),
      notes: "Pagamento previsto para o fechamento da semana.",
      paidAt: null,
      paidByUserId: null,
    },
  });

  await prisma.indicatorPayment.upsert({
    where: { leadId: leadsByCompany["Solaris Hub"].id },
    create: {
      leadId: leadsByCompany["Solaris Hub"].id,
      indicatorId: context.indicatorsByName["Rede Growth Norte"].id,
      indicatorNameSnapshot: "Rede Growth Norte",
      leadCompanySnapshot: "Solaris Hub",
      amountInCents: 37600,
      status: "paid",
      dueDate: new Date("2026-03-21T00:00:00.000Z"),
      paidAt: new Date("2026-03-22T15:00:00.000Z"),
      notes: "Pagamento efetuado via PIX.",
      paidByUserId: context.usersByEmail["fernanda.financeiro@nexu.com.br"].id,
    },
    update: {
      indicatorId: context.indicatorsByName["Rede Growth Norte"].id,
      indicatorNameSnapshot: "Rede Growth Norte",
      leadCompanySnapshot: "Solaris Hub",
      amountInCents: 37600,
      status: "paid",
      dueDate: new Date("2026-03-21T00:00:00.000Z"),
      paidAt: new Date("2026-03-22T15:00:00.000Z"),
      notes: "Pagamento efetuado via PIX.",
      paidByUserId: context.usersByEmail["fernanda.financeiro@nexu.com.br"].id,
    },
  });

  await prisma.indicatorPayment.upsert({
    where: { leadId: leadsByCompany["Bravus Seg"].id },
    create: {
      leadId: leadsByCompany["Bravus Seg"].id,
      indicatorId: context.indicatorsByName["Canal Parceiros Sul"].id,
      indicatorNameSnapshot: "Canal Parceiros Sul",
      leadCompanySnapshot: "Bravus Seg",
      amountInCents: 62400,
      status: "pending",
      dueDate: new Date("2026-03-26T00:00:00.000Z"),
      notes: "Pagamento liberado após confirmação do setup.",
    },
    update: {
      indicatorId: context.indicatorsByName["Canal Parceiros Sul"].id,
      indicatorNameSnapshot: "Canal Parceiros Sul",
      leadCompanySnapshot: "Bravus Seg",
      amountInCents: 62400,
      status: "pending",
      dueDate: new Date("2026-03-26T00:00:00.000Z"),
      notes: "Pagamento liberado após confirmação do setup.",
      paidAt: null,
      paidByUserId: null,
    },
  });

  return { leadsByCompany, ticketsByCode };
}

async function upsertFinanceSnapshot() {
  const caixa = {
    referencia: "2026-03-18",
    contas: [
      {
        nome: "Banco Inter",
        saldoInicial: 18250,
        chequeEspecial: 5000,
        saldoFinal: 24610,
      },
      {
        nome: "Caixa Operacional",
        saldoInicial: 9640,
        chequeEspecial: 2500,
        saldoFinal: 11780,
      },
      {
        nome: "Aplicacao CDI",
        saldoInicial: 38000,
        chequeEspecial: 0,
        saldoFinal: 38000,
      },
    ],
    saldoInicial: 27890,
    totalDespesas: 5340,
    subTotal1: 16240,
    chequeEspecialTotal: 7500,
    saldoFinalGeral: 38890,
    aplicacao: 38000,
    dias: [
      { data: "2026-03-18", semana: "quarta-feira", receita: 4200, despesa: 2480, saldoDiario: 1720 },
      { data: "2026-03-19", semana: "quinta-feira", receita: 0, despesa: 890, saldoDiario: 830 },
      { data: "2026-03-20", semana: "sexta-feira", receita: 6800, despesa: 0, saldoDiario: 7630 },
      { data: "2026-03-21", semana: "sábado", receita: 0, despesa: 0, saldoDiario: 7630 },
      { data: "2026-03-22", semana: "domingo", receita: 0, despesa: 1350, saldoDiario: 6280 },
      { data: "2026-03-23", semana: "segunda-feira", receita: 3500, despesa: 0, saldoDiario: 9780 },
      { data: "2026-03-24", semana: "terça-feira", receita: 0, despesa: 620, saldoDiario: 9160 },
      { data: "2026-03-25", semana: "quarta-feira", receita: 0, despesa: 0, saldoDiario: 9160 },
      { data: "2026-03-26", semana: "quinta-feira", receita: 3150, despesa: 0, saldoDiario: 12310 },
    ],
    inadimplencia: {
      buckets: [
        { label: "De 01 a 03 Dias", valor: 1850, pct: 0.2566 },
        { label: "De 04 a 06 Dias", valor: 2980, pct: 0.4133 },
        { label: "Acima de 30 Dias", valor: 2400, pct: 0.3331 },
      ],
      total: 7230,
      receitaRecorrente: 18150,
      pctRecorrente: 0.3983,
    },
    fluxoRealizado: {
      receita: 7700,
      despesa: 890,
    },
    fluxoPendente: {
      receita: 11650,
      despesa: 4450,
    },
    saldoBancos: 24610,
  };

  const despesas = [
    {
      fornecedor: "Amazon AWS",
      vencimento: "18/03/2026",
      _vencRaw: "2026-03-18",
      situacao: "Pendente",
      valor: 2480,
      emAberto: 2480,
      pago: 0,
      categoria: "Infraestrutura",
      centroCusto: "Tecnologia",
      conta: "Banco Inter",
    },
    {
      fornecedor: "RD Station",
      vencimento: "19/03/2026",
      _vencRaw: "2026-03-19",
      situacao: "Quitado",
      valor: 890,
      emAberto: 0,
      pago: 890,
      categoria: "Marketing",
      centroCusto: "Comercial",
      conta: "Banco Inter",
    },
    {
      fornecedor: "Contabilidade Prime",
      vencimento: "22/03/2026",
      _vencRaw: "2026-03-22",
      situacao: "Pendente",
      valor: 1350,
      emAberto: 1350,
      pago: 0,
      categoria: "Administrativo",
      centroCusto: "Financeiro",
      conta: "Caixa Operacional",
    },
    {
      fornecedor: "Google Workspace",
      vencimento: "24/03/2026",
      _vencRaw: "2026-03-24",
      situacao: "Pendente",
      valor: 620,
      emAberto: 620,
      pago: 0,
      categoria: "Assinaturas",
      centroCusto: "Tecnologia",
      conta: "Caixa Operacional",
    },
  ];

  const receitas = [
    {
      cliente: "Atlas Energia",
      vencimento: "18/03/2026",
      _vencRaw: "2026-03-18",
      situacao: "Recebido",
      valor: 4200,
      emAberto: 0,
      recebido: 4200,
      categoria: "Mensalidade",
      centroCusto: "SaaS",
      conta: "Banco Inter",
      obs: "",
    },
    {
      cliente: "ValeNet",
      vencimento: "20/03/2026",
      _vencRaw: "2026-03-20",
      situacao: "Pendente",
      valor: 6800,
      emAberto: 6800,
      recebido: 0,
      categoria: "Setup",
      centroCusto: "Implantacao",
      conta: "Caixa Operacional",
      obs: "Cobrança gerada aguardando liquidação.",
    },
    {
      cliente: "Orbit Telecom",
      vencimento: "23/03/2026",
      _vencRaw: "2026-03-23",
      situacao: "Parcial",
      valor: 5200,
      emAberto: 1700,
      recebido: 3500,
      categoria: "Mensalidade",
      centroCusto: "SaaS",
      conta: "Banco Inter",
      obs: "",
    },
    {
      cliente: "Nova Clin",
      vencimento: "26/03/2026",
      _vencRaw: "2026-03-26",
      situacao: "Pendente",
      valor: 3150,
      emAberto: 3150,
      recebido: 0,
      categoria: "Mensalidade",
      centroCusto: "SaaS",
      conta: "Caixa Operacional",
      obs: "",
    },
  ];

  const atrasadas = [
    {
      cliente: "Urban Food",
      vencimento: "08/03/2026",
      _vencRaw: "2026-03-08",
      situacao: "Atrasado",
      valor: 2400,
      emAberto: 2400,
      recebido: 0,
      categoria: "Mensalidade",
      centroCusto: "SaaS",
      conta: "Banco Inter",
      obs: "Renegociação em andamento",
    },
    {
      cliente: "Aster Labs",
      vencimento: "12/03/2026",
      _vencRaw: "2026-03-12",
      situacao: "Atrasado",
      valor: 1850,
      emAberto: 1850,
      recebido: 0,
      categoria: "Mensalidade",
      centroCusto: "SaaS",
      conta: "Caixa Operacional",
      obs: "Contato financeiro pendente",
    },
    {
      cliente: "Prisma Log",
      vencimento: "16/03/2026",
      _vencRaw: "2026-03-16",
      situacao: "Atrasado",
      valor: 2980,
      emAberto: 2980,
      recebido: 0,
      categoria: "Mensalidade",
      centroCusto: "SaaS",
      conta: "Banco Inter",
      obs: "Boleto reenviado",
    },
  ];

  const current = await prisma.financeFlowSnapshot.findFirst({
    orderBy: [{ importedAt: "desc" }, { createdAt: "desc" }],
  });

  const payload = {
    referenceDate: new Date("2026-03-18T00:00:00.000Z"),
    importedAt: new Date("2026-03-18T08:00:00.000Z"),
    caixaJson: JSON.stringify(caixa),
    expensesJson: JSON.stringify(despesas),
    revenuesJson: JSON.stringify(receitas),
    overdueJson: JSON.stringify(atrasadas),
  };

  if (current) {
    await prisma.financeFlowSnapshot.update({
      where: { id: current.id },
      data: payload,
    });
  } else {
    await prisma.financeFlowSnapshot.create({
      data: payload,
    });
  }
}

async function seedDevelopmentData({ usersByEmail }) {
  await prisma.devTicketComment.deleteMany();
  await prisma.devTicket.deleteMany();
  await prisma.devSprint.deleteMany();

  const sprint27 = await prisma.devSprint.create({
    data: {
      name: "Sprint 27",
      goal: "Padronizar os componentes do fluxo de desenvolvimento.",
      startDate: new Date("2026-03-22T00:00:00.000Z"),
      endDate: new Date("2026-03-31T23:59:59.000Z"),
      closed: true,
      closedAt: new Date("2026-03-31T18:00:00.000Z"),
      createdAt: new Date("2026-03-20T10:00:00.000Z"),
    },
  });
  const sprint28 = await prisma.devSprint.create({
    data: {
      name: "Sprint 28",
      goal: "Entregar ajustes de Habilis, performance e modal de task.",
      startDate: new Date("2026-04-01T00:00:00.000Z"),
      endDate: new Date("2026-04-08T23:59:59.000Z"),
      closed: false,
      createdAt: new Date("2026-03-31T10:00:00.000Z"),
    },
  });
  const sprint29 = await prisma.devSprint.create({
    data: {
      name: "Sprint 29",
      goal: "Preparar a timeline compartilhada entre CRM e desenvolvimento.",
      startDate: new Date("2026-04-09T00:00:00.000Z"),
      endDate: new Date("2026-04-16T23:59:59.000Z"),
      closed: false,
      createdAt: new Date("2026-04-02T10:00:00.000Z"),
    },
  });

  const ticketDefinitions = [
    {
      proto: "DEV-202604-410101",
      title: "Epic: revisar o fluxo de protocolos Habilis",
      category: "Processo / Fluxo",
      devType: "Epic",
      devStatus: "Analise",
      complexity: "Complexa",
      score: 11,
      totalPts: 6,
      createdByEmail: "moara@nexu.com.br",
      assigneeEmail: "ana.dev@nexu.com.br",
      sprintId: sprint28.id,
      clientName: "Habilis",
      description:
        "Revisão completa do fluxo de tickets Habilis para eliminar gargalos entre análise, desenvolvimento e entrega.",
      protoExt: "EXT-240",
      instance: "HABILIS",
      tags: ["tag-habilis"],
      criteria: { imp: 3, ris: 3, fre: 3, esf: 3, deb: 1 },
      history: [
        {
          id: "history-410101-1",
          user: "Moara Pereira",
          message: "Ticket criado",
          createdAt: "01/04/2026 09:12",
        },
      ],
      createdAt: "2026-04-01T09:12:00.000Z",
      startDate: "2026-04-02T00:00:00.000Z",
      deadline: "2026-04-10T00:00:00.000Z",
      comments: [
        {
          authorEmail: "moara@nexu.com.br",
          message: "Mapeei os pontos críticos do fluxo atual e deixei a proposta inicial pronta.",
          createdAt: new Date("2026-04-01T09:12:00.000Z"),
        },
      ],
    },
    {
      proto: "DEV-202604-410102",
      title: "Ajustar validação do protocolo externo no cadastro",
      category: "Habilis",
      devType: "Bug",
      devStatus: "Backlog",
      complexity: "Complexa",
      score: 13,
      totalPts: 7,
      createdByEmail: "moara@nexu.com.br",
      assigneeEmail: "bruno.dev@nexu.com.br",
      sprintId: sprint28.id,
      clientName: "Habilis",
      description:
        "O campo de protocolo externo está aceitando formatos inválidos e gerando inconsistência na busca global.",
      protoExt: "EXT-241",
      instance: "HABILIS",
      cnpj: "00.000.000/0001-00",
      clientPhone: "(11) 99999-0000",
      tags: ["tag-habilis", "tag-hotfix"],
      criteria: { imp: 3, ris: 3, fre: 3, esf: 3, deb: 1 },
      prodBug: true,
      criticalBug: true,
      history: [
        {
          id: "history-410102-1",
          user: "Ana Souza",
          message: "Ticket criado",
          createdAt: "01/04/2026 10:40",
        },
      ],
      createdAt: "2026-04-01T10:40:00.000Z",
      deadline: "2026-04-05T00:00:00.000Z",
      comments: [
        {
          authorEmail: "ana.dev@nexu.com.br",
          message: "Bug reproduzido em produção com dois exemplos enviados pelo suporte.",
          createdAt: new Date("2026-04-01T10:40:00.000Z"),
        },
        {
          authorEmail: "bruno.dev@nexu.com.br",
          message: "Sugestão é centralizar a regex no helper compartilhado.",
          createdAt: new Date("2026-04-01T11:08:00.000Z"),
        },
      ],
    },
    {
      proto: "DEV-202604-410103",
      title: "Novo card de resumo para integrações Meta",
      category: "UX / Interface",
      devType: "Feature",
      devStatus: "Pronto para Desenvolver",
      complexity: "Media",
      score: 8,
      totalPts: 4,
      createdByEmail: "gabriel@nexu.com.br",
      assigneeEmail: "carla.dev@nexu.com.br",
      sprintId: sprint28.id,
      clientName: "Meta",
      description:
        "Criar um novo card visual para exibir saúde da integração Meta sem alterar o restante do dashboard.",
      protoExt: "EXT-242",
      instance: "META",
      tags: ["tag-meta", "tag-ux"],
      criteria: { imp: 2, ris: 2, fre: 2, esf: 1, deb: 1 },
      createdAt: "2026-03-31T13:00:00.000Z",
      startDate: "2026-04-03T00:00:00.000Z",
      deadline: "2026-04-08T00:00:00.000Z",
      history: [],
      comments: [],
    },
    {
      proto: "DEV-202604-410104",
      title: "Refatorar envio de anexos no modal de task",
      category: "Código / Arquitetura",
      devType: "Task",
      devStatus: "Em Desenvolvimento",
      complexity: "Media",
      score: 6,
      totalPts: 3,
      createdByEmail: "moara@nexu.com.br",
      assigneeEmail: "bruno.dev@nexu.com.br",
      sprintId: sprint28.id,
      description:
        "Separar a lógica de upload em um util compartilhado para reduzir duplicidade entre modais e detalhes.",
      tags: ["tag-prioridade"],
      criteria: { imp: 2, ris: 1, fre: 1, esf: 1, deb: 1 },
      docDone: true,
      createdAt: "2026-03-30T11:00:00.000Z",
      startDate: "2026-04-01T00:00:00.000Z",
      deadline: "2026-04-06T00:00:00.000Z",
      history: [],
      comments: [
        {
          authorEmail: "bruno.dev@nexu.com.br",
          message: "Estrutura nova já está isolada, faltando só adaptar o fluxo legado.",
          createdAt: new Date("2026-04-02T14:20:00.000Z"),
        },
      ],
    },
    {
      proto: "DEV-202604-410105",
      title: "Corrigir lentidão na busca por protocolo",
      category: "Performance",
      devType: "Bug",
      devStatus: "Testes",
      complexity: "Complexa",
      score: 10,
      totalPts: 5,
      createdByEmail: "gabriel@nexu.com.br",
      assigneeEmail: "diego.dev@nexu.com.br",
      sprintId: sprint28.id,
      clientName: "Busca Global",
      description:
        "A busca por protocolo apresenta atraso perceptível em bases maiores. Ajuste já foi implementado e aguarda validação.",
      tags: ["tag-hotfix"],
      criteria: { imp: 2, ris: 2, fre: 2, esf: 1, deb: 1 },
      createdAt: "2026-03-29T10:00:00.000Z",
      startDate: "2026-03-31T00:00:00.000Z",
      deadline: "2026-04-04T00:00:00.000Z",
      history: [],
      comments: [
        {
          authorEmail: "diego.dev@nexu.com.br",
          message: "Teste com massa real ficou dentro do tempo esperado.",
          createdAt: new Date("2026-04-02T17:03:00.000Z"),
        },
      ],
    },
    {
      proto: "DEV-202603-410107",
      title: "Documentar checklist de deploy do módulo dev",
      category: "Documentação",
      devType: "Task",
      devStatus: "Concluido",
      complexity: "Simples",
      score: 3,
      totalPts: 2,
      createdByEmail: "moara@nexu.com.br",
      assigneeEmail: "ana.dev@nexu.com.br",
      sprintId: sprint27.id,
      description:
        "Checklist finalizado e enviado para o time junto com as observações de homologação.",
      tags: ["tag-prioridade"],
      criteria: { imp: 1, ris: 1, fre: 0, esf: 1, deb: 0 },
      docDone: true,
      createdAt: "2026-03-20T09:00:00.000Z",
      startDate: "2026-03-20T00:00:00.000Z",
      deadline: "2026-03-22T00:00:00.000Z",
      resolvedAt: "2026-03-22T17:00:00.000Z",
      history: [],
      comments: [],
    },
    {
      proto: "DEV-202603-410108",
      title: "Padronizar badges de prioridade do kanban",
      category: "UX / Interface",
      devType: "Task",
      devStatus: "Code Review",
      complexity: "Simples",
      score: 4,
      totalPts: 2,
      createdByEmail: "moara@nexu.com.br",
      assigneeEmail: "carla.dev@nexu.com.br",
      sprintId: sprint27.id,
      description:
        "Aplicar a mesma escala visual de prioridade em todos os cards do módulo de desenvolvimento.",
      tags: ["tag-ux"],
      criteria: { imp: 1, ris: 1, fre: 0, esf: 1, deb: 0 },
      docDone: true,
      createdAt: "2026-03-28T12:00:00.000Z",
      startDate: "2026-03-29T00:00:00.000Z",
      deadline: "2026-04-03T00:00:00.000Z",
      history: [],
      comments: [
        {
          authorEmail: "carla.dev@nexu.com.br",
          message: "Pull request aberto e aguardando revisão visual final.",
          createdAt: new Date("2026-04-02T19:11:00.000Z"),
        },
      ],
    },
    {
      proto: "DEV-202604-410109",
      title: "Preparar timeline compartilhada entre CRM e desenvolvimento",
      category: "Integração / API",
      devType: "Feature",
      devStatus: "Backlog",
      complexity: "Complexa",
      score: 9,
      totalPts: 5,
      createdByEmail: "gabriel@nexu.com.br",
      assigneeEmail: "diego.dev@nexu.com.br",
      sprintId: sprint29.id,
      description:
        "Unificar os marcos do lead e do ticket técnico em uma timeline única para consulta operacional.",
      tags: ["tag-prioridade"],
      criteria: { imp: 2, ris: 2, fre: 2, esf: 1, deb: 1 },
      createdAt: "2026-04-09T10:00:00.000Z",
      deadline: "2026-04-16T00:00:00.000Z",
      history: [],
      comments: [],
    },
  ];

  for (const definition of ticketDefinitions) {
    const ticket = await prisma.devTicket.create({
      data: {
        proto: definition.proto,
        title: definition.title,
        category: definition.category,
        devType: definition.devType,
        devStatus: definition.devStatus,
        complexity: definition.complexity,
        score: definition.score,
        totalPts: definition.totalPts,
        createdById: usersByEmail[definition.createdByEmail].id,
        assigneeId: definition.assigneeEmail
          ? usersByEmail[definition.assigneeEmail].id
          : null,
        sprintId: definition.sprintId,
        clientName: definition.clientName || null,
        protoExt: definition.protoExt || null,
        instance: definition.instance || null,
        cnpj: definition.cnpj || null,
        clientPhone: definition.clientPhone || null,
        description: definition.description,
        tagsJson: JSON.stringify(definition.tags || []),
        criteriaJson: JSON.stringify(definition.criteria || {}),
        historyJson: JSON.stringify(definition.history || []),
        incident: definition.incident || false,
        compliment: definition.compliment || false,
        docDone: definition.docDone || false,
        prodBug: definition.prodBug || false,
        reopened: definition.reopened || false,
        criticalBug: definition.criticalBug || false,
        createdAt: new Date(definition.createdAt),
        startDate: definition.startDate ? new Date(definition.startDate) : null,
        deadline: definition.deadline ? new Date(definition.deadline) : null,
        resolvedAt: definition.resolvedAt ? new Date(definition.resolvedAt) : null,
      },
    });

    for (const comment of definition.comments) {
      await prisma.devTicketComment.create({
        data: {
          ticketId: ticket.id,
          authorUserId: usersByEmail[comment.authorEmail].id,
          message: comment.message,
          createdAt: comment.createdAt,
        },
      });
    }
  }
}

async function seedCoverageData(context) {
  await upsertLead(
    {
      company: "Helix Care",
      cnpj: "70.456.123/0001-55",
      contact: "Vanessa Prado",
      email: "vanessa@helixcare.com.br",
      phone: "11933332222",
      status: "Apresentacao",
      value: 6100,
      paymentMethod: "Pix",
      sellerEmail: "carla@nexu.com.br",
      sdrEmail: "marina@nexu.com.br",
      originName: "Inbound",
      createdByEmail: "gabriel@nexu.com.br",
      consultant: "Carla Mendes",
      observations: "Lead criado para garantir cobertura do status de apresentacao no seed.",
      tasks: [
        {
          title: "Ligacao de alinhamento",
          type: "ligacao",
          done: true,
          dueDate: "2026-03-18T13:00:00.000Z",
        },
        {
          title: "Enviar resumo por email",
          type: "email",
          done: false,
          dueDate: "2026-03-19T12:00:00.000Z",
        },
        {
          title: "Follow por WhatsApp",
          type: "whatsapp",
          done: false,
          dueDate: "2026-03-19T16:00:00.000Z",
        },
        {
          title: "Registrar observacao extra",
          type: "outro",
          done: false,
          dueDate: "2026-03-20T10:00:00.000Z",
          notes: "Tarefa de cobertura para os tipos de atividade restantes.",
        },
      ],
      comments: [
        {
          authorEmail: "carla@nexu.com.br",
          message: "Apresentacao comercial agendada e materiais preparados.",
          createdAt: "2026-03-18T14:00:00.000Z",
        },
      ],
      catalogItems: [
        { name: "Consultoria", setupAmount: 1200, recurringAmount: 0 },
      ],
    },
    context,
  );

  const coverageLead = await prisma.lead.findFirst({
    where: { company: "Helix Care" },
  });

  if (coverageLead) {
    await upsertTicket(
      {
        code: "COM-100006",
        leadId: coverageLead.id,
        company: "Helix Care",
        cnpj: "70.456.123/0001-55",
        contact: "Vanessa Prado",
        email: "vanessa@helixcare.com.br",
        phone: "11933332222",
        instance: "helix-care",
        plan: "Renovacao Anual",
        paymentMethod: "Pix",
        installment: "12x",
        type: "renovacao",
        status: "pagamento_confirmado",
        csStatus: "Pagamento Confirmado",
        notes: "Ticket criado para cobrir o tipo de renovacao no seed.",
        setupAmount: 0,
        recurringAmount: 6100,
        createdByEmail: "gabriel@nexu.com.br",
        assigneeEmail: "igor@nexu.com.br",
        technicalAssigneeEmail: "ana.dev@nexu.com.br",
        createdAt: "2026-03-19T09:00:00.000Z",
        updatedAt: "2026-03-19T10:00:00.000Z",
        tasks: [
          {
            title: "Validar renovacao com CS",
            assigneeEmail: "celia@nexu.com.br",
            done: false,
            dueDate: "2026-03-21T15:00:00.000Z",
          },
        ],
        comments: [
          {
            authorEmail: "gabriel@nexu.com.br",
            message: "Renovacao inserida para validar fluxos dependentes desse tipo de ticket.",
            createdAt: "2026-03-19T09:15:00.000Z",
          },
        ],
      },
      context,
    );
  }
}

async function seedOperationalRecords({ usersByEmail, leadsByCompany, ticketsByCode }) {
  const adminUser = usersByEmail["gabriel@nexu.com.br"];
  const financeUser = usersByEmail["fernanda.financeiro@nexu.com.br"];
  const canceledTicket = ticketsByCode["COM-100005"];
  const sampleLead = leadsByCompany["Atlas Energia"];

  await prisma.refreshToken.upsert({
    where: { tokenHash: "seed-refresh-token-gabriel" },
    create: {
      userId: adminUser.id,
      family: "seed-family-gabriel",
      tokenHash: "seed-refresh-token-gabriel",
      expiresAt: new Date("2026-12-31T23:59:59.000Z"),
      ipAddress: "127.0.0.1",
      userAgent: "seed-script",
      createdAt: new Date("2026-03-18T08:00:00.000Z"),
    },
    update: {
      userId: adminUser.id,
      family: "seed-family-gabriel",
      expiresAt: new Date("2026-12-31T23:59:59.000Z"),
      revokedAt: null,
      replacedByTokenId: null,
      ipAddress: "127.0.0.1",
      userAgent: "seed-script",
    },
  });

  await prisma.auditLog.deleteMany({
    where: {
      action: {
        in: ["SEED_BOOTSTRAP", "SEED_TRASH_SAMPLE"],
      },
    },
  });

  await prisma.auditLog.createMany({
    data: [
      {
        actorUserId: adminUser.id,
        action: "SEED_BOOTSTRAP",
        entityType: "Database",
        entityId: "dev-seed",
        ipAddress: "127.0.0.1",
        userAgent: "seed-script",
        metadata: JSON.stringify({
          source: "prisma/seed.js",
          note: "Registro criado para cobrir AuditLog no seed.",
        }),
        createdAt: new Date("2026-03-18T08:05:00.000Z"),
      },
      {
        actorUserId: financeUser.id,
        action: "SEED_TRASH_SAMPLE",
        entityType: "Ticket",
        entityId: canceledTicket?.id || "seed-ticket",
        ipAddress: "127.0.0.1",
        userAgent: "seed-script",
        metadata: JSON.stringify({
          relatedLeadId: sampleLead?.id || null,
        }),
        createdAt: new Date("2026-03-18T08:10:00.000Z"),
      },
    ],
  });

  await prisma.trashItem.deleteMany({
    where: {
      entityType: "Ticket",
      entityId: canceledTicket?.id || "seed-ticket",
    },
  });

  await prisma.trashItem.create({
    data: {
      moduleKey: "LIXEIRA",
      entityType: "Ticket",
      entityId: canceledTicket?.id || "seed-ticket",
      label: "Ticket cancelado de exemplo",
      payload: JSON.stringify({
        code: canceledTicket?.code || "COM-100005",
        company: canceledTicket?.company || "Orbit Telecom",
        note: "Registro criado para cobrir TrashItem no seed.",
      }),
      deletedById: financeUser.id,
      deletedAt: new Date("2026-03-18T08:12:00.000Z"),
    },
  });
}

async function main() {
  await syncDefaultSectors();
  await syncDefaultModules();
  await syncDefaultActions();
  await syncSystemPresets();

  const basicCommercialPreset = await getPresetBySlug("basic-commercial-view");
  const basicFinancePreset = await getPresetBySlug("basic-finance-view");
  const leaderDevelopmentPreset = await getPresetBySlug("leader-development");
  const leaderFinancePreset = await getPresetBySlug("leader-finance");
  const leaderImplantacaoPreset = await getPresetBySlug("leader-implantacao");
  const leaderSupportPreset = await getPresetBySlug("leader-support");
  const developmentBasicModules = [
    { moduleKey: "DASHBOARD", accessLevel: "view" },
    { moduleKey: "DEV_KANBAN", accessLevel: "edit" },
    { moduleKey: "DEV_SPRINTS", accessLevel: "edit" },
    { moduleKey: "DEV_BIBLIOTECA", accessLevel: "view" },
    { moduleKey: "CLIENTES", accessLevel: "view" },
  ];
  const implantacaoBasicModules = [
    { moduleKey: "DASHBOARD", accessLevel: "view" },
    { moduleKey: "IMPLANTACAO_KANBAN", accessLevel: "edit" },
    { moduleKey: "IMPLANTACAO_TAREFAS", accessLevel: "edit" },
    { moduleKey: "CLIENTES", accessLevel: "view" },
  ];
  const commercialEditModules = [
    { moduleKey: "DASHBOARD", accessLevel: "view" },
    { moduleKey: "CRM_VENDA", accessLevel: "edit" },
    { moduleKey: "CRM_TAREFAS", accessLevel: "edit" },
    { moduleKey: "CRM_PERDIDOS", accessLevel: "view" },
    { moduleKey: "CLIENTES", accessLevel: "edit" },
  ];
  const commercialViewModules = [
    { moduleKey: "DASHBOARD", accessLevel: "view" },
    { moduleKey: "CRM_VENDA", accessLevel: "view" },
    { moduleKey: "CRM_TAREFAS", accessLevel: "view" },
    { moduleKey: "CRM_PERDIDOS", accessLevel: "view" },
    { moduleKey: "CLIENTES", accessLevel: "view" },
  ];
  const financeBasicModules = [
    { moduleKey: "DASHBOARD", accessLevel: "view" },
    { moduleKey: "FINANCEIRO_COBRANCA", accessLevel: "edit" },
    { moduleKey: "FINANCEIRO_INDICADORES", accessLevel: "view" },
    { moduleKey: "FINANCEIRO_FLUXO", accessLevel: "view" },
    { moduleKey: "CLIENTES", accessLevel: "view" },
  ];
  const supportBasicModules = [
    { moduleKey: "DASHBOARD", accessLevel: "view" },
    { moduleKey: "SUPORTE", accessLevel: "view" },
    { moduleKey: "CLIENTES", accessLevel: "view" },
  ];

  const users = await Promise.all([
    upsertUser({
      name: "Gabriel Admin",
      email: "gabriel@nexu.com.br",
      role: "admin",
      sector: "Desenvolvimento",
      password: "Nexu@12345",
    }),
    upsertUser({
      name: "Moara Pereira",
      email: "moara@nexu.com.br",
      role: "leader",
      sector: "Desenvolvimento",
      password: "Nexu@12345",
      accessPresetId: leaderDevelopmentPreset?.id,
    }),
    upsertUser({
      name: "Ana Souza",
      email: "ana.dev@nexu.com.br",
      role: "basic",
      sector: "Desenvolvimento",
      password: "Nexu@12345",
      modulePermissions: developmentBasicModules,
    }),
    upsertUser({
      name: "Bruno Lima",
      email: "bruno.dev@nexu.com.br",
      role: "basic",
      sector: "Desenvolvimento",
      password: "Nexu@12345",
      modulePermissions: developmentBasicModules,
    }),
    upsertUser({
      name: "Carla Nunes",
      email: "carla.dev@nexu.com.br",
      role: "basic",
      sector: "Desenvolvimento",
      password: "Nexu@12345",
      modulePermissions: developmentBasicModules,
    }),
    upsertUser({
      name: "Diego Rocha",
      email: "diego.dev@nexu.com.br",
      role: "basic",
      sector: "Desenvolvimento",
      password: "Nexu@12345",
      modulePermissions: developmentBasicModules,
    }),
    upsertUser({
      name: "Fernanda Rocha",
      email: "fernanda.financeiro@nexu.com.br",
      role: "leader",
      sector: "Financeiro",
      password: "Nexu@12345",
      accessPresetId: leaderFinancePreset?.id,
    }),
    upsertUser({
      name: "Igor Martins",
      email: "igor@nexu.com.br",
      role: "leader",
      sector: "Implantacao",
      password: "Nexu@12345",
      accessPresetId: leaderImplantacaoPreset?.id,
    }),
    upsertUser({
      name: "Paula Nascimento",
      email: "paula@nexu.com.br",
      role: "basic",
      sector: "Implantacao",
      password: "Nexu@12345",
      modulePermissions: implantacaoBasicModules,
    }),
    upsertUser({
      name: "Bianca Souza",
      email: "bianca@nexu.com.br",
      role: "basic",
      sector: "Comercial",
      password: "Nexu@12345",
      accessPresetId: basicCommercialPreset?.id,
      modulePermissions: commercialEditModules,
    }),
    upsertUser({
      name: "Lucas Lima",
      email: "lucas@nexu.com.br",
      role: "basic",
      sector: "Comercial",
      password: "Nexu@12345",
      accessPresetId: basicCommercialPreset?.id,
      modulePermissions: commercialEditModules,
    }),
    upsertUser({
      name: "Carla Mendes",
      email: "carla@nexu.com.br",
      role: "basic",
      sector: "Comercial",
      password: "Nexu@12345",
      accessPresetId: basicCommercialPreset?.id,
      modulePermissions: commercialEditModules,
    }),
    upsertUser({
      name: "Marina",
      email: "marina@nexu.com.br",
      role: "sdr",
      sector: "Comercial",
      password: "Nexu@12345",
      accessPresetId: basicCommercialPreset?.id,
      modulePermissions: commercialViewModules,
    }),
    upsertUser({
      name: "Leo Silva",
      email: "leo@nexu.com.br",
      role: "sdr",
      sector: "Comercial",
      password: "Nexu@12345",
      accessPresetId: basicCommercialPreset?.id,
      modulePermissions: commercialViewModules,
    }),
    upsertUser({
      name: "Joao Ramos",
      email: "joao@nexu.com.br",
      role: "sdr",
      sector: "Comercial",
      password: "Nexu@12345",
      accessPresetId: basicCommercialPreset?.id,
      modulePermissions: commercialViewModules,
    }),
    upsertUser({
      name: "Celia Financeiro",
      email: "celia@nexu.com.br",
      role: "basic",
      sector: "Financeiro",
      password: "Nexu@12345",
      accessPresetId: basicFinancePreset?.id,
      modulePermissions: financeBasicModules,
    }),
    upsertUser({
      name: "Sonia Suporte",
      email: "sonia.suporte@nexu.com.br",
      role: "leader",
      sector: "Suporte",
      password: "Nexu@12345",
      accessPresetId: leaderSupportPreset?.id,
    }),
    upsertUser({
      name: "Caio CS",
      email: "caio.cs@nexu.com.br",
      role: "basic",
      sector: "CS",
      password: "Nexu@12345",
      modulePermissions: supportBasicModules,
    }),
  ]);

  const usersByEmail = Object.fromEntries(users.map((user) => [user.email, user]));
  const lookupContext = await upsertLookupData();

  const businessContext = await seedBusinessData({
    ...lookupContext,
    usersByEmail,
  });

  await upsertFinanceSnapshot();
  await seedDevelopmentData({ usersByEmail });
  await seedCoverageData({
    ...lookupContext,
    usersByEmail,
  });
  await seedOperationalRecords({
    usersByEmail,
    ...businessContext,
  });

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
