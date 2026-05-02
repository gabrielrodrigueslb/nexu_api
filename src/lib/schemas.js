import { z } from "zod";

export const cuidSchema = z.string().cuid();

export const passwordSchema = z
  .string()
  .min(10, "A senha deve ter no minimo 10 caracteres")
  .regex(/[a-z]/, "A senha deve conter letra minuscula")
  .regex(/[A-Z]/, "A senha deve conter letra maiuscula")
  .regex(/\d/, "A senha deve conter numero")
  .regex(/[^\w\s]/, "A senha deve conter caractere especial");

export const instanceDomainSchema = z
  .string()
  .trim()
  .min(3)
  .max(120)
  .regex(
    /^(?!-)[a-z0-9-]+(?<!-)\.atenderbem\.com$/i,
    "A instancia deve estar no formato nome.atenderbem.com",
  );

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});
