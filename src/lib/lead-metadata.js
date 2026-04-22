const LEAD_METADATA_PREFIX = "__NEXU_LEAD_META__:";

function normalizeString(value) {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function normalizeNumber(value) {
  if (value === null || value === undefined || value === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function normalizeInteger(value) {
  const parsed = normalizeNumber(value);
  return parsed === undefined ? undefined : Math.max(0, Math.trunc(parsed));
}

export function parseLeadMetadata(notes) {
  if (!notes) {
    return {};
  }

  if (!notes.startsWith(LEAD_METADATA_PREFIX)) {
    return {
      observations: notes,
    };
  }

  try {
    return JSON.parse(notes.slice(LEAD_METADATA_PREFIX.length));
  } catch {
    return {
      observations: notes,
    };
  }
}

export function buildLeadMetadataNotes(input = {}) {
  const payload = {
    observations: normalizeString(input.observations),
    installment: normalizeString(input.installment),
    consultant: normalizeString(input.consultant),
    validUntil: normalizeString(input.validUntil),
    agents: normalizeInteger(input.agents),
    supervisors: normalizeInteger(input.supervisors),
    admins: normalizeInteger(input.admins),
    representativeId: normalizeString(input.representativeId),
    representativeCommission: normalizeNumber(input.representativeCommission),
    passThroughAmount: normalizeNumber(input.passThroughAmount),
    lossReason: normalizeString(input.lossReason),
  };

  const compactPayload = Object.fromEntries(
    Object.entries(payload).filter(([, value]) => value !== undefined),
  );

  if (!Object.keys(compactPayload).length) {
    return null;
  }

  return `${LEAD_METADATA_PREFIX}${JSON.stringify(compactPayload)}`;
}
