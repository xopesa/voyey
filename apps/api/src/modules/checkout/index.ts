import type { FastifyInstance } from "fastify";

import { env } from "../../config/env.js";
import { JwtTokenService } from "../auth/token.js";
import { PrismaOrderRepository } from "../orders/repository.js";
import {
  createNotificationService,
  type NotificationService,
} from "../notifications/index.js";
import { PrismaUserRepository, UserService } from "../users/index.js";
import { registerCheckoutRoutes } from "./route.js";
import { CheckoutService } from "./service.js";

export interface CheckoutModuleDependencies {
  checkoutService?: CheckoutService;
  userService?: UserService;
  tokenService?: JwtTokenService;
  notificationService?: NotificationService;
}

export function registerCheckoutModule(
  app: FastifyInstance,
  dependencies: CheckoutModuleDependencies = {},
): void {
  const service =
    dependencies.checkoutService ??
    new CheckoutService(
      new PrismaOrderRepository(),
      undefined,
      dependencies.notificationService ?? createNotificationService(),
    );
  const userService =
    dependencies.userService ?? new UserService(new PrismaUserRepository());
  const tokenService =
    dependencies.tokenService ?? new JwtTokenService(env.JWT_SECRET);
  registerCheckoutRoutes(app, service, tokenService, userService);
}

export { CheckoutService } from "./service.js";
