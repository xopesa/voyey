import type { FastifyInstance } from "fastify";

import { PrismaCatalogRepository } from "./repository.js";
import { registerCatalogRoutes } from "./route.js";
import { CatalogService } from "./service.js";

export interface CatalogModuleDependencies {
  catalogService?: CatalogService;
}

export function registerCatalogModule(
  app: FastifyInstance,
  dependencies: CatalogModuleDependencies = {},
): void {
  const service =
    dependencies.catalogService ??
    new CatalogService(new PrismaCatalogRepository());
  registerCatalogRoutes(app, service);
}

export {
  PrismaCatalogRepository,
  type CatalogRepository,
} from "./repository.js";
export { CatalogService } from "./service.js";
export type {
  CatalogCategoryRecord,
  CatalogProductListQuery,
  CatalogProductListResult,
  CatalogProductRecord,
  ProductDto,
} from "./types.js";
