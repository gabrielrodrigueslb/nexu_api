import { HttpError } from "../lib/http-error.js";

function assignValidatedValue(request, key, value) {
  Object.defineProperty(request, key, {
    value,
    configurable: true,
    enumerable: true,
    writable: true,
  });
}

export function validate({ body, query, params }) {
  return (request, _response, next) => {
    try {
      if (body) {
        assignValidatedValue(request, "body", body.parse(request.body));
      }

      if (query) {
        assignValidatedValue(request, "query", query.parse(request.query));
      }

      if (params) {
        assignValidatedValue(request, "params", params.parse(request.params));
      }

      next();
    } catch (error) {
      next(new HttpError(422, "Falha de validacao", error.flatten?.() || undefined));
    }
  };
}
