import Fastify from "fastify";
import { png, jpeg } from "./fixtures/images.js";
import { describe, expect, it } from "vitest";

import {
  AdminCatalogCategoryNotFoundError,
  AdminCatalogDuplicateSkuError,
  AdminCatalogDuplicateSlugError,
  AdminCatalogImageNotFoundError,
  AdminCatalogProductNotFoundError,
  AdminCatalogVariantNotFoundError,
} from "../src/modules/admin/catalog/errors.js";
import type { AdminCatalogRepository } from "../src/modules/admin/catalog/repository.js";
import { registerAdminCatalogRoutes } from "../src/modules/admin/catalog/route.js";
import { AdminCatalogService } from "../src/modules/admin/catalog/service.js";
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
} from "../src/modules/admin/catalog/types.js";
import { JwtTokenService } from "../src/modules/auth/token.js";
import { registerWebAdminAuth } from "../src/modules/admin/web-auth.js";
import { WebAdminSessions } from "../src/modules/admin/web-session.js";
import { argon2id, hash } from "argon2";
import { randomBytes } from "node:crypto";
import { ImageStorageService } from "../src/modules/media/service.js";
import type {
  StorageProvider,
  StorageWriteInput,
} from "../src/modules/media/types.js";
import type { UserRepository } from "../src/modules/users/repository.js";
import { UserService } from "../src/modules/users/service.js";
import type { UserRecord } from "../src/modules/users/types.js";

const timestamp = new Date("2026-09-29T00:00:00.000Z");
const jwtSecret = "stenzo-admin-catalog-secret-longer-than-32-chars";

class StaticUserRepository implements UserRepository {
  public setPreferredLocale(): Promise<UserRecord> {
    return Promise.reject(new Error("Not used by catalog tests"));
  }
  private readonly users: UserRecord[] = [
    {
      id: "admin",
      telegramId: 42n,
      username: "admin",
      firstName: null,
      lastName: null,
      languageCode: null,
      preferredLocale: "uz",
      status: "ACTIVE",
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    {
      id: "customer",
      telegramId: 7n,
      username: "customer",
      firstName: null,
      lastName: null,
      languageCode: null,
      preferredLocale: "uz",
      status: "ACTIVE",
      createdAt: timestamp,
      updatedAt: timestamp,
    },
  ];

  public getById(id: string): Promise<UserRecord | null> {
    return Promise.resolve(this.users.find((user) => user.id === id) ?? null);
  }

  public getByTelegramId(telegramId: bigint): Promise<UserRecord | null> {
    return Promise.resolve(
      this.users.find((user) => user.telegramId === telegramId) ?? null,
    );
  }

  public createOrUpdateFromTelegram(): Promise<UserRecord> {
    return Promise.reject(new Error("Not used by this test"));
  }
}

class MemoryAdminCatalogRepository implements AdminCatalogRepository {
  private categories: AdminCategoryRecord[] = [];
  private products: AdminProductRecord[] = [];
  private images: AdminImageRecord[] = [];
  private variants: AdminVariantRecord[] = [];
  private nextId = 1;

  public listCategories(): Promise<AdminCategoryRecord[]> {
    return Promise.resolve(
      [...this.categories].sort(
        (left, right) => left.sortOrder - right.sortOrder,
      ),
    );
  }

  public createCategory(
    _actorId: string,
    input: CategoryCreateInput,
  ): Promise<AdminCategoryRecord> {
    if (this.categories.some((category) => category.slug === input.slug))
      throw new AdminCatalogDuplicateSlugError();
    const category = {
      id: `category-${this.nextId++}`,
      ...input,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    this.categories.push(category);
    return Promise.resolve(category);
  }

  public updateCategory(
    _actorId: string,
    id: string,
    input: CategoryPatchInput,
  ): Promise<AdminCategoryRecord> {
    const category = this.categories.find((item) => item.id === id);
    if (!category) throw new AdminCatalogCategoryNotFoundError();
    if (
      input.slug &&
      this.categories.some((item) => item.id !== id && item.slug === input.slug)
    )
      throw new AdminCatalogDuplicateSlugError();
    Object.assign(category, input, { updatedAt: timestamp });
    return Promise.resolve(category);
  }

  public setCategoryActive(
    _actorId: string,
    id: string,
    isActive: boolean,
  ): Promise<AdminCategoryRecord> {
    const category = this.categories.find((item) => item.id === id);
    if (!category) throw new AdminCatalogCategoryNotFoundError();
    category.isActive = isActive;
    return Promise.resolve(category);
  }

  public listProducts(
    query: AdminProductListQuery,
  ): Promise<AdminProductListResult> {
    let products = this.products.filter(
      (item) => !query.status || item.status === query.status,
    );
    products = products.slice(0, query.limit);
    return Promise.resolve({ products, nextCursor: null });
  }

  public getProduct(id: string): Promise<AdminProductRecord | null> {
    return Promise.resolve(
      this.products.find((item) => item.id === id) ?? null,
    );
  }

  public createProduct(
    _actorId: string,
    input: ProductCreateInput,
  ): Promise<AdminProductRecord> {
    if (this.products.some((item) => item.slug === input.slug))
      throw new AdminCatalogDuplicateSlugError();
    const category = this.categories.find(
      (item) => item.id === input.categoryId,
    );
    if (!category) throw new AdminCatalogCategoryNotFoundError();
    const product = {
      id: `product-${this.nextId++}`,
      ...input,
      category,
      images: [],
      variants: [],
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    this.products.push(product);
    return Promise.resolve(product);
  }

  public updateProduct(
    _actorId: string,
    id: string,
    input: ProductPatchInput,
  ): Promise<AdminProductRecord> {
    const product = this.products.find((item) => item.id === id);
    if (!product) throw new AdminCatalogProductNotFoundError();
    if (
      input.slug &&
      this.products.some((item) => item.id !== id && item.slug === input.slug)
    )
      throw new AdminCatalogDuplicateSlugError();
    if (input.categoryId) {
      const category = this.categories.find(
        (item) => item.id === input.categoryId,
      );
      if (!category) throw new AdminCatalogCategoryNotFoundError();
      product.category = category;
    }
    Object.assign(product, input, { updatedAt: timestamp });
    return Promise.resolve(product);
  }

  public setProductStatus(
    _actorId: string,
    id: string,
    status: ProductStatusValue,
  ): Promise<AdminProductRecord> {
    const product = this.products.find((item) => item.id === id);
    if (!product) throw new AdminCatalogProductNotFoundError();
    product.status = status;
    return Promise.resolve(product);
  }

  public createImage(
    _actorId: string,
    productId: string,
    input: ProductImageCreateInput,
  ): Promise<AdminImageRecord> {
    const product = this.products.find((item) => item.id === productId);
    if (!product) throw new AdminCatalogProductNotFoundError();
    const isPrimary = input.isPrimary || product.images.length === 0;
    if (isPrimary)
      product.images.forEach((item) => {
        item.isPrimary = false;
      });
    const image = {
      id: `image-${this.nextId++}`,
      productId,
      ...input,
      storageKey: input.storageKey ?? null,
      isPrimary,
      createdAt: timestamp,
    };
    this.images.push(image);
    product.images.push(image);
    return Promise.resolve(image);
  }

  public getImage(id: string): Promise<AdminImageRecord | null> {
    return Promise.resolve(this.images.find((item) => item.id === id) ?? null);
  }

  public updateImage(
    _actorId: string,
    id: string,
    input: ProductImagePatchInput,
  ): Promise<AdminImageRecord> {
    const image = this.images.find((item) => item.id === id);
    if (!image) throw new AdminCatalogImageNotFoundError();
    const product = this.products.find((item) => item.id === image.productId)!;
    if (input.isPrimary === true) {
      product.images
        .filter((item) => item.id !== id)
        .forEach((item) => {
          item.isPrimary = false;
        });
    }
    Object.assign(image, input);
    if (input.isPrimary === false) {
      const replacement = product.images
        .filter((item) => item.id !== id)
        .sort((left, right) => left.sortOrder - right.sortOrder)[0];
      if (replacement) replacement.isPrimary = true;
    }
    return Promise.resolve(image);
  }

  public deleteImage(_actorId: string, id: string): Promise<AdminImageRecord> {
    const index = this.images.findIndex((item) => item.id === id);
    if (index < 0) throw new AdminCatalogImageNotFoundError();
    const [image] = this.images.splice(index, 1);
    const product = this.products.find((item) => item.id === image!.productId)!;
    product.images = product.images.filter((item) => item.id !== id);
    if (image!.isPrimary) {
      const replacement = [...product.images].sort(
        (left, right) => left.sortOrder - right.sortOrder,
      )[0];
      if (replacement) replacement.isPrimary = true;
    }
    return Promise.resolve(image!);
  }

  public createVariant(
    _actorId: string,
    productId: string,
    input: ProductVariantCreateInput,
  ): Promise<AdminVariantRecord> {
    const product = this.products.find((item) => item.id === productId);
    if (!product) throw new AdminCatalogProductNotFoundError();
    if (this.variants.some((item) => item.sku === input.sku))
      throw new AdminCatalogDuplicateSkuError();
    const variant = {
      id: `variant-${this.nextId++}`,
      productId,
      ...input,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    this.variants.push(variant);
    product.variants.push(variant);
    return Promise.resolve(variant);
  }

  public updateVariant(
    _actorId: string,
    id: string,
    input: ProductVariantPatchInput,
  ): Promise<AdminVariantRecord> {
    const variant = this.variants.find((item) => item.id === id);
    if (!variant) throw new AdminCatalogVariantNotFoundError();
    if (
      input.sku &&
      this.variants.some((item) => item.id !== id && item.sku === input.sku)
    )
      throw new AdminCatalogDuplicateSkuError();
    Object.assign(variant, input, { updatedAt: timestamp });
    return Promise.resolve(variant);
  }

  public setVariantActive(
    _actorId: string,
    id: string,
    isActive: boolean,
  ): Promise<AdminVariantRecord> {
    const variant = this.variants.find((item) => item.id === id);
    if (!variant) throw new AdminCatalogVariantNotFoundError();
    variant.isActive = isActive;
    return Promise.resolve(variant);
  }
}

class MemoryStorageProvider implements StorageProvider {
  public readonly files = new Map<string, Buffer>();
  public readonly deletedKeys: string[] = [];

  public upload(input: StorageWriteInput): Promise<void> {
    if (this.files.has(input.key)) throw new Error("overwrite");
    this.files.set(input.key, input.data);
    return Promise.resolve();
  }

  public delete(key: string): Promise<void> {
    this.files.delete(key);
    this.deletedKeys.push(key);
    return Promise.resolve();
  }

  public read(key: string): Promise<Buffer> {
    const data = this.files.get(key);
    if (!data) return Promise.reject(new Error("missing"));
    return Promise.resolve(data);
  }

  public getPublicUrl(key: string): string {
    return `http://localhost:3001/media/${key}`;
  }
}

async function createFixture(webAdminSessions?: WebAdminSessions) {
  const app = Fastify();
  app.decorateRequest("currentUser", null);
  if (webAdminSessions) registerWebAdminAuth(app, webAdminSessions);
  const repository = new MemoryAdminCatalogRepository();
  const tokenService = new JwtTokenService(jwtSecret);
  const storageProvider = new MemoryStorageProvider();
  let generatedId = 0;
  registerAdminCatalogRoutes(
    app,
    new AdminCatalogService(
      repository,
      new ImageStorageService(
        storageProvider,
        1024,
        () =>
          `00000000-0000-4000-8000-${String(++generatedId).padStart(12, "0")}`,
      ),
    ),
    tokenService,
    new UserService(new StaticUserRepository()),
    new Set(["42"]),
    1024,
  );
  return {
    app,
    adminToken: await tokenService.issue("admin"),
    customerToken: await tokenService.issue("customer"),
    storageProvider,
  };
}

function multipartImage(
  data: Buffer,
  mimetype: string,
  filename = "../../unsafe.exe",
) {
  const boundary = "stenzo-test-boundary";
  return {
    payload: Buffer.concat([
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${mimetype}\r\n\r\n`,
      ),
      data,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]),
    headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
  };
}

const categoryPayload = {
  nameRu: "Худи",
  nameUz: "Hudi",
  slug: "hoodies",
  sortOrder: 3,
};

describe("admin catalog API", () => {
  it("uses the existing category CRUD with a web admin session and CSRF", async () => {
    const password = randomBytes(32).toString("base64url");
    const origin = "http://localhost:3002";
    const sessions = new WebAdminSessions(
      await hash(password, { type: argon2id }),
      origin,
    );
    const { app } = await createFixture(sessions);
    const login = await app.inject({
      method: "POST",
      url: "/admin/auth/login",
      headers: { origin, "x-stenzo-admin": "1" },
      payload: { login: "voyey_admin", password },
    });
    expect(login.statusCode).toBe(200);
    const headers = {
      cookie: String(login.headers["set-cookie"]).split(";")[0]!,
      origin,
      "x-csrf-token": login.json<{ csrfToken: string }>().csrfToken,
    };
    const created = await app.inject({
      method: "POST",
      url: "/admin/catalog/categories",
      headers,
      payload: categoryPayload,
    });
    expect(created.statusCode).toBe(201);
    const id = created.json<{ category: { id: string } }>().category.id;
    expect(
      (
        await app.inject({
          method: "PATCH",
          url: `/admin/catalog/categories/${id}`,
          headers,
          payload: {
            nameRu: "Обновлено",
            nameUz: "Yangilandi",
            slug: "updated",
            sortOrder: 2,
          },
        })
      ).json(),
    ).toMatchObject({
      category: {
        nameRu: "Обновлено",
        nameUz: "Yangilandi",
        slug: "updated",
        sortOrder: 2,
      },
    });
    for (const [action, isActive] of [
      ["deactivate", false],
      ["activate", true],
    ] as const) {
      expect(
        (
          await app.inject({
            method: "POST",
            url: `/admin/catalog/categories/${id}/${action}`,
            headers,
          })
        ).json(),
      ).toMatchObject({ category: { isActive } });
    }
    expect(
      (await app.inject({ url: "/admin/catalog/categories", headers })).json(),
    ).toMatchObject({ categories: [{ id, slug: "updated" }] });
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/admin/catalog/categories",
          headers,
          payload: { ...categoryPayload, slug: "updated" },
        })
      ).statusCode,
    ).toBe(409);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/admin/catalog/categories",
          headers: { cookie: headers.cookie },
          payload: categoryPayload,
        })
      ).statusCode,
    ).toBe(403);
    await app.close();
  });
  it("requires authentication and the configured Telegram admin id", async () => {
    const { app, customerToken } = await createFixture();
    const anonymous = await app.inject({
      method: "POST",
      url: "/admin/catalog/categories",
      payload: categoryPayload,
    });
    const customer = await app.inject({
      method: "POST",
      url: "/admin/catalog/categories",
      headers: { authorization: `Bearer ${customerToken}` },
      payload: categoryPayload,
    });

    expect(anonymous.statusCode).toBe(401);
    expect(customer.statusCode).toBe(403);
    await app.close();
  });

  it("creates, sorts and deactivates categories and maps duplicate slugs to 409", async () => {
    const { app, adminToken } = await createFixture();
    const headers = { authorization: `Bearer ${adminToken}` };
    const created = await app.inject({
      method: "POST",
      url: "/admin/catalog/categories",
      headers,
      payload: categoryPayload,
    });
    const category = created.json<{ category: { id: string } }>().category;
    const updated = await app.inject({
      method: "PATCH",
      url: `/admin/catalog/categories/${category.id}`,
      headers,
      payload: { sortOrder: 1 },
    });
    const deactivated = await app.inject({
      method: "POST",
      url: `/admin/catalog/categories/${category.id}/deactivate`,
      headers,
    });
    const duplicate = await app.inject({
      method: "POST",
      url: "/admin/catalog/categories",
      headers,
      payload: categoryPayload,
    });

    expect(created.statusCode).toBe(201);
    expect(updated.json()).toMatchObject({ category: { sortOrder: 1 } });
    expect(deactivated.json()).toMatchObject({ category: { isActive: false } });
    expect(duplicate.statusCode).toBe(409);
    await app.close();
  });

  it("validates integer UZS product prices and handles product slug uniqueness", async () => {
    const { app, adminToken } = await createFixture();
    const headers = { authorization: `Bearer ${adminToken}` };
    const categoryResponse = await app.inject({
      method: "POST",
      url: "/admin/catalog/categories",
      headers,
      payload: categoryPayload,
    });
    const categoryId = categoryResponse.json<{ category: { id: string } }>()
      .category.id;
    const payload = {
      categoryId,
      nameRu: "Худи Core",
      nameUz: "Core hudi",
      slug: "core-hoodie",
      price: 850000,
      currency: "UZS",
      sourceUrl: "https://example.com/private-source",
    };
    const invalid = await app.inject({
      method: "POST",
      url: "/admin/catalog/products",
      headers,
      payload: { ...payload, price: 850000.5 },
    });
    const created = await app.inject({
      method: "POST",
      url: "/admin/catalog/products",
      headers,
      payload,
    });
    const duplicate = await app.inject({
      method: "POST",
      url: "/admin/catalog/products",
      headers,
      payload,
    });

    expect(invalid.statusCode).toBe(400);
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({
      product: { price: 850000, currency: "UZS", status: "DRAFT" },
    });
    expect(duplicate.statusCode).toBe(409);
    const productId = created.json<{ product: { id: string } }>().product.id;
    expect(created.json().product.sourceUrl).toBe(payload.sourceUrl);
    for (const sourceUrl of [
      "file:///local",
      "ftp://example.com",
      "javascript:alert(1)",
      "not-url",
    ]) {
      expect(
        (
          await app.inject({
            method: "PATCH",
            url: `/admin/catalog/products/${productId}`,
            headers,
            payload: { sourceUrl },
          })
        ).statusCode,
      ).toBe(400);
    }
    expect(
      (
        await app.inject({
          method: "PATCH",
          url: `/admin/catalog/products/${productId}`,
          headers,
          payload: { sourceUrl: null, status: "INACTIVE" },
        })
      ).json(),
    ).toMatchObject({ product: { sourceUrl: null, status: "INACTIVE" } });
    await app.close();
  });

  it("creates extensible size variants with nullable or numeric stock", async () => {
    const { app, adminToken } = await createFixture();
    const headers = { authorization: `Bearer ${adminToken}` };
    const category = await app.inject({
      method: "POST",
      url: "/admin/catalog/categories",
      headers,
      payload: categoryPayload,
    });
    const categoryId = category.json<{ category: { id: string } }>().category
      .id;
    const product = await app.inject({
      method: "POST",
      url: "/admin/catalog/products",
      headers,
      payload: {
        categoryId,
        nameRu: "Худи",
        nameUz: "Hudi",
        slug: "hoodie",
        price: 850000,
      },
    });
    const productId = product.json<{ product: { id: string } }>().product.id;
    const variant = await app.inject({
      method: "POST",
      url: `/admin/catalog/products/${productId}/variants`,
      headers,
      payload: {
        sku: "HD-3XL-BLK",
        size: "3XL Tall",
        color: "Black",
        stock: 4,
      },
    });

    expect(variant.statusCode).toBe(201);
    expect(variant.json()).toMatchObject({
      variant: {
        sku: "HD-3XL-BLK",
        size: "3XL Tall",
        stock: 4,
        isActive: true,
      },
    });
    const variantId = variant.json<{ variant: { id: string } }>().variant.id;
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/admin/catalog/products/${productId}/variants`,
          headers,
          payload: { sku: "HD-3XL-BLK", size: "M" },
        })
      ).statusCode,
    ).toBe(409);
    expect(
      (
        await app.inject({
          method: "PATCH",
          url: `/admin/catalog/variants/${variantId}`,
          headers,
          payload: { stock: 1.5 },
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await app.inject({
          method: "PATCH",
          url: `/admin/catalog/variants/${variantId}`,
          headers,
          payload: { stock: null, color: null, size: "M" },
        })
      ).json(),
    ).toMatchObject({ variant: { stock: null, color: null, size: "M" } });
    await app.close();
  });

  it("allows only administrators to upload validated product images", async () => {
    const { app, adminToken, storageProvider } = await createFixture();
    const file = multipartImage(png, "image/png");
    const anonymous = await app.inject({
      method: "POST",
      url: "/admin/catalog/products/missing/images/upload",
      headers: file.headers,
      payload: file.payload,
    });
    expect(anonymous.statusCode).toBe(401);

    const headers = { authorization: `Bearer ${adminToken}` };
    const category = await app.inject({
      method: "POST",
      url: "/admin/catalog/categories",
      headers,
      payload: categoryPayload,
    });
    const categoryId = category.json<{ category: { id: string } }>().category
      .id;
    const product = await app.inject({
      method: "POST",
      url: "/admin/catalog/products",
      headers,
      payload: {
        categoryId,
        nameRu: "Худи",
        nameUz: "Hudi",
        slug: "hoodie",
        price: 850000,
      },
    });
    const productId = product.json<{ product: { id: string } }>().product.id;
    const uploaded = await app.inject({
      method: "POST",
      url: `/admin/catalog/products/${productId}/images/upload?sortOrder=10`,
      headers: { ...headers, ...file.headers },
      payload: file.payload,
    });

    expect(uploaded.statusCode).toBe(201);
    expect(uploaded.json()).toMatchObject({
      image: {
        productId,
        isPrimary: true,
        sortOrder: 10,
        storageKey: expect.stringMatching(/^products\/[a-f0-9-]+\.png$/),
        url: expect.stringMatching(
          /^http:\/\/localhost:3001\/media\/products\//,
        ),
      },
    });
    expect(storageProvider.files.size).toBe(1);
    await app.close();
  });

  it("rejects unsupported and oversized uploads", async () => {
    const { app, adminToken, storageProvider } = await createFixture();
    const headers = { authorization: `Bearer ${adminToken}` };
    const category = await app.inject({
      method: "POST",
      url: "/admin/catalog/categories",
      headers,
      payload: categoryPayload,
    });
    const categoryId = category.json<{ category: { id: string } }>().category
      .id;
    const product = await app.inject({
      method: "POST",
      url: "/admin/catalog/products",
      headers,
      payload: {
        categoryId,
        nameRu: "Худи",
        nameUz: "Hudi",
        slug: "hoodie",
        price: 850000,
      },
    });
    const productId = product.json<{ product: { id: string } }>().product.id;
    const svg = multipartImage(Buffer.from("<svg></svg>"), "image/svg+xml");
    const large = multipartImage(
      Buffer.concat([png, Buffer.alloc(1024)]),
      "image/png",
    );
    const unsupported = await app.inject({
      method: "POST",
      url: `/admin/catalog/products/${productId}/images/upload`,
      headers: { ...headers, ...svg.headers },
      payload: svg.payload,
    });
    const oversized = await app.inject({
      method: "POST",
      url: `/admin/catalog/products/${productId}/images/upload`,
      headers: { ...headers, ...large.headers },
      payload: large.payload,
    });

    expect(unsupported.statusCode).toBe(415);
    const corrupt = multipartImage(png.subarray(0, 8), "image/png");
    const rejected = await app.inject({
      method: "POST",
      url: `/admin/catalog/products/${productId}/images/upload`,
      headers: { ...headers, ...corrupt.headers },
      payload: corrupt.payload,
    });
    expect(rejected.statusCode).toBe(415);
    expect(storageProvider.files.size).toBe(0);
    expect(oversized.statusCode).toBe(413);
    await app.close();
  });

  it("updates ordering and promotes the next image when primary is deleted", async () => {
    const { app, adminToken, storageProvider } = await createFixture();
    const headers = { authorization: `Bearer ${adminToken}` };
    const category = await app.inject({
      method: "POST",
      url: "/admin/catalog/categories",
      headers,
      payload: categoryPayload,
    });
    const categoryId = category.json<{ category: { id: string } }>().category
      .id;
    const productResponse = await app.inject({
      method: "POST",
      url: "/admin/catalog/products",
      headers,
      payload: {
        categoryId,
        nameRu: "Худи",
        nameUz: "Hudi",
        slug: "hoodie",
        price: 850000,
      },
    });
    const productId = productResponse.json<{ product: { id: string } }>()
      .product.id;
    const file = multipartImage(jpeg, "image/jpeg");
    const first = await app.inject({
      method: "POST",
      url: `/admin/catalog/products/${productId}/images/upload?sortOrder=10`,
      headers: { ...headers, ...file.headers },
      payload: file.payload,
    });
    const second = await app.inject({
      method: "POST",
      url: `/admin/catalog/products/${productId}/images/upload?sortOrder=2`,
      headers: { ...headers, ...file.headers },
      payload: file.payload,
    });
    const secondImage = second.json<{
      image: { id: string; storageKey: string };
    }>().image;
    const promoted = await app.inject({
      method: "PATCH",
      url: `/admin/catalog/images/${secondImage.id}`,
      headers,
      payload: { sortOrder: 1, isPrimary: true },
    });
    const deleted = await app.inject({
      method: "DELETE",
      url: `/admin/catalog/images/${secondImage.id}`,
      headers,
    });
    const product = await app.inject({
      method: "GET",
      url: `/admin/catalog/products/${productId}`,
      headers,
    });

    expect(first.statusCode).toBe(201);
    expect(promoted.json()).toMatchObject({
      image: { sortOrder: 1, isPrimary: true },
    });
    expect(deleted.statusCode).toBe(200);
    expect(storageProvider.deletedKeys).toContain(secondImage.storageKey);
    expect(product.json()).toMatchObject({
      product: { images: [{ isPrimary: true, sortOrder: 10 }] },
    });
    await app.close();
  });
});
