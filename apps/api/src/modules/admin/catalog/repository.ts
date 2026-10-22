import { Prisma, prisma } from "@stenzo/database";
import { WEB_ADMIN_ACTOR, ADMIN_LOGIN } from "../web-session.js";

import {
  AdminCatalogCategoryNotFoundError,
  AdminCatalogDuplicateSkuError,
  AdminCatalogDuplicateSlugError,
  AdminCatalogImageNotFoundError,
  AdminCatalogInvalidCursorError,
  AdminCatalogPrimaryImageConflictError,
  AdminCatalogProductNotFoundError,
  AdminCatalogVariantNotFoundError,
} from "./errors.js";
import type {
  AdminCategoryRecord,
  AdminImageRecord,
  AdminProductListQuery,
  AdminProductListResult,
  AdminProductRecord,
  AdminVariantRecord,
  CategoryCreateInput,
  CategoryPatchInput,
  ProductCreateInput,
  ProductImageCreateInput,
  ProductImagePatchInput,
  ProductPatchInput,
  ProductStatusValue,
  ProductVariantCreateInput,
  ProductVariantPatchInput,
} from "./types.js";

export interface AdminCatalogRepository {
  listCategories(): Promise<AdminCategoryRecord[]>;
  createCategory(
    actorId: string,
    input: CategoryCreateInput,
  ): Promise<AdminCategoryRecord>;
  updateCategory(
    actorId: string,
    id: string,
    input: CategoryPatchInput,
  ): Promise<AdminCategoryRecord>;
  setCategoryActive(
    actorId: string,
    id: string,
    isActive: boolean,
  ): Promise<AdminCategoryRecord>;
  listProducts(query: AdminProductListQuery): Promise<AdminProductListResult>;
  getProduct(id: string): Promise<AdminProductRecord | null>;
  createProduct(
    actorId: string,
    input: ProductCreateInput,
  ): Promise<AdminProductRecord>;
  updateProduct(
    actorId: string,
    id: string,
    input: ProductPatchInput,
  ): Promise<AdminProductRecord>;
  setProductStatus(
    actorId: string,
    id: string,
    status: ProductStatusValue,
  ): Promise<AdminProductRecord>;
  createImage(
    actorId: string,
    productId: string,
    input: ProductImageCreateInput,
  ): Promise<AdminImageRecord>;
  getImage(id: string): Promise<AdminImageRecord | null>;
  updateImage(
    actorId: string,
    id: string,
    input: ProductImagePatchInput,
  ): Promise<AdminImageRecord>;
  deleteImage(actorId: string, id: string): Promise<AdminImageRecord>;
  createVariant(
    actorId: string,
    productId: string,
    input: ProductVariantCreateInput,
  ): Promise<AdminVariantRecord>;
  updateVariant(
    actorId: string,
    id: string,
    input: ProductVariantPatchInput,
  ): Promise<AdminVariantRecord>;
  setVariantActive(
    actorId: string,
    id: string,
    isActive: boolean,
  ): Promise<AdminVariantRecord>;
}

const adminProductInclude = {
  category: true,
  images: {
    orderBy: [
      { isPrimary: "desc" as const },
      { sortOrder: "asc" as const },
      { id: "asc" as const },
    ],
  },
  variants: {
    orderBy: [
      { size: "asc" as const },
      { color: "asc" as const },
      { id: "asc" as const },
    ],
  },
};

function prismaCode(error: unknown): string | undefined {
  if (typeof error === "object" && error !== null && "code" in error) {
    return typeof error.code === "string" ? error.code : undefined;
  }
  return undefined;
}

async function withAudit<T extends { id: string }>(
  actorId: string,
  action: string,
  entityType: string,
  operation: (tx: Prisma.TransactionClient) => Promise<T>,
  metadata: (record: T) => Prisma.InputJsonObject,
): Promise<T> {
  return prisma.$transaction(async (tx) => {
    const record = await operation(tx);
    await tx.auditLog.create({
      data: {
        actorId: actorId === WEB_ADMIN_ACTOR ? null : actorId,
        action,
        entityType,
        entityId: record.id,
        metadata: {
          ...metadata(record),
          ...(actorId === WEB_ADMIN_ACTOR
            ? { adminPrincipal: ADMIN_LOGIN, authType: "web-admin" }
            : {}),
        },
      },
    });
    return record;
  });
}

export class PrismaAdminCatalogRepository implements AdminCatalogRepository {
  public listCategories(): Promise<AdminCategoryRecord[]> {
    return prisma.category.findMany({
      orderBy: [{ sortOrder: "asc" }, { nameRu: "asc" }, { id: "asc" }],
    });
  }

  public async createCategory(
    actorId: string,
    input: CategoryCreateInput,
  ): Promise<AdminCategoryRecord> {
    try {
      return await withAudit(
        actorId,
        "category.create",
        "Category",
        (tx) => tx.category.create({ data: input }),
        (record) => ({ slug: record.slug }),
      );
    } catch (error) {
      if (prismaCode(error) === "P2002")
        throw new AdminCatalogDuplicateSlugError();
      throw error;
    }
  }

  public async updateCategory(
    actorId: string,
    id: string,
    input: CategoryPatchInput,
  ): Promise<AdminCategoryRecord> {
    try {
      return await withAudit(
        actorId,
        "category.update",
        "Category",
        (tx) => tx.category.update({ where: { id }, data: input }),
        (record) => ({ slug: record.slug }),
      );
    } catch (error) {
      if (prismaCode(error) === "P2002")
        throw new AdminCatalogDuplicateSlugError();
      if (prismaCode(error) === "P2025")
        throw new AdminCatalogCategoryNotFoundError();
      throw error;
    }
  }

  public async setCategoryActive(
    actorId: string,
    id: string,
    isActive: boolean,
  ): Promise<AdminCategoryRecord> {
    try {
      return await withAudit(
        actorId,
        isActive ? "category.activate" : "category.deactivate",
        "Category",
        (tx) => tx.category.update({ where: { id }, data: { isActive } }),
        () => ({ isActive }),
      );
    } catch (error) {
      if (prismaCode(error) === "P2025")
        throw new AdminCatalogCategoryNotFoundError();
      throw error;
    }
  }

  public async listProducts(
    query: AdminProductListQuery,
  ): Promise<AdminProductListResult> {
    const where: Prisma.ProductWhereInput = {
      archivedAt: query.archive === "archived" ? { not: null } : null,
      ...(query.status ? { status: query.status } : {}),
      ...(query.category ? { category: { slug: query.category } } : {}),
      ...(query.search
        ? {
            OR: [
              { nameRu: { contains: query.search, mode: "insensitive" } },
              { nameUz: { contains: query.search, mode: "insensitive" } },
              { slug: { contains: query.search, mode: "insensitive" } },
            ],
          }
        : {}),
    };
    if (query.cursor) {
      const cursor = await prisma.product.findFirst({
        where: { ...where, id: query.cursor },
        select: { id: true },
      });
      if (!cursor) throw new AdminCatalogInvalidCursorError();
    }
    const products = await prisma.product.findMany({
      where,
      include: adminProductInclude,
      orderBy: { id: "asc" },
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      take: query.limit + 1,
    });
    const hasNextPage = products.length > query.limit;
    const visible = hasNextPage ? products.slice(0, query.limit) : products;
    return {
      products: visible,
      nextCursor: hasNextPage ? (visible.at(-1)?.id ?? null) : null,
    };
  }

  public getProduct(id: string): Promise<AdminProductRecord | null> {
    return prisma.product.findUnique({
      where: { id },
      include: adminProductInclude,
    });
  }

  public async createProduct(
    actorId: string,
    input: ProductCreateInput,
  ): Promise<AdminProductRecord> {
    try {
      const { categoryId, ...data } = input;
      return await withAudit(
        actorId,
        "product.create",
        "Product",
        (tx) =>
          tx.product.create({
            data: { ...data, category: { connect: { id: categoryId } } },
            include: adminProductInclude,
          }),
        (record) => ({ slug: record.slug, categoryId: record.categoryId }),
      );
    } catch (error) {
      if (prismaCode(error) === "P2002")
        throw new AdminCatalogDuplicateSlugError();
      if (prismaCode(error) === "P2003" || prismaCode(error) === "P2025")
        throw new AdminCatalogCategoryNotFoundError();
      throw error;
    }
  }

  public async updateProduct(
    actorId: string,
    id: string,
    input: ProductPatchInput,
  ): Promise<AdminProductRecord> {
    try {
      const { categoryId, ...data } = input;
      return await withAudit(
        actorId,
        "product.update",
        "Product",
        (tx) =>
          tx.product.update({
            where: { id },
            data: categoryId
              ? { ...data, category: { connect: { id: categoryId } } }
              : data,
            include: adminProductInclude,
          }),
        (record) => ({ slug: record.slug, categoryId: record.categoryId }),
      );
    } catch (error) {
      if (prismaCode(error) === "P2002")
        throw new AdminCatalogDuplicateSlugError();
      if (prismaCode(error) === "P2003")
        throw new AdminCatalogCategoryNotFoundError();
      if (prismaCode(error) === "P2025")
        throw new AdminCatalogProductNotFoundError();
      throw error;
    }
  }

  public async setProductStatus(
    actorId: string,
    id: string,
    status: ProductStatusValue,
  ): Promise<AdminProductRecord> {
    try {
      return await withAudit(
        actorId,
        status === "ACTIVE" ? "product.activate" : "product.deactivate",
        "Product",
        (tx) =>
          tx.product.update({
            where: { id },
            data: { status },
            include: adminProductInclude,
          }),
        () => ({ status }),
      );
    } catch (error) {
      if (prismaCode(error) === "P2025")
        throw new AdminCatalogProductNotFoundError();
      throw error;
    }
  }

  public async createImage(
    actorId: string,
    productId: string,
    input: ProductImageCreateInput,
  ): Promise<AdminImageRecord> {
    try {
      return await withAudit(
        actorId,
        "product-image.create",
        "ProductImage",
        async (tx) => {
          const existingPrimary = await tx.productImage.findFirst({
            where: { productId, isPrimary: true },
            select: { id: true },
          });
          const isPrimary = input.isPrimary || !existingPrimary;
          if (isPrimary)
            await tx.productImage.updateMany({
              where: { productId, isPrimary: true },
              data: { isPrimary: false },
            });
          return tx.productImage.create({
            data: { ...input, isPrimary, productId },
          });
        },
        (record) => ({
          productId: record.productId,
          isPrimary: record.isPrimary,
        }),
      );
    } catch (error) {
      if (prismaCode(error) === "P2003")
        throw new AdminCatalogProductNotFoundError();
      if (prismaCode(error) === "P2002")
        throw new AdminCatalogPrimaryImageConflictError();
      throw error;
    }
  }

  public getImage(id: string): Promise<AdminImageRecord | null> {
    return prisma.productImage.findUnique({ where: { id } });
  }

  public async updateImage(
    actorId: string,
    id: string,
    input: ProductImagePatchInput,
  ): Promise<AdminImageRecord> {
    try {
      return await withAudit(
        actorId,
        "product-image.update",
        "ProductImage",
        async (tx) => {
          const current = await tx.productImage.findUnique({ where: { id } });
          if (!current) throw new AdminCatalogImageNotFoundError();
          if (input.isPrimary === true)
            await tx.productImage.updateMany({
              where: {
                productId: current.productId,
                isPrimary: true,
                id: { not: id },
              },
              data: { isPrimary: false },
            });
          const updated = await tx.productImage.update({
            where: { id },
            data: input,
          });
          if (current.isPrimary && input.isPrimary === false) {
            const replacement = await tx.productImage.findFirst({
              where: { productId: current.productId, id: { not: id } },
              orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
              select: { id: true },
            });
            if (replacement) {
              await tx.productImage.update({
                where: { id: replacement.id },
                data: { isPrimary: true },
              });
            }
          }
          return updated;
        },
        (record) => ({
          productId: record.productId,
          isPrimary: record.isPrimary,
        }),
      );
    } catch (error) {
      if (error instanceof AdminCatalogImageNotFoundError) throw error;
      if (prismaCode(error) === "P2025")
        throw new AdminCatalogImageNotFoundError();
      if (prismaCode(error) === "P2002")
        throw new AdminCatalogPrimaryImageConflictError();
      throw error;
    }
  }

  public async deleteImage(
    actorId: string,
    id: string,
  ): Promise<AdminImageRecord> {
    try {
      return await withAudit(
        actorId,
        "product-image.delete",
        "ProductImage",
        async (tx) => {
          const current = await tx.productImage.findUnique({ where: { id } });
          if (!current) throw new AdminCatalogImageNotFoundError();
          const deleted = await tx.productImage.delete({ where: { id } });
          if (current.isPrimary) {
            const replacement = await tx.productImage.findFirst({
              where: { productId: current.productId },
              orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
              select: { id: true },
            });
            if (replacement) {
              await tx.productImage.update({
                where: { id: replacement.id },
                data: { isPrimary: true },
              });
            }
          }
          return deleted;
        },
        (record) => ({
          productId: record.productId,
          storageKey: record.storageKey,
        }),
      );
    } catch (error) {
      if (error instanceof AdminCatalogImageNotFoundError) throw error;
      if (prismaCode(error) === "P2025")
        throw new AdminCatalogImageNotFoundError();
      throw error;
    }
  }

  public async createVariant(
    actorId: string,
    productId: string,
    input: ProductVariantCreateInput,
  ): Promise<AdminVariantRecord> {
    try {
      return await withAudit(
        actorId,
        "product-variant.create",
        "ProductVariant",
        (tx) => tx.productVariant.create({ data: { ...input, productId } }),
        (record) => ({
          productId: record.productId,
          sku: record.sku,
          preorderEnabled: record.preorderEnabled,
        }),
      );
    } catch (error) {
      if (prismaCode(error) === "P2002")
        throw new AdminCatalogDuplicateSkuError();
      if (prismaCode(error) === "P2003")
        throw new AdminCatalogProductNotFoundError();
      throw error;
    }
  }

  public async updateVariant(
    actorId: string,
    id: string,
    input: ProductVariantPatchInput,
  ): Promise<AdminVariantRecord> {
    try {
      return await withAudit(
        actorId,
        "product-variant.update",
        "ProductVariant",
        (tx) => tx.productVariant.update({ where: { id }, data: input }),
        (record) => ({
          productId: record.productId,
          sku: record.sku,
          ...(input.preorderEnabled === undefined
            ? {}
            : { preorderEnabled: record.preorderEnabled }),
        }),
      );
    } catch (error) {
      if (prismaCode(error) === "P2002")
        throw new AdminCatalogDuplicateSkuError();
      if (prismaCode(error) === "P2025")
        throw new AdminCatalogVariantNotFoundError();
      throw error;
    }
  }

  public async setVariantActive(
    actorId: string,
    id: string,
    isActive: boolean,
  ): Promise<AdminVariantRecord> {
    try {
      return await withAudit(
        actorId,
        isActive ? "product-variant.activate" : "product-variant.deactivate",
        "ProductVariant",
        (tx) => tx.productVariant.update({ where: { id }, data: { isActive } }),
        (record) => ({ productId: record.productId, isActive }),
      );
    } catch (error) {
      if (prismaCode(error) === "P2025")
        throw new AdminCatalogVariantNotFoundError();
      throw error;
    }
  }
}
