import type { FastifyInstance } from "fastify";

import { adminTelegramIds, env } from "../../config/env.js";
import { JwtTokenService } from "../auth/token.js";
import { PrismaUserRepository, UserService } from "../users/index.js";
import { PrismaOrderRepository } from "./repository.js";
import { registerOrderRoutes } from "./route.js";
import { OrderService } from "./service.js";

export interface OrderModuleDependencies {
  orderService?: OrderService;
  userService?: UserService;
  tokenService?: JwtTokenService;
  adminUserService?: UserService;
  adminTokenService?: JwtTokenService;
  adminTelegramIds?: ReadonlySet<string>;
}

export function registerOrderModule(
  app: FastifyInstance,
  dependencies: OrderModuleDependencies = {},
): void {
  const service =
    dependencies.orderService ?? new OrderService(new PrismaOrderRepository());
  const userService =
    dependencies.userService ?? new UserService(new PrismaUserRepository());
  const tokenService =
    dependencies.tokenService ?? new JwtTokenService(env.JWT_SECRET);
  const adminUserService = dependencies.adminUserService ?? userService;
  const adminTokenService = dependencies.adminTokenService ?? tokenService;
  registerOrderRoutes(
    app,
    service,
    tokenService,
    userService,
    adminTokenService,
    adminUserService,
    dependencies.adminTelegramIds ?? adminTelegramIds,
  );
}

export { PrismaOrderRepository, type OrderRepository } from "./repository.js";
export { OrderService } from "./service.js";
