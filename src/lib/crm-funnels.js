import { slugify } from "./text.js";
import { HttpError } from "./http-error.js";

const DEFAULT_FUNNEL_NAME = "Funil Principal";
const DEFAULT_FUNNEL_SLUG = "funil-principal";
const DEFAULT_STAGE_NAMES = [
  "Leads",
  "Qualificados",
  "Oportunidade Futura",
  "Apresentacao",
  "No Show",
  "Em Negociacao",
];

function buildDefaultStages() {
  return DEFAULT_STAGE_NAMES.map((name, index) => ({
    name,
    sortOrder: index,
    active: true,
  }));
}

export function getDefaultCrmStageNames() {
  return [...DEFAULT_STAGE_NAMES];
}

export async function ensureDefaultCrmFunnel(client) {
  const existingDefault = await client.crmFunnel.findFirst({
    where: {
      isDefault: true,
    },
    include: {
      stages: {
        where: { active: true },
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      },
    },
  });

  if (existingDefault) {
    return existingDefault;
  }

  const existingAny = await client.crmFunnel.findFirst({
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    include: {
      stages: {
        where: { active: true },
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      },
    },
  });

  if (existingAny) {
    return client.crmFunnel.update({
      where: { id: existingAny.id },
      data: {
        isDefault: true,
      },
      include: {
        stages: {
          where: { active: true },
          orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
        },
      },
    });
  }

  return client.crmFunnel.create({
    data: {
      name: DEFAULT_FUNNEL_NAME,
      slug: DEFAULT_FUNNEL_SLUG,
      active: true,
      isDefault: true,
      sortOrder: 0,
      stages: {
        create: buildDefaultStages(),
      },
    },
    include: {
      stages: {
        where: { active: true },
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      },
    },
  });
}

export async function listCrmFunnels(client, onlyActive = false) {
  await ensureDefaultCrmFunnel(client);

  return client.crmFunnel.findMany({
    where: onlyActive ? { active: true } : undefined,
    include: {
      stages: {
        where: onlyActive ? { active: true } : undefined,
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      },
    },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
  });
}

export function serializeCrmFunnel(funnel) {
  if (!funnel) return null;

  return {
    id: funnel.id,
    name: funnel.name,
    slug: funnel.slug,
    active: funnel.active,
    isDefault: funnel.isDefault,
    sortOrder: funnel.sortOrder,
    createdAt: funnel.createdAt,
    updatedAt: funnel.updatedAt,
    stages: (funnel.stages || []).map((stage) => ({
      id: stage.id,
      funnelId: stage.funnelId,
      name: stage.name,
      sortOrder: stage.sortOrder,
      active: stage.active,
      createdAt: stage.createdAt,
      updatedAt: stage.updatedAt,
    })),
  };
}

export async function resolveLeadWorkflow(client, input) {
  const status = String(input.status || "").trim();
  const funnelId = input.funnelId || null;
  const stageId = input.stageId || null;

  if (!status) {
    throw new HttpError(400, "Status do lead é obrigatório");
  }

  if (status === "Ganho" || status === "Perdido") {
    return {
      status,
      funnelId,
      stageId: null,
    };
  }

  const fallbackFunnel = funnelId
    ? await client.crmFunnel.findUnique({
        where: { id: funnelId },
        include: {
          stages: {
            where: { active: true },
            orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
          },
        },
      })
    : await ensureDefaultCrmFunnel(client);

  if (!fallbackFunnel) {
    throw new HttpError(400, "Funil do CRM não encontrado");
  }

  if (stageId) {
    const stage = await client.crmFunnelStage.findUnique({
      where: { id: stageId },
    });

    if (!stage || stage.funnelId !== fallbackFunnel.id) {
      throw new HttpError(400, "Etapa do funil não encontrada");
    }

    return {
      status: stage.name,
      funnelId: fallbackFunnel.id,
      stageId: stage.id,
    };
  }

  const matchingStage = fallbackFunnel.stages.find((item) => item.name === status);
  if (matchingStage) {
    return {
      status: matchingStage.name,
      funnelId: fallbackFunnel.id,
      stageId: matchingStage.id,
    };
  }

  throw new HttpError(400, "Etapa do funil inválida para o status informado");
}

export function buildCrmFunnelSlug(name, suffix = "") {
  const base = slugify(name) || "funil";
  return suffix ? `${base}-${suffix}` : base;
}

export function buildDefaultStagesForNewFunnel() {
  return buildDefaultStages();
}
