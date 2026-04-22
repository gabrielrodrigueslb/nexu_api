import { normalizeRole } from "../lib/access-control.js";
import { prisma } from "../lib/prisma.js";
import { HttpError } from "../lib/http-error.js";
import { verifyAccessToken } from "../lib/tokens.js";
import { serializeUser } from "../lib/serializers.js";

export async function authenticate(request, _response, next) {
  try {
    const authorization = request.headers.authorization;

    if (!authorization?.startsWith("Bearer ")) {
      throw new HttpError(401, "Token Bearer ausente ou inválido");
    }

    const token = authorization.slice("Bearer ".length).trim();
    const payload = await verifyAccessToken(token);

    const user = await prisma.user.findUnique({
      where: { id: payload.sub },
    });

    if (!user || !user.isActive) {
      throw new HttpError(401, "Usuário inválido ou desativado");
    }

    if (Number(payload.sessionVersion) !== user.sessionVersion) {
      throw new HttpError(401, "Sessão inválida");
    }

    request.auth = {
      userId: user.id,
      role: normalizeRole(user.role),
      user: serializeUser(user),
    };

    next();
  } catch (error) {
    next(error.status ? error : new HttpError(401, "Não autorizado"));
  }
}
