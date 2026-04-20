export function toCents(value) {
  if (value === undefined || value === null) {
    return 0;
  }

  return Math.round(Number(value) * 100);
}

export function fromCents(valueInCents) {
  return Number(valueInCents || 0) / 100;
}
