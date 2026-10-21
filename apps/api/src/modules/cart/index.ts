import type { FastifyInstance } from "fastify";

import { env } from "../../config/env.js";
import { JwtTokenService } from "../auth/token.js";
import { PrismaUserRepository, UserService } from "../users/index.js";
import { PrismaCartRepository } from "./repository.js";
import { registerCartRoutes } from "./route.js";
import { CartService } from "./service.js";

export interface CartModuleDependencies {
  cartService?: CartService;
  userService?: UserService;
  tokenService?: JwtTokenService;
}

export function registerCartModule(
  app: FastifyInstance,
  dependencies: CartModuleDependencies = {},
): void {
  const service =
    dependencies.cartService ?? new CartService(new PrismaCartRepository());
  const userService =
    dependencies.userService ?? new UserService(new PrismaUserRepository());
  const tokenService =
    dependencies.tokenService ?? new JwtTokenService(env.JWT_SECRET);
  registerCartRoutes(app, service, tokenService, userService);
}

export { PrismaCartRepository, type CartRepository } from "./repository.js";
export { CartService } from "./service.js";
