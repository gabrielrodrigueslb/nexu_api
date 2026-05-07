const PRODUCT_HEADER = "Produtos incluidos:";
const INTEGRATION_HEADER = "Integracoes incluidas:";

function normalizeFeatureLine(line) {
  return String(line || "")
    .replace(/^[-*•]\s*/, "")
    .trim();
}

export function parsePlanFeatureSelections(features) {
  const products = [];
  const integrations = [];
  let currentSection = null;

  for (const rawLine of String(features || "").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;

    if (line === PRODUCT_HEADER) {
      currentSection = "PRODUCT";
      continue;
    }

    if (line === INTEGRATION_HEADER) {
      currentSection = "INTEGRATION";
      continue;
    }

    if (!currentSection) continue;

    const normalized = normalizeFeatureLine(line);
    if (!normalized) continue;

    if (currentSection === "PRODUCT") {
      products.push(normalized);
      continue;
    }

    integrations.push(normalized);
  }

  return { products, integrations };
}

export function buildVirtualCatalogItemsFromPlan(plan) {
  if (!plan?.id) return [];

  const selections = parsePlanFeatureSelections(plan.features);
  const rows = [];

  for (const [index, name] of selections.products.entries()) {
    rows.push({
      id: `plan-${plan.id}-product-${index + 1}`,
      enabled: true,
      setupInCents: 0,
      recurringInCents: 0,
      catalogItem: {
        id: `plan-${plan.id}-product-${index + 1}`,
        name,
        type: "PRODUCT",
      },
    });
  }

  for (const [index, name] of selections.integrations.entries()) {
    rows.push({
      id: `plan-${plan.id}-integration-${index + 1}`,
      enabled: true,
      setupInCents: 0,
      recurringInCents: 0,
      catalogItem: {
        id: `plan-${plan.id}-integration-${index + 1}`,
        name,
        type: "INTEGRATION",
      },
    });
  }

  return rows;
}

export function hasEnabledCatalogItems(items = []) {
  return items.some((item) => item?.enabled !== false);
}

export function hasPricedEnabledCatalogItems(items = []) {
  return items.some(
    (item) =>
      item?.enabled !== false &&
      (Number(item.setupAmount || item.setupInCents || 0) > 0 ||
        Number(item.recurringAmount || item.recurringInCents || 0) > 0),
  );
}

export function resolveLeadCatalogItems(lead) {
  const explicitItems = lead?.catalogItems || [];

  if (hasEnabledCatalogItems(explicitItems)) {
    return explicitItems;
  }

  return buildVirtualCatalogItemsFromPlan(lead?.plan);
}
