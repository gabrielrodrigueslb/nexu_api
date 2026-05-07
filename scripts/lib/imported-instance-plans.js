import { slugify } from "../../src/lib/text.js";

export function extractCount(pattern, value) {
  const match = String(value || "").match(pattern);
  if (!match) return 0;
  return Number.parseInt(match[1], 10) || 0;
}

export function detectPlanFamily(name) {
  const normalized = String(name || "").trim().toLowerCase();

  if (!normalized) return "Plano";
  if (normalized.startsWith("fidelidade")) return "Fidelidade anual";
  if (normalized.startsWith("padr")) return "Padrão";
  if (normalized.startsWith("lite")) return "Lite";
  if (normalized.includes("parceiro")) return "Parceiro";
  if (normalized.includes("gateway")) return "Gateway";
  if (normalized.includes("solid")) return "Solidário";

  return "Plano";
}

export function buildDescription(name, profile) {
  const family = detectPlanFamily(name);
  const allocations = [
    profile.includedAgents ? `${profile.includedAgents} agentes` : null,
    profile.includedSupervisors ? `${profile.includedSupervisors} supervisores` : null,
    profile.includedAdmins ? `${profile.includedAdmins} administradores` : null,
  ].filter(Boolean);

  if (!allocations.length) {
    return `${family} criado automaticamente a partir da planilha de instâncias.`;
  }

  return `${family} criado automaticamente a partir da planilha de instâncias, com ${allocations.join(", ")}.`;
}

export function buildRestrictions(name) {
  const normalized = String(name || "").trim();
  const labels = [];

  if (/\[2025\]/i.test(normalized)) labels.push("Tabela 2025");
  if (/fidelidade/i.test(normalized)) labels.push("Fidelidade anual");
  if (/\bwa\b/i.test(normalized)) labels.push("WhatsApp");
  if (/\bfb\b/i.test(normalized)) labels.push("Facebook");
  if (/\big\b/i.test(normalized)) labels.push("Instagram");

  return labels.length ? labels.join(" | ") : null;
}

export function inferPlanDraft(name, monthlyCost = 0) {
  const normalizedName = String(name || "").trim();

  return {
    name: normalizedName,
    slug: slugify(`plan-${normalizedName}`) || `plan-importado-${Date.now()}`,
    description: buildDescription(normalizedName, {
      includedAgents: extractCount(/(\d+)\s*agentes?/i, normalizedName),
      includedSupervisors: extractCount(/(\d+)\s*sup/i, normalizedName),
      includedAdmins: extractCount(/(\d+)\s*adm/i, normalizedName),
    }),
    features: null,
    restrictions: buildRestrictions(normalizedName),
    setupFeeInCents: 0,
    monthlyFeeInCents: Math.round(Number(monthlyCost || 0) * 100),
    includedAgents: extractCount(/(\d+)\s*agentes?/i, normalizedName),
    includedSupervisors: extractCount(/(\d+)\s*sup/i, normalizedName),
    includedAdmins: extractCount(/(\d+)\s*adm/i, normalizedName),
    active: true,
  };
}

export function buildUniqueImportedPlans(importedRecords) {
  const uniquePlans = new Map();

  for (const record of importedRecords) {
    const planName = String(record.plan || "").trim();
    if (!planName) continue;

    const key = planName.toLowerCase();
    const current = uniquePlans.get(key);
    if (!current || Number(record.monthlyCost || 0) > Number(current.monthlyCost || 0)) {
      uniquePlans.set(key, {
        name: planName,
        monthlyCost: Number(record.monthlyCost || 0),
      });
    }
  }

  return uniquePlans;
}

export function buildPlanDraftsToCreate(uniquePlans, existingPlans) {
  const plansByLowerName = new Map(existingPlans.map((plan) => [plan.name.toLowerCase(), plan]));
  const usedSlugs = new Set(existingPlans.map((plan) => plan.slug).filter(Boolean));
  const draftsToCreate = [];

  for (const { name, monthlyCost } of uniquePlans.values()) {
    if (plansByLowerName.has(name.toLowerCase())) {
      continue;
    }

    const draft = inferPlanDraft(name, monthlyCost);
    let slug = draft.slug;
    let suffix = 2;

    while (usedSlugs.has(slug)) {
      slug = `${draft.slug}-${suffix}`;
      suffix += 1;
    }

    usedSlugs.add(slug);
    draftsToCreate.push({
      ...draft,
      slug,
    });
  }

  return draftsToCreate;
}
