import type { FastifyInstance } from "fastify";

import { HttpError } from "../auth/errors.js";
import {
  CatalogInvalidCursorError,
  CatalogProductNotFoundError,
} from "./errors.js";
import {
  productSlugParamsSchema,
  publicCatalogQuerySchema,
} from "./schemas.js";
import type { CatalogService } from "./service.js";

export function registerCatalogRoutes(
  app: FastifyInstance,
  service: CatalogService,
): void {
  app.get("/catalog/categories", async () => ({
    categories: await service.listCategories(),
  }));

  app.get("/catalog/products", async (request) => {
    const query = publicCatalogQuerySchema.safeParse(request.query);
    if (!query.success) throw new HttpError(400, "Invalid catalog query");
    try {
      return await service.listProducts(query.data);
    } catch (error) {
      if (error instanceof CatalogInvalidCursorError) {
        throw new HttpError(400, error.message);
      }
      throw error;
    }
  });

  app.get("/catalog/products/:slug", async (request) => {
    const params = productSlugParamsSchema.safeParse(request.params);
    if (!params.success) throw new HttpError(400, "Invalid product slug");
    try {
      return { product: await service.getProductBySlug(params.data.slug) };
    } catch (error) {
      if (error instanceof CatalogProductNotFoundError) {
        throw new HttpError(404, error.message);
      }
      throw error;
    }
  });
}
