import Fastify from "fastify";
import { describe, expect, it } from "vitest";

import { CatalogInvalidCursorError } from "../src/modules/catalog/errors.js";
import type { CatalogRepository } from "../src/modules/catalog/repository.js";
import { registerCatalogRoutes } from "../src/modules/catalog/route.js";
import {
  CatalogService,
  toProductDto,
} from "../src/modules/catalog/service.js";
import type {
  CatalogCategoryRecord,
  CatalogProductListQuery,
  CatalogProductListResult,
  CatalogProductRecord,
} from "../src/modules/catalog/types.js";

const timestamp = new Date("2026-09-29T00:00:00.000Z");

it("omits private sourceUrl from the public DTO even when Prisma returns it", () => {
  const record = {
    ...product("private-source", categories[0]!),
    sourceUrl: "https://example.com/admin-reference",
  };
  const publicProduct = toProductDto(record);
  expect(publicProduct).not.toHaveProperty("sourceUrl");
  expect(publicProduct.price).toBe(850000);
});

const categories: CatalogCategoryRecord[] = [
  {
    id: "c1",
    nameRu: "Худи",
    nameUz: "Hudi",
    slug: "hoodies",
    sortOrder: 1,
    isActive: true,
    createdAt: timestamp,
    updatedAt: timestamp,
  },
  {
    id: "c2",
    nameRu: "Футболки",
    nameUz: "Futbolkalar",
    slug: "t-shirts",
    sortOrder: 2,
    isActive: true,
    createdAt: timestamp,
    updatedAt: timestamp,
  },
  {
    id: "c3",
    nameRu: "Скрытая",
    nameUz: "Yashirin",
    slug: "hidden",
    sortOrder: 3,
    isActive: false,
    createdAt: timestamp,
    updatedAt: timestamp,
  },
];

function product(
  id: string,
  category: CatalogCategoryRecord,
  overrides: Partial<CatalogProductRecord> = {},
): CatalogProductRecord {
  return {
    id,
    categoryId: category.id,
    nameRu: `Товар ${id}`,
    nameUz: `Mahsulot ${id}`,
    slug: `product-${id}`,
    descriptionRu: null,
    descriptionUz: null,
    price: 850_000,
    currency: "UZS",
    status: "ACTIVE",
    isFeatured: false,
    createdAt: timestamp,
    updatedAt: timestamp,
    category,
    images: [],
    variants: [],
    ...overrides,
  };
}

class MemoryCatalogRepository implements CatalogRepository {
  private readonly products = [
    product("1", categories[0]!, {
      nameRu: "Чёрное худи",
      nameUz: "Qora hudi",
      images: [
        {
          id: "i1",
          productId: "1",
          url: "https://cdn.example/hudi.jpg",
          storageKey: null,
          sortOrder: 0,
          isPrimary: true,
          createdAt: timestamp,
        },
      ],
      variants: [
        {
          id: "v1",
          productId: "1",
          sku: "HD-BLK-M",
          size: "M",
          color: "Black",
          stock: 3,
          isActive: true,
          createdAt: timestamp,
          updatedAt: timestamp,
        },
        {
          id: "v2",
          productId: "1",
          sku: "HD-BLK-3XL",
          size: "3XL",
          color: "Black",
          stock: null,
          isActive: true,
          createdAt: timestamp,
          updatedAt: timestamp,
        },
        {
          id: "v3",
          productId: "1",
          sku: "HD-BLK-L",
          size: "L",
          color: "Black",
          stock: 0,
          isActive: true,
          createdAt: timestamp,
          updatedAt: timestamp,
        },
      ],
    }),
    product("2", categories[1]!, {
      nameRu: "Белая футболка",
      nameUz: "Oq futbolka",
    }),
    product("3", categories[0]!, {
      status: "INACTIVE",
      nameRu: "Скрытое худи",
    }),
    product("4", categories[2]!, { nameRu: "Товар скрытой категории" }),
  ];

  public listActiveCategories(): Promise<CatalogCategoryRecord[]> {
    return Promise.resolve(categories.filter((category) => category.isActive));
  }

  public listActiveProducts(
    query: CatalogProductListQuery,
  ): Promise<CatalogProductListResult> {
    let visible = this.products.filter(
      (item) => item.status === "ACTIVE" && item.category.isActive,
    );
    if (query.category)
      visible = visible.filter((item) => item.category.slug === query.category);
    if (query.search) {
      const search = query.search.toLocaleLowerCase();
      visible = visible.filter((item) =>
        [item.nameRu, item.nameUz, item.descriptionRu, item.descriptionUz]
          .filter((value): value is string => value !== null)
          .some((value) => value.toLocaleLowerCase().includes(search)),
      );
    }
    if (query.cursor) {
      const cursorIndex = visible.findIndex((item) => item.id === query.cursor);
      if (cursorIndex < 0) throw new CatalogInvalidCursorError();
      visible = visible.slice(cursorIndex + 1);
    }
    const page = visible.slice(0, query.limit);
    return Promise.resolve({
      products: page,
      nextCursor:
        visible.length > query.limit ? (page.at(-1)?.id ?? null) : null,
    });
  }

  public getActiveProductBySlug(
    slug: string,
  ): Promise<CatalogProductRecord | null> {
    return Promise.resolve(
      this.products.find(
        (item) =>
          item.slug === slug &&
          item.status === "ACTIVE" &&
          item.category.isActive,
      ) ?? null,
    );
  }
}

function createApp() {
  const app = Fastify();
  registerCatalogRoutes(app, new CatalogService(new MemoryCatalogRepository()));
  return app;
}

describe("public catalog API", () => {
  it.each([null, 0, 3])(
    "keeps legacy stock=%s semantics separate from explicit preorder permission",
    (stock) => {
      const variant = {
        id: "availability-fixture",
        productId: "availability",
        sku: "SAME-SKU",
        size: "M",
        color: "blue",
        stock,
        isActive: true,
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      for (const preorderEnabled of [undefined, false, true]) {
        const result = toProductDto(
          product("availability", categories[0]!, {
            variants: [
              {
                ...variant,
                ...(preorderEnabled === undefined ? {} : { preorderEnabled }),
              },
            ],
          }),
        );
        expect(result.variants[0]).toEqual({
          attributes: {},
          id: variant.id,
          sku: variant.sku,
          size: variant.size,
          color: variant.color,
          stock,
          isAvailable: stock === null || stock > 0,
          availability: {
            IN_STOCK: {
              quantity: stock,
              available: stock !== null && stock > 0,
            },
            PREORDER: {
              enabled: preorderEnabled ?? false,
              checkoutEnabled: false,
            },
          },
        });
        expect(result.availableSizes).toEqual(
          stock === null || stock > 0 ? ["M"] : [],
        );
        expect(result.price).toBe(850000);
      }
    },
  );
  it("returns only active categories with both localizations", async () => {
    const app = createApp();
    const response = await app.inject({
      method: "GET",
      url: "/catalog/categories",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json<{ categories: unknown[] }>().categories).toHaveLength(
      2,
    );
    expect(
      response.json<{ categories: Array<{ nameRu: string; nameUz: string }> }>()
        .categories[0],
    ).toMatchObject({
      nameRu: "Худи",
      nameUz: "Hudi",
    });
    await app.close();
  });

  it("filters by category and searches RU/UZ fields", async () => {
    const app = createApp();
    const byCategory = await app.inject({
      method: "GET",
      url: "/catalog/products?category=t-shirts",
    });
    const byUzSearch = await app.inject({
      method: "GET",
      url: "/catalog/products?search=qora",
    });

    expect(byCategory.json()).toMatchObject({
      products: [{ slug: "product-2" }],
    });
    expect(byUzSearch.json()).toMatchObject({
      products: [{ slug: "product-1" }],
    });
    await app.close();
  });

  it("paginates with an opaque cursor and rejects unknown cursors", async () => {
    const app = createApp();
    const first = await app.inject({
      method: "GET",
      url: "/catalog/products?limit=1",
    });
    const firstBody = first.json<{ nextCursor: string; products: unknown[] }>();
    const second = await app.inject({
      method: "GET",
      url: `/catalog/products?limit=1&cursor=${firstBody.nextCursor}`,
    });
    const invalid = await app.inject({
      method: "GET",
      url: "/catalog/products?cursor=missing",
    });

    expect(firstBody.products).toHaveLength(1);
    expect(firstBody.nextCursor).toBe("1");
    expect(second.json()).toMatchObject({
      products: [{ id: "2" }],
      nextCursor: null,
    });
    expect(invalid.statusCode).toBe(400);
    await app.close();
  });

  it("hides inactive products and products in inactive categories", async () => {
    const app = createApp();
    const list = await app.inject({ method: "GET", url: "/catalog/products" });
    const inactive = await app.inject({
      method: "GET",
      url: "/catalog/products/product-3",
    });
    const inactiveCategory = await app.inject({
      method: "GET",
      url: "/catalog/products/product-4",
    });

    expect(list.json<{ products: unknown[] }>().products).toHaveLength(2);
    expect(inactive.statusCode).toBe(404);
    expect(inactiveCategory.statusCode).toBe(404);
    await app.close();
  });

  it("returns images, free-form variants and only available sizes", async () => {
    const app = createApp();
    const response = await app.inject({
      method: "GET",
      url: "/catalog/products/product-1",
    });

    expect(response.json()).toMatchObject({
      product: {
        price: 850000,
        currency: "UZS",
        images: [{ url: "https://cdn.example/hudi.jpg", isPrimary: true }],
        variants: [
          { size: "M", stock: 3, isAvailable: true },
          { size: "3XL", stock: null, isAvailable: true },
          { size: "L", stock: 0, isAvailable: false },
        ],
        availableSizes: ["M", "3XL"],
      },
    });
    await app.close();
  });
});
