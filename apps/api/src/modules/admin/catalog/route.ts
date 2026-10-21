import multipart from "@fastify/multipart";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { z } from "zod";
import { VariantGeneratorValidationError } from "@stenzo/shared";

import { HttpError } from "../../auth/errors.js";
import type { JwtTokenService } from "../../auth/token.js";
import type { UserService } from "../../users/index.js";
import {
  ImageTooLargeError,
  ImageTypeMismatchError,
  InvalidStorageKeyError,
  MediaStorageError,
  MediaStorageUnavailableError,
  UnsupportedImageTypeError,
} from "../../media/index.js";
import { createAdminGuard } from "../authorization.js";
import {
  AdminCatalogCategoryNotFoundError,
  AdminCatalogDuplicateSkuError,
  AdminCatalogDuplicateSlugError,
  AdminCatalogImageNotFoundError,
  AdminCatalogInvalidCursorError,
  AdminCatalogManagedImageUrlError,
  AdminCatalogPrimaryImageConflictError,
  AdminCatalogProductNotFoundError,
  AdminCatalogVariantNotFoundError,
} from "./errors.js";
import {
  adminProductListQuerySchema,
  categoryCreateSchema,
  categoryPatchSchema,
  idParamsSchema,
  imageCreateSchema,
  imagePatchSchema,
  imageUploadQuerySchema,
  productCreateSchema,
  productActivationSchema,
  productIdParamsSchema,
  productPatchSchema,
  variantCreateSchema,
  variantPatchSchema,
  variantGeneratorSchema,
} from "./schemas.js";
import type { AdminCatalogService } from "./service.js";
import { CatalogArchiveService } from "./archive.js";

function parse<T extends z.ZodType>(
  schema: T,
  value: unknown,
  message: string,
): z.output<T> {
  const result = schema.safeParse(value);
  if (!result.success) throw new HttpError(400, message);
  return result.data;
}

function actorId(request: FastifyRequest): string {
  const id = request.webAdminActor ?? request.currentUser?.id;
  if (!id) throw new HttpError(401, "Invalid access token");
  return id;
}

async function mapCatalogError<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof VariantGeneratorValidationError)
      throw new HttpError(400, error.code);
    if (
      error instanceof AdminCatalogDuplicateSlugError ||
      error instanceof AdminCatalogDuplicateSkuError ||
      error instanceof AdminCatalogPrimaryImageConflictError ||
      error instanceof AdminCatalogManagedImageUrlError
    ) {
      throw new HttpError(409, error.message);
    }
    if (
      error instanceof AdminCatalogCategoryNotFoundError ||
      error instanceof AdminCatalogProductNotFoundError ||
      error instanceof AdminCatalogImageNotFoundError ||
      error instanceof AdminCatalogVariantNotFoundError
    ) {
      throw new HttpError(404, error.message);
    }
    if (error instanceof AdminCatalogInvalidCursorError) {
      throw new HttpError(400, error.message);
    }
    if (error instanceof ImageTooLargeError) {
      throw new HttpError(413, error.message);
    }
    if (
      error instanceof UnsupportedImageTypeError ||
      error instanceof ImageTypeMismatchError
    ) {
      throw new HttpError(415, error.message);
    }
    if (error instanceof InvalidStorageKeyError) {
      throw new HttpError(400, error.message);
    }
    if (
      error instanceof MediaStorageError ||
      error instanceof MediaStorageUnavailableError
    ) {
      throw new HttpError(502, error.message);
    }
    throw error;
  }
}

export function registerAdminCatalogRoutes(
  app: FastifyInstance,
  service: AdminCatalogService,
  tokenService: JwtTokenService,
  userService: UserService,
  adminTelegramIds: ReadonlySet<string>,
  maxImageUploadSize = 5 * 1024 * 1024,
): void {
  const guard = createAdminGuard(tokenService, userService, adminTelegramIds);
  const archives = new CatalogArchiveService();
  for (const kind of ["products", "categories"] as const) {
    for (const action of ["archive", "restore"] as const) {
      app.post(
        `/admin/catalog/${kind}/:id/${action}`,
        { preHandler: guard },
        async (request) => {
          const { id } = parse(
            idParamsSchema,
            request.params,
            "Invalid catalog id",
          );
          if (kind === "products")
            return {
              product: await archives.product(
                id,
                actorId(request),
                action === "archive",
              ),
            };
          return {
            category: await archives.category(
              id,
              actorId(request),
              action === "archive",
            ),
          };
        },
      );
    }
  }

  app.get("/admin/catalog/upload-config", { preHandler: guard }, async () => ({
    maxImageUploadSize,
  }));

  app.get(
    "/admin/catalog/products/:id/telegram",
    { preHandler: guard },
    async (request) => {
      const { id } = parse(
        idParamsSchema,
        request.params,
        "Invalid product id",
      );
      return {
        publication: await mapCatalogError(() =>
          service.getTelegramPublication(id),
        ),
      };
    },
  );
  app.post(
    "/admin/catalog/products/:id/telegram/publish",
    { preHandler: guard },
    async (request) => {
      // Worker Access + existing web session/Origin/CSRF guard; no Bearer-only bypass.
      if (!request.webAdminActor)
        throw new HttpError(403, "Admin web session required");
      const { id } = parse(
        idParamsSchema,
        request.params,
        "Invalid product id",
      );
      return {
        publication: await mapCatalogError(() =>
          service.publishTelegram(actorId(request), id),
        ),
      };
    },
  );

  void app.register(async (uploadScope) => {
    await uploadScope.register(multipart, {
      limits: { files: 1, fields: 0, parts: 1, fileSize: maxImageUploadSize },
    });
    uploadScope.post(
      "/admin/catalog/products/:productId/images/upload",
      {
        preHandler: guard,
        bodyLimit: maxImageUploadSize + 64 * 1024,
      },
      async (request, reply) => {
        const { productId } = parse(
          productIdParamsSchema,
          request.params,
          "Invalid product id",
        );
        const metadata = parse(
          imageUploadQuerySchema,
          request.query,
          "Invalid image metadata",
        );
        try {
          const file = await request.file();
          if (!file || file.fieldname !== "file") {
            throw new HttpError(
              400,
              "A multipart image field named 'file' is required",
            );
          }
          const data = await file.toBuffer();
          if (file.file.truncated)
            throw new ImageTooLargeError(maxImageUploadSize);
          const image = await mapCatalogError(() =>
            service.uploadImage(actorId(request), productId, {
              data,
              declaredMimeType: file.mimetype,
              sortOrder: metadata.sortOrder,
              isPrimary: metadata.isPrimary,
            }),
          );
          return reply.status(201).send({ image });
        } catch (error) {
          if (
            typeof error === "object" &&
            error !== null &&
            "code" in error &&
            error.code === "FST_REQ_FILE_TOO_LARGE"
          ) {
            throw new HttpError(
              413,
              `Image exceeds the ${maxImageUploadSize} byte upload limit`,
            );
          }
          if (error instanceof HttpError) throw error;
          return mapCatalogError(async () => Promise.reject(error));
        }
      },
    );
  });

  app.get("/admin/catalog/categories", { preHandler: guard }, async () => ({
    categories: await service.listCategories(),
  }));

  app.post(
    "/admin/catalog/categories",
    { preHandler: guard },
    async (request, reply) => {
      const input = parse(
        categoryCreateSchema,
        request.body,
        "Invalid category payload",
      );
      const category = await mapCatalogError(() =>
        service.createCategory(actorId(request), input),
      );
      return reply.status(201).send({ category });
    },
  );

  app.patch(
    "/admin/catalog/categories/:id",
    { preHandler: guard },
    async (request) => {
      const { id } = parse(
        idParamsSchema,
        request.params,
        "Invalid category id",
      );
      const input = parse(
        categoryPatchSchema,
        request.body,
        "Invalid category payload",
      );
      return {
        category: await mapCatalogError(() =>
          service.updateCategory(actorId(request), id, input),
        ),
      };
    },
  );

  for (const [path, active] of [
    ["activate", true],
    ["deactivate", false],
  ] as const) {
    app.post(
      `/admin/catalog/categories/:id/${path}`,
      { preHandler: guard },
      async (request) => {
        const { id } = parse(
          idParamsSchema,
          request.params,
          "Invalid category id",
        );
        return {
          category: await mapCatalogError(() =>
            service.setCategoryActive(actorId(request), id, active),
          ),
        };
      },
    );
  }

  app.get("/admin/catalog/products", { preHandler: guard }, async (request) => {
    const query = parse(
      adminProductListQuerySchema,
      request.query,
      "Invalid catalog query",
    );
    return mapCatalogError(() => service.listProducts(query));
  });

  app.get(
    "/admin/catalog/products/:id",
    { preHandler: guard },
    async (request) => {
      const { id } = parse(
        idParamsSchema,
        request.params,
        "Invalid product id",
      );
      return { product: await mapCatalogError(() => service.getProduct(id)) };
    },
  );

  app.post(
    "/admin/catalog/products",
    { preHandler: guard },
    async (request, reply) => {
      const input = parse(
        productCreateSchema,
        request.body,
        "Invalid product payload",
      );
      const { publishToChannel, ...fields } = input;
      const product = await mapCatalogError(() =>
        service.createProduct(actorId(request), fields, publishToChannel),
      );
      return reply.status(201).send({ product });
    },
  );

  app.patch(
    "/admin/catalog/products/:id",
    { preHandler: guard },
    async (request) => {
      const { id } = parse(
        idParamsSchema,
        request.params,
        "Invalid product id",
      );
      const input = parse(
        productPatchSchema,
        request.body,
        "Invalid product payload",
      );
      const { publishToChannel, ...fields } = input;
      return {
        product: await mapCatalogError(() =>
          service.updateProduct(actorId(request), id, fields, publishToChannel),
        ),
      };
    },
  );

  for (const [path, active] of [
    ["activate", true],
    ["deactivate", false],
  ] as const) {
    app.post(
      `/admin/catalog/products/:id/${path}`,
      { preHandler: guard },
      async (request) => {
        const { id } = parse(
          idParamsSchema,
          request.params,
          "Invalid product id",
        );
        const { publishToChannel } = parse(
          productActivationSchema,
          request.body ?? {},
          "Invalid publication option",
        );
        return {
          product: await mapCatalogError(() =>
            service.setProductActive(
              actorId(request),
              id,
              active,
              publishToChannel,
            ),
          ),
        };
      },
    );
  }

  app.post(
    "/admin/catalog/products/:productId/images",
    { preHandler: guard },
    async (request, reply) => {
      const { productId } = parse(
        productIdParamsSchema,
        request.params,
        "Invalid product id",
      );
      const input = parse(
        imageCreateSchema,
        request.body,
        "Invalid image payload",
      );
      const image = await mapCatalogError(() =>
        service.createImage(actorId(request), productId, input),
      );
      return reply.status(201).send({ image });
    },
  );

  app.patch(
    "/admin/catalog/images/:id",
    { preHandler: guard },
    async (request) => {
      const { id } = parse(idParamsSchema, request.params, "Invalid image id");
      const input = parse(
        imagePatchSchema,
        request.body,
        "Invalid image payload",
      );
      return {
        image: await mapCatalogError(() =>
          service.updateImage(actorId(request), id, input),
        ),
      };
    },
  );

  app.delete(
    "/admin/catalog/images/:id",
    { preHandler: guard },
    async (request) => {
      const { id } = parse(idParamsSchema, request.params, "Invalid image id");
      return {
        image: await mapCatalogError(() =>
          service.deleteImage(actorId(request), id),
        ),
      };
    },
  );

  app.post(
    "/admin/catalog/products/:productId/variants",
    { preHandler: guard },
    async (request, reply) => {
      const { productId } = parse(
        productIdParamsSchema,
        request.params,
        "Invalid product id",
      );
      const input = parse(
        variantCreateSchema,
        request.body,
        "Invalid variant payload",
      );
      const variant = await mapCatalogError(() =>
        service.createVariant(actorId(request), productId, input),
      );
      return reply.status(201).send({ variant });
    },
  );

  app.patch(
    "/admin/catalog/variants/:id",
    { preHandler: guard },
    async (request) => {
      const { id } = parse(
        idParamsSchema,
        request.params,
        "Invalid variant id",
      );
      const input = parse(
        variantPatchSchema,
        request.body,
        "Invalid variant payload",
      );
      return {
        variant: await mapCatalogError(() =>
          service.updateVariant(actorId(request), id, input),
        ),
      };
    },
  );

  for (const action of ["generate-preview", "generate"] as const) {
    app.post(
      `/admin/catalog/products/:productId/variants/${action}`,
      { preHandler: guard, bodyLimit: 16 * 1024 },
      async (request) => {
        // Mutations use the existing web session + Origin + CSRF contract.
        if (!request.webAdminActor)
          throw new HttpError(403, "Admin web session required");
        const { productId } = parse(
          productIdParamsSchema,
          request.params,
          "Invalid product id",
        );
        const input = parse(
          variantGeneratorSchema,
          request.body,
          "Invalid variant generator payload",
        );
        return mapCatalogError(async () =>
          action === "generate-preview"
            ? service.previewVariants(productId, input)
            : service.generateVariants(actorId(request), productId, input),
        );
      },
    );
  }

  for (const [path, active] of [
    ["activate", true],
    ["deactivate", false],
  ] as const) {
    app.post(
      `/admin/catalog/variants/:id/${path}`,
      { preHandler: guard },
      async (request) => {
        const { id } = parse(
          idParamsSchema,
          request.params,
          "Invalid variant id",
        );
        return {
          variant: await mapCatalogError(() =>
            service.setVariantActive(actorId(request), id, active),
          ),
        };
      },
    );
  }
}
