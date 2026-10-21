import { randomUUID, randomBytes } from "node:crypto";
import Fastify from "fastify";
import { expect, it, vi } from "vitest";
import type { Prisma } from "@stenzo/database";
import { PrismaCatalogRepository } from "../src/modules/catalog/repository.js";
import { CatalogService } from "../src/modules/catalog/service.js";
import { registerCatalogRoutes } from "../src/modules/catalog/route.js";
import { PrismaCartRepository } from "../src/modules/cart/repository.js";
import { CartService } from "../src/modules/cart/service.js";
import { registerCartRoutes } from "../src/modules/cart/route.js";
import { JwtTokenService } from "../src/modules/auth/token.js";
import { PrismaUserRepository } from "../src/modules/users/repository.js";
import { UserService } from "../src/modules/users/service.js";
import { healthRoutes } from "../src/modules/health/route.js";
import { registerErrorHandler } from "../src/plugins/error-handler.js";

const state = vi.hoisted(() => ({
  tx: null as Prisma.TransactionClient | null,
}));
vi.mock("@stenzo/database", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@stenzo/database")>();
  return {
    ...actual,
    prisma: new Proxy(actual.prisma, {
      get(target, key) {
        if (state.tx && key === "$transaction")
          return (operation: (tx: Prisma.TransactionClient) => unknown) =>
            operation(state.tx!);
        const selected = state.tx ?? target,
          value = Reflect.get(selected, key);
        return typeof value === "function" ? value.bind(selected) : value;
      },
    }),
  };
});

it.skipIf(process.env.STENZO_TEST_POSTGRES !== "1")(
  "serves real PostgreSQL catalog/readiness and Cart CRUD, validates stock and rolls back fixtures",
  async () => {
    const { prisma } =
      await vi.importActual<typeof import("@stenzo/database")>(
        "@stenzo/database",
      );
    const app = Fastify();
    app.decorateRequest("currentUser", null);
    registerErrorHandler(app);
    void app.register(healthRoutes);
    registerCatalogRoutes(
      app,
      new CatalogService(new PrismaCatalogRepository()),
    );
    const tokens = new JwtTokenService(
      "private-cart-test-secret-at-least-32-characters",
    );
    registerCartRoutes(
      app,
      new CartService(new PrismaCartRepository()),
      tokens,
      new UserService(new PrismaUserRepository()),
    );
    const marker = randomUUID(),
      rollback = new Error("Expected fixture rollback");
    try {
      expect((await app.inject("/health")).statusCode).toBe(200);
      expect((await app.inject("/ready")).statusCode).toBe(200);
      const beforeProducts = await prisma.product.count();
      const categories = await app.inject("/catalog/categories");
      expect(categories.statusCode).toBe(200);
      expect(categories.json().categories.length).toBeGreaterThan(0);
      expect((await app.inject("/catalog/products")).statusCode).toBe(200);
      await expect(
        prisma.$transaction(
          async (tx) => {
            state.tx = tx;
            const user = await tx.user.create({
              data: {
                telegramId: BigInt(`9${randomBytes(6).readUIntBE(0, 6)}`),
              },
            });
            const category = await tx.category.create({
              data: { slug: marker, nameRu: "TEST ONLY", nameUz: "TEST ONLY" },
            });
            const product = await tx.product.create({
              data: {
                categoryId: category.id,
                slug: marker,
                nameRu: marker,
                nameUz: marker,
                price: 850000,
                status: "ACTIVE",
              },
            });
            const variant = await tx.productVariant.create({
              data: { productId: product.id, sku: marker, size: "M", stock: 3 },
            });
            const headers = {
              authorization: `Bearer ${await tokens.issue(user.id)}`,
            };
            expect(
              (
                await app.inject({
                  url: `/catalog/products?category=${marker}&search=${marker}`,
                })
              ).json().products,
            ).toHaveLength(1);
            expect(
              (await app.inject({ url: "/cart", headers })).json().cart.items,
            ).toHaveLength(0);
            const added = await app.inject({
              method: "POST",
              url: "/cart/items",
              headers,
              payload: {
                productId: product.id,
                variantId: variant.id,
                quantity: 1,
              },
            });
            expect(added.statusCode).toBe(201);
            const id = added.json().cart.items[0].id;
            const changed = await app.inject({
              method: "PATCH",
              url: `/cart/items/${id}`,
              headers,
              payload: { quantity: 2, heightCm: 180, weightKg: 75 },
            });
            expect(changed.statusCode).toBe(200);
            expect(changed.json().cart).toMatchObject({
              subtotal: 1700000,
              items: [{ quantity: 2, heightCm: 180, weightKg: 75 }],
            });
            expect(
              (
                await app.inject({
                  method: "PATCH",
                  url: `/cart/items/${id}`,
                  headers,
                  payload: { quantity: 4 },
                })
              ).statusCode,
            ).toBe(409);
            expect(
              (
                await app.inject({
                  method: "DELETE",
                  url: `/cart/items/${id}`,
                  headers,
                })
              ).json().cart.items,
            ).toHaveLength(0);
            await app.inject({
              method: "POST",
              url: "/cart/items",
              headers,
              payload: {
                productId: product.id,
                variantId: variant.id,
                quantity: 1,
              },
            });
            expect(
              (
                await app.inject({ method: "DELETE", url: "/cart", headers })
              ).json().cart.items,
            ).toHaveLength(0);
            throw rollback;
          },
          { timeout: 20000 },
        ),
      ).rejects.toBe(rollback);
      state.tx = null;
      expect(await prisma.product.count()).toBe(beforeProducts);
      expect(
        await prisma.product.findUnique({ where: { slug: marker } }),
      ).toBeNull();
    } finally {
      state.tx = null;
      await app.close();
    }
  },
  30000,
);
