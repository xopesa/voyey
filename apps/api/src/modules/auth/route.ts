import type { FastifyInstance } from "fastify";
import { z } from "zod";

import type { UserService } from "../users/index.js";
import {
  AccountUnavailableError,
  HttpError,
  InvalidTelegramAuthError,
} from "./errors.js";
import { createAuthGuard } from "./middleware.js";
import type { AuthService } from "./service.js";
import type { JwtTokenService } from "./token.js";
import { toPublicUser } from "../users/types.js";

const telegramAuthBodySchema = z.object({
  initData: z.string().trim().min(1).max(10_000),
});

export function registerAuthRoutes(
  app: FastifyInstance,
  authService: AuthService,
  tokenService: JwtTokenService,
  userService: UserService,
): void {
  if (!app.hasRequestDecorator("currentUser")) {
    app.decorateRequest("currentUser", null);
  }

  app.post("/auth/telegram", async (request) => {
    const parsedBody = telegramAuthBodySchema.safeParse(request.body);
    if (!parsedBody.success) throw new HttpError(400, "Invalid request body");

    try {
      return await authService.authenticateTelegram(parsedBody.data.initData);
    } catch (error) {
      if (error instanceof InvalidTelegramAuthError) {
        throw new HttpError(401, "Invalid or expired Telegram authentication");
      }
      if (error instanceof AccountUnavailableError) {
        throw new HttpError(403, error.message);
      }
      throw error;
    }
  });

  app.get(
    "/me",
    { preHandler: createAuthGuard(tokenService, userService) },
    async (request) => ({ user: request.currentUser }),
  );

  app.patch(
    "/me/preferences",
    { preHandler: createAuthGuard(tokenService, userService) },
    async (request) => {
      const body = z
        .object({ locale: z.enum(["uz", "ru"]) })
        .strict()
        .safeParse(request.body);
      if (!body.success) throw new HttpError(400, "Invalid preferences");
      const user = await userService.setPreferredLocale(
        request.currentUser!.id,
        body.data.locale,
      );
      return { user: toPublicUser(user) };
    },
  );
}
