export function buildLeadCode(leadId) {
  const normalized = String(leadId || "")
    .replace(/[^a-zA-Z0-9]/g, "")
    .toUpperCase();

  if (!normalized) {
    return null;
  }

  const tail = normalized.slice(-6).padStart(6, "0");
  const prefix = normalized.slice(0, 3).padEnd(3, "X");

  return `CRM-${tail}-${prefix}`;
}
