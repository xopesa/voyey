import type { FastifyInstance, FastifyRequest } from "fastify";

import { HttpError } from "../auth/errors.js";
import { createAuthGuard } from "../auth/middleware.js";
import type { JwtTokenService } from "../auth/token.js";
import type { UserService } from "../users/index.js";

export function createAdminGuard(
  tokenService: JwtTokenService,
  userService: UserService,
  adminTelegramIds: ReadonlySet<string>,
) {
  const authGuard = createAuthGuard(tokenService, userService);

  return async function adminGuard(request: FastifyRequest): Promise<void> {
    if (!request.headers.authorization && request.server.webAdminSessions) {
      await request.server.webAdminSessions.authorize(request);
      return;
    }
    await authGuard(request);
    const telegramId = request.currentUser?.telegramId;
    if (!telegramId || !adminTelegramIds.has(telegramId)) {
      throw new HttpError(403, "Admin access required");
    }
  };
}

export function registerAdminProtection(
  app: FastifyInstance,
  guard: (request: FastifyRequest) => Promise<void>,
): void {
  app.addHook("preParsing", async (request, _reply, payload) => {
    const path = request.url.split("?")[0] ?? "";
    if (
      (path === "/admin" || path.startsWith("/admin/")) &&
      ![
        "/admin/auth/login",
        "/admin/auth/session",
        "/admin/auth/logout",
      ].includes(path)
    )
      await guard(request);
    return payload;
  });
}
