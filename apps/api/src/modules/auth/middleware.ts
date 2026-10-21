import type { FastifyRequest } from "fastify";

import { toPublicUser, type UserService } from "../users/index.js";
import { HttpError } from "./errors.js";
import type { JwtTokenService } from "./token.js";

export function createAuthGuard(
  tokenService: JwtTokenService,
  userService: UserService,
) {
  return async function authGuard(request: FastifyRequest): Promise<void> {
    const authorization = request.headers.authorization;
    const token = authorization?.startsWith("Bearer ")
      ? authorization.slice("Bearer ".length).trim()
      : "";

    if (!token) throw new HttpError(401, "Invalid access token");

    try {
      const userId = await tokenService.verify(token);
      const user = await userService.getById(userId);
      if (!user) throw new HttpError(401, "Invalid access token");
      if (user.status !== "ACTIVE") throw new HttpError(403, "User account is unavailable");
      request.currentUser = toPublicUser(user);
    } catch (error) {
      if (error instanceof HttpError) throw error;
      throw new HttpError(401, "Invalid access token");
    }
  };
}
