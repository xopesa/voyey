import type { FastifyInstance } from "fastify";

import { adminTelegramIds, env } from "../../config/env.js";
import { JwtTokenService } from "../auth/token.js";
import { PrivateImageStorageService } from "../media/index.js";
import { createPrivateStorage } from "../media/providers.js";
import { PrismaUserRepository, UserService } from "../users/index.js";
import {
  createNotificationService,
  type NotificationService,
} from "../notifications/index.js";
import { PrismaPaymentRepository } from "./repository.js";
import { registerPaymentRoutes } from "./route.js";
import { PaymentService } from "./service.js";

export interface PaymentModuleDependencies {
  paymentService?: PaymentService;
  userService?: UserService;
  tokenService?: JwtTokenService;
  adminUserService?: UserService;
  adminTokenService?: JwtTokenService;
  adminTelegramIds?: ReadonlySet<string>;
  notificationService?: NotificationService;
}

export function registerPaymentModule(
  app: FastifyInstance,
  dependencies: PaymentModuleDependencies = {},
): void {
  const privateProvider = createPrivateStorage();
  const storage = new PrivateImageStorageService(
    privateProvider,
    env.MAX_PAYMENT_PROOF_UPLOAD_SIZE,
  );
  const service =
    dependencies.paymentService ??
    new PaymentService(
      new PrismaPaymentRepository(),
      storage,
      {
        cardNumber: env.MANUAL_PAYMENT_CARD_NUMBER,
        cardHolder: env.MANUAL_PAYMENT_CARD_HOLDER,
        instructionsRu: env.MANUAL_PAYMENT_INSTRUCTIONS_RU,
        instructionsUz: env.MANUAL_PAYMENT_INSTRUCTIONS_UZ,
        maxProofUploadSize: env.MAX_PAYMENT_PROOF_UPLOAD_SIZE,
      },
      dependencies.notificationService ?? createNotificationService(),
    );
  const userService =
    dependencies.userService ?? new UserService(new PrismaUserRepository());
  const tokenService =
    dependencies.tokenService ?? new JwtTokenService(env.JWT_SECRET);
  const adminUserService = dependencies.adminUserService ?? userService;
  const adminTokenService = dependencies.adminTokenService ?? tokenService;
  registerPaymentRoutes(
    app,
    service,
    tokenService,
    userService,
    adminTokenService,
    adminUserService,
    dependencies.adminTelegramIds ?? adminTelegramIds,
    env.MAX_PAYMENT_PROOF_UPLOAD_SIZE,
  );
}

export {
  PrismaPaymentRepository,
  type PaymentRepository,
} from "./repository.js";
export { PaymentService } from "./service.js";
