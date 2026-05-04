import { z } from "zod";

export const cuidSchema = z.string().cuid();

export const passwordSchema = z
  .string()
  .min(10, "A senha deve ter no minimo 10 caracteres")
  .regex(/[a-z]/, "A senha deve conter letra minuscula")
  .regex(/[A-Z]/, "A senha deve conter letra maiuscula")
  .regex(/\d/, "A senha deve conter numero")
  .regex(/[^\w\s]/, "A senha deve conter caractere especial");

function normalizeInstanceDomain(value) {
  const trimmed = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^@/, "")
    .replace(/\/+$/, "");

  if (!trimmed) return "";

  return trimmed.endsWith(".atenderbem.com")
    ? trimmed
    : `${trimmed}.atenderbem.com`;
}

export const instanceDomainSchema = z
  .string()
  .trim()
  .min(1)
  .transform(normalizeInstanceDomain)
  .refine((value) => value.length <= 120, {
    message: "A instancia deve ter no maximo 120 caracteres",
  })
  .refine(
    (value) => /^(?!-)[a-z0-9-]+(?<!-)\.atenderbem\.com$/i.test(value),
    "A instancia deve estar no formato nome.atenderbem.com",
  );

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});
