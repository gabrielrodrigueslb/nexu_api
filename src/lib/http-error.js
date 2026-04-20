export class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.details = details;
  }
}

export function assertFound(record, message = "Registro nao encontrado") {
  if (!record) {
    throw new HttpError(404, message);
  }

  return record;
}
