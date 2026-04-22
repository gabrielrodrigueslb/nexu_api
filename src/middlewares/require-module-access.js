import { HttpError } from "../lib/http-error.js";
import { compareAccessLevel, resolveUserAccess } from "../lib/access-control.js";

export function requireModuleAccess(moduleKey, requiredAccessLevel = "view") {
  return async (request, _response, next) => {
    try {
      if (!request.auth?.userId) {
        throw new HttpError(401, "Não autenticado");
      }

      if (request.auth.role === "admin") {
        return next();
      }

      if (!request.auth.access) {
        request.auth.access = await resolveUserAccess(request.auth.userId);
      }

      const currentAccessLevel =
        request.auth.access?.permissionMap?.[moduleKey] || "none";

      if (!compareAccessLevel(currentAccessLevel, requiredAccessLevel)) {
        throw new HttpError(403, "Sem permissão para acessar este módulo");
      }

      next();
    } catch (error) {
      next(error);
    }
  };
}
