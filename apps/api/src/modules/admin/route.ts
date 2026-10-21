import type { FastifyInstance } from "fastify";

import type { JwtTokenService } from "../auth/token.js";
import type { UserService } from "../users/index.js";
import { createAdminGuard } from "./authorization.js";

export function registerAdminRoutes(
  app: FastifyInstance,
  tokenService: JwtTokenService,
  userService: UserService,
  adminTelegramIds: ReadonlySet<string>,
): void {
  app.get(
    "/admin/health",
    { preHandler: createAdminGuard(tokenService, userService, adminTelegramIds) },
    async (request) => ({ status: "ok", admin: request.currentUser }),
  );
}
