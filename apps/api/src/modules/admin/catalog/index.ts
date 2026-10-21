import type { FastifyInstance } from "fastify";

import { adminTelegramIds, env } from "../../../config/env.js";
import { JwtTokenService } from "../../auth/token.js";
import { ImageStorageService } from "../../media/index.js";
import { createPublicStorage } from "../../media/providers.js";
import { LocalStorageProvider } from "../../media/local-storage.js";
import { R2PublicStorageProvider } from "../../media/r2-storage.js";
import {
  registerLocalMediaRoute,
  registerPublicMediaRoute,
} from "../../media/static-route.js";
import { PrismaUserRepository, UserService } from "../../users/index.js";
import { PrismaAdminCatalogRepository } from "./repository.js";
import { registerAdminCatalogRoutes } from "./route.js";
import { AdminCatalogService } from "./service.js";

export interface AdminCatalogModuleDependencies {
  adminCatalogService?: AdminCatalogService;
  adminCatalogImageStorage?: ImageStorageService;
  adminUserService?: UserService;
  adminTokenService?: JwtTokenService;
  adminTelegramIds?: ReadonlySet<string>;
}

export function registerAdminCatalogModule(
  app: FastifyInstance,
  dependencies: AdminCatalogModuleDependencies = {},
): void {
  const provider = createPublicStorage();
  const imageStorage =
    dependencies.adminCatalogImageStorage ??
    new ImageStorageService(provider, env.MAX_IMAGE_UPLOAD_SIZE);
  const service =
    dependencies.adminCatalogService ??
    new AdminCatalogService(new PrismaAdminCatalogRepository(), imageStorage);
  const userService =
    dependencies.adminUserService ??
    new UserService(new PrismaUserRepository());
  const tokenService =
    dependencies.adminTokenService ?? new JwtTokenService(env.JWT_SECRET);
  registerAdminCatalogRoutes(
    app,
    service,
    tokenService,
    userService,
    dependencies.adminTelegramIds ?? adminTelegramIds,
    env.MAX_IMAGE_UPLOAD_SIZE,
  );
  if (provider instanceof R2PublicStorageProvider)
    registerPublicMediaRoute(app, provider, env.STORAGE_PUBLIC_BASE_URL);
  if (provider instanceof LocalStorageProvider)
    registerLocalMediaRoute(
      app,
      provider.rootPath,
      env.STORAGE_PUBLIC_BASE_URL,
    );
}

export {
  PrismaAdminCatalogRepository,
  type AdminCatalogRepository,
} from "./repository.js";
export { AdminCatalogService } from "./service.js";
