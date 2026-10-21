import type { FastifyInstance } from "fastify";

import { adminTelegramIds, env } from "../../config/env.js";
import { JwtTokenService } from "../auth/token.js";
import { PrismaUserRepository, UserService } from "../users/index.js";
import { registerAdminRoutes } from "./route.js";
import { createAdminGuard, registerAdminProtection } from "./authorization.js";
import { registerWebAdminAuth } from "./web-auth.js";
import { WebAdminSessions } from "./web-session.js";
import { PrismaAdminSessionStore } from "./prisma-session-store.js";
import {
  registerDashboardRoutes,
  type AdminDashboardService,
} from "./dashboard.js";
import {
  registerTelegramAdminRoutes,
  type TelegramAdminStore,
} from "./telegram.js";

export interface AdminModuleDependencies {
  adminDashboardService?: AdminDashboardService;
  telegramAdminStore?: TelegramAdminStore;
  adminUserService?: UserService;
  adminTokenService?: JwtTokenService;
  adminTelegramIds?: ReadonlySet<string>;
  webAdminSessions?: WebAdminSessions;
}

export function registerAdminModule(
  app: FastifyInstance,
  dependencies: AdminModuleDependencies = {},
): void {
  const userService =
    dependencies.adminUserService ??
    new UserService(new PrismaUserRepository());
  const tokenService =
    dependencies.adminTokenService ?? new JwtTokenService(env.JWT_SECRET);

  if (
    env.ADMIN_PASSWORD_HASH &&
    env.NODE_ENV === "production" &&
    !env.ADMIN_ORIGIN.startsWith("https://")
  ) {
    throw new Error("ADMIN_ORIGIN must use HTTPS in production");
  }
  registerWebAdminAuth(
    app,
    dependencies.webAdminSessions ??
      new WebAdminSessions(
        env.ADMIN_PASSWORD_HASH,
        env.ADMIN_ORIGIN,
        env.NODE_ENV === "production",
        Date.now,
        env.ADMIN_SESSION_DRIVER === "postgres"
          ? new PrismaAdminSessionStore()
          : undefined,
      ),
  );
  const guard = createAdminGuard(
    tokenService,
    userService,
    dependencies.adminTelegramIds ?? adminTelegramIds,
  );
  // Deny by default, including future admin routes. Only the three auth endpoints are public to this hook.
  registerAdminProtection(app, guard);
  registerDashboardRoutes(app, guard, dependencies.adminDashboardService);
  if (dependencies.telegramAdminStore)
    registerTelegramAdminRoutes(app, dependencies.telegramAdminStore);

  registerAdminRoutes(
    app,
    tokenService,
    userService,
    dependencies.adminTelegramIds ?? adminTelegramIds,
  );
}
