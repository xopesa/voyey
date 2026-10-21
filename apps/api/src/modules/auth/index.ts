import type { FastifyInstance } from "fastify";

import { env } from "../../config/env.js";
import { PrismaUserRepository, UserService } from "../users/index.js";
import { registerAuthRoutes } from "./route.js";
import { AuthService } from "./service.js";
import { TelegramInitDataVerifier } from "./telegram/verifier.js";
import { JwtTokenService } from "./token.js";

export interface AuthModuleDependencies {
  authService?: AuthService;
  userService?: UserService;
  tokenService?: JwtTokenService;
}

export function registerAuthModule(
  app: FastifyInstance,
  dependencies: AuthModuleDependencies = {},
): void {
  const userService =
    dependencies.userService ?? new UserService(new PrismaUserRepository());
  const tokenService =
    dependencies.tokenService ?? new JwtTokenService(env.JWT_SECRET);
  const authService =
    dependencies.authService ??
    new AuthService(
      userService,
      new TelegramInitDataVerifier(
        env.TELEGRAM_BOT_TOKEN,
        env.TELEGRAM_INIT_DATA_TTL_SECONDS,
      ),
      tokenService,
    );

  registerAuthRoutes(app, authService, tokenService, userService);
}
