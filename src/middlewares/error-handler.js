export function errorHandler(error, _request, response, _next) {
  const status = error.status || 500;
  const message = status >= 500 ? "Erro interno do servidor" : error.message;

  if (status >= 500) {
    console.error(error);
  }

  response.status(status).json({
    error: {
      message,
      details: error.details || undefined,
    },
  });
}
