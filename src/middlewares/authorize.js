import { HttpError } from "../lib/http-error.js";

export function authorize(roles) {
  return (request, _response, next) => {
    if (!request.auth) {
      return next(new HttpError(401, "Nao autenticado"));
    }

    if (!roles.includes(request.auth.role)) {
      return next(new HttpError(403, "Sem permissao para esta acao"));
    }

    next();
  };
}
