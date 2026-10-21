import { Prisma, prisma } from "@stenzo/database";

import { CatalogInvalidCursorError } from "./errors.js";
import type {
  CatalogCategoryRecord,
  CatalogProductListQuery,
  CatalogProductListResult,
  CatalogProductRecord,
} from "./types.js";

export interface CatalogRepository {
  listActiveCategories(): Promise<CatalogCategoryRecord[]>;
  listActiveProducts(
    query: CatalogProductListQuery,
  ): Promise<CatalogProductListResult>;
  getActiveProductBySlug(slug: string): Promise<CatalogProductRecord | null>;
}

export const publicProductInclude = {
  category: true,
  images: {
    orderBy: [
      { isPrimary: "desc" as const },
      { sortOrder: "asc" as const },
      { id: "asc" as const },
    ],
  },
  variants: {
    where: { isActive: true },
    orderBy: [
      { size: "asc" as const },
      { color: "asc" as const },
      { id: "asc" as const },
    ],
  },
};

function productWhere(
  query: Pick<CatalogProductListQuery, "category" | "search">,
): Prisma.ProductWhereInput {
  return {
    status: "ACTIVE",
    archivedAt: null,
    category: {
      isActive: true,
      archivedAt: null,
      ...(query.category ? { slug: query.category } : {}),
    },
    ...(query.search
      ? {
          OR: [
            { nameRu: { contains: query.search, mode: "insensitive" } },
            { nameUz: { contains: query.search, mode: "insensitive" } },
            { descriptionRu: { contains: query.search, mode: "insensitive" } },
            { descriptionUz: { contains: query.search, mode: "insensitive" } },
          ],
        }
      : {}),
  };
}

export class PrismaCatalogRepository implements CatalogRepository {
  public listActiveCategories(): Promise<CatalogCategoryRecord[]> {
    return prisma.category.findMany({
      where: { isActive: true, archivedAt: null },
      orderBy: [{ sortOrder: "asc" }, { nameRu: "asc" }, { id: "asc" }],
    });
  }

  public async listActiveProducts(
    query: CatalogProductListQuery,
  ): Promise<CatalogProductListResult> {
    const where = productWhere(query);
    if (query.cursor) {
      const cursor = await prisma.product.findFirst({
        where: { ...where, id: query.cursor },
        select: { id: true },
      });
      if (!cursor) throw new CatalogInvalidCursorError();
    }

    const products = await prisma.product.findMany({
      where,
      include: publicProductInclude,
      orderBy: { id: "asc" },
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      take: query.limit + 1,
    });
    const hasNextPage = products.length > query.limit;
    const visibleProducts = hasNextPage
      ? products.slice(0, query.limit)
      : products;

    return {
      products: visibleProducts,
      nextCursor: hasNextPage ? (visibleProducts.at(-1)?.id ?? null) : null,
    };
  }

  public getActiveProductBySlug(
    slug: string,
  ): Promise<CatalogProductRecord | null> {
    return prisma.product.findFirst({
      where: {
        slug,
        status: "ACTIVE",
        archivedAt: null,
        category: { isActive: true, archivedAt: null },
      },
      include: publicProductInclude,
    });
  }
}
