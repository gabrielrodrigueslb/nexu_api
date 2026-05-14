function onlyDigits(value) {
  return String(value || '').replace(/\D/g, '');
}

export function normalizeCnpjDigits(value) {
  return onlyDigits(value).slice(0, 14);
}

export function formatCnpjDigits(value) {
  const digits = normalizeCnpjDigits(value);
  if (digits.length !== 14) return digits;

  return `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5, 8)}/${digits.slice(8, 12)}-${digits.slice(12)}`;
}

export function isValidCnpj(value) {
  const cnpj = normalizeCnpjDigits(value);

  if (cnpj.length !== 14) return false;
  if (/^(\d)\1{13}$/.test(cnpj)) return false;

  const calculateDigit = (base, factor) => {
    let total = 0;
    let currentFactor = factor;

    for (const digit of base) {
      total += Number(digit) * currentFactor;
      currentFactor -= 1;
      if (currentFactor < 2) currentFactor = 9;
    }

    const remainder = total % 11;
    return remainder < 2 ? 0 : 11 - remainder;
  };

  const firstDigit = calculateDigit(cnpj.slice(0, 12), 5);
  const secondDigit = calculateDigit(cnpj.slice(0, 12) + firstDigit, 6);

  return cnpj === `${cnpj.slice(0, 12)}${firstDigit}${secondDigit}`;
}

export async function fetchPublicCnpjRecord(value) {
  const cnpj = normalizeCnpjDigits(value);

  if (!isValidCnpj(cnpj)) {
    return {
      status: 'invalid',
      companyName: null,
      legalName: null,
      normalizedCnpj: cnpj,
    };
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 6000);

  try {
    const response = await fetch(`https://minhareceita.org/${cnpj}`, {
      method: 'GET',
      headers: {
        accept: 'application/json',
      },
      signal: controller.signal,
    });

    if (response.status === 400) {
      return {
        status: 'invalid',
        companyName: null,
        legalName: null,
        normalizedCnpj: cnpj,
      };
    }

    if (response.status === 404) {
      return {
        status: 'not_found',
        companyName: null,
        legalName: null,
        normalizedCnpj: cnpj,
      };
    }

    if (!response.ok) {
      return {
        status: 'unavailable',
        companyName: null,
        legalName: null,
        normalizedCnpj: cnpj,
      };
    }

    const payload = await response.json();

    return {
      status: 'found',
      companyName: payload?.nome_fantasia || payload?.razao_social || null,
      legalName: payload?.razao_social || null,
      normalizedCnpj: cnpj,
    };
  } catch {
    return {
      status: 'unavailable',
      companyName: null,
      legalName: null,
      normalizedCnpj: cnpj,
    };
  } finally {
    clearTimeout(timeoutId);
  }
}
