import { randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, dirname } from "node:path";
import { hash, argon2id } from "argon2";
import Fastify from "fastify";
import { expect, it, vi } from "vitest";
import type { Prisma } from "@stenzo/database";
import { PrismaAdminCatalogRepository } from "../src/modules/admin/catalog/repository.js";
import { AdminCatalogService } from "../src/modules/admin/catalog/service.js";
import { registerAdminCatalogRoutes } from "../src/modules/admin/catalog/route.js";
import { registerWebAdminAuth } from "../src/modules/admin/web-auth.js";
import { WebAdminSessions } from "../src/modules/admin/web-session.js";
import {
  createAdminGuard,
  registerAdminProtection,
} from "../src/modules/admin/authorization.js";
import { JwtTokenService } from "../src/modules/auth/token.js";
import { PrismaCatalogRepository } from "../src/modules/catalog/repository.js";
import { CatalogService } from "../src/modules/catalog/service.js";
import { registerCatalogRoutes } from "../src/modules/catalog/route.js";
import { ImageStorageService } from "../src/modules/media/service.js";
import { LocalStorageProvider } from "../src/modules/media/local-storage.js";
import { createTestUserService } from "./helpers/auth.js";

// Real repositories share one uncommitted transaction. No fixture becomes visible
// to the running shop; the outer transaction always rolls back, including on failure.
const state = vi.hoisted(() => ({
  tx: null as Prisma.TransactionClient | null,
}));
vi.mock("@stenzo/database", async (importOriginal) => {
  const { config } = await import("dotenv");
  const { fileURLToPath } = await import("node:url");
  config({
    path: fileURLToPath(new URL("../../../.env", import.meta.url)),
    quiet: true,
  });
  const actual = await importOriginal<typeof import("@stenzo/database")>();
  return {
    ...actual,
    prisma: new Proxy(actual.prisma, {
      get(target, key) {
        if (state.tx && key === "$transaction") {
          return (operation: (tx: Prisma.TransactionClient) => unknown) =>
            operation(state.tx!);
        }
        const selected = state.tx ?? target;
        const value = Reflect.get(selected, key);
        return typeof value === "function" ? value.bind(selected) : value;
      },
    }),
  };
});

it.skipIf(process.env.STENZO_TEST_POSTGRES !== "1")(
  "product workflow uses PostgreSQL, web sessions and local storage without committing fixtures",
  async () => {
    const { prisma } =
      await vi.importActual<typeof import("@stenzo/database")>(
        "@stenzo/database",
      );
    const marker = `pm-check-${randomUUID()}`;
    const storagePath = await mkdtemp(
      resolve(tmpdir(), "stenzo-product-test-"),
    );
    const provider = new LocalStorageProvider(
      storagePath,
      "http://localhost:3001/media",
    );
    const app = Fastify();
    const users = createTestUserService();
    const tokens = new JwtTokenService(
      "stenzo-postgres-check-secret-longer-than-32-chars",
    );
    const origin = "http://localhost:3002";
    const password = randomBytes(32).toString("base64url");
    app.decorateRequest("currentUser", null);
    registerWebAdminAuth(
      app,
      new WebAdminSessions(await hash(password, { type: argon2id }), origin),
    );
    registerAdminProtection(
      app,
      createAdminGuard(tokens, users, new Set(["42"])),
    );
    registerAdminCatalogRoutes(
      app,
      new AdminCatalogService(
        new PrismaAdminCatalogRepository(),
        new ImageStorageService(provider, 5242880),
      ),
      tokens,
      users,
      new Set(["42"]),
    );
    registerCatalogRoutes(
      app,
      new CatalogService(new PrismaCatalogRepository()),
    );
    app.get("/admin/future", async () => ({ ok: true }));
    const rollback = new Error("intentional integration rollback");
    try {
      const login = await app.inject({
        method: "POST",
        url: "/admin/auth/login",
        headers: { origin, "x-stenzo-admin": "1" },
        payload: { login: "odilbek_admin", password },
      });
      expect(login.statusCode).toBe(200);
      const headers = {
        cookie: String(login.headers["set-cookie"]).split(";")[0]!,
        origin,
        "x-csrf-token": login.json<{ csrfToken: string }>().csrfToken,
      };
      await prisma
        .$transaction(
          async (tx) => {
            state.tx = tx;
            const categories = await app.inject({
              url: "/admin/catalog/categories",
              headers,
            });
            expect(categories.statusCode).toBe(200);
            const existing = categories.json<{
              categories: { id: string; slug: string; isActive: boolean }[];
            }>().categories;
            expect(existing.length).toBeGreaterThan(0);
            const category = existing.find((item) => item.isActive)!;
            expect(category).toBeDefined();
            expect(
              (await app.inject({ url: "/admin/catalog/products" })).statusCode,
            ).toBe(401);
            expect(
              (await app.inject({ url: "/admin/future", headers })).statusCode,
            ).toBe(403);
            expect(
              (
                await app.inject({
                  url: "/admin/catalog/upload-config",
                  headers,
                })
              ).json(),
            ).toEqual({ maxImageUploadSize: 5242880 });
            const input = {
              nameRu: `Проверка ${marker}`,
              nameUz: `Tekshiruv ${marker}`,
              descriptionRu: "Описание",
              descriptionUz: "Tavsif",
              slug: marker,
              categoryId: category.id,
              price: 850000,
              currency: "UZS",
              sourceUrl: "https://example.com/private-product",
            };
            for (const invalid of [
              { price: 1.5 },
              { price: -1 },
              { currency: "USD" },
              { sourceUrl: "file:///local" },
            ]) {
              expect(
                (
                  await app.inject({
                    method: "POST",
                    url: "/admin/catalog/products",
                    headers,
                    payload: { ...input, ...invalid },
                  })
                ).statusCode,
              ).toBe(400);
            }
            expect(
              (
                await app.inject({
                  method: "POST",
                  url: "/admin/catalog/products",
                  headers: { cookie: headers.cookie, origin },
                  payload: input,
                })
              ).statusCode,
            ).toBe(403);
            const created = await app.inject({
              method: "POST",
              url: "/admin/catalog/products",
              headers,
              payload: input,
            });
            expect(created.statusCode).toBe(201);
            const productId = created.json<{ product: { id: string } }>()
              .product.id;
            const path = `/admin/catalog/products/${productId}`;
            expect(created.json()).toMatchObject({
              product: {
                price: 850000,
                currency: "UZS",
                status: "DRAFT",
                sourceUrl: input.sourceUrl,
              },
            });
            // A separate database connection cannot see this product while under test.
            expect(
              await prisma.product.findUnique({ where: { id: productId } }),
            ).toBeNull();
            expect(
              (await app.inject({ url: `/catalog/products/${marker}` }))
                .statusCode,
            ).toBe(404);
            const updated = await app.inject({
              method: "PATCH",
              url: path,
              headers,
              payload: {
                price: 900000,
                nameUz: `Yangilandi ${marker}`,
                sourceUrl: "http://example.com/updated",
              },
            });
            expect(updated.json()).toMatchObject({
              product: {
                price: 900000,
                sourceUrl: "http://example.com/updated",
              },
            });
            const variant = await app.inject({
              method: "POST",
              url: `${path}/variants`,
              headers,
              payload: {
                size: "XXXL custom",
                color: "Black",
                sku: marker,
                stock: 3,
              },
            });
            expect(variant.statusCode).toBe(201);
            const variantId = variant.json<{ variant: { id: string } }>()
              .variant.id;
            expect(
              (
                await app.inject({
                  method: "PATCH",
                  url: `/admin/catalog/variants/${variantId}`,
                  headers,
                  payload: { size: "XL", color: null, stock: null },
                })
              ).json(),
            ).toMatchObject({
              variant: { size: "XL", stock: null, color: null, sku: marker },
            });
            const png = Buffer.from(
              "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGNoaGgAAAMEAYFL09IQAAAAAElFTkSuQmCC",
              "base64",
            );
            const boundary = "stenzo-integration-boundary";
            const payload = Buffer.concat([
              Buffer.from(
                `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="photo.png"\r\nContent-Type: image/png\r\n\r\n`,
              ),
              png,
              Buffer.from(`\r\n--${boundary}--\r\n`),
            ]);
            const uploadHeaders = {
              ...headers,
              "content-type": `multipart/form-data; boundary=${boundary}`,
            };
            expect(
              (
                await app.inject({
                  method: "POST",
                  url: `${path}/images/upload`,
                  headers: { ...uploadHeaders, "x-csrf-token": "wrong" },
                  payload,
                })
              ).statusCode,
            ).toBe(403);
            const images = [] as { id: string; storageKey: string }[];
            for (const sortOrder of [5, 2]) {
              const uploaded = await app.inject({
                method: "POST",
                url: `${path}/images/upload?sortOrder=${sortOrder}`,
                headers: uploadHeaders,
                payload,
              });
              expect(uploaded.statusCode).toBe(201);
              const image = uploaded.json<{
                image: { id: string; storageKey: string };
              }>().image;
              expect(await provider.read(image.storageKey)).toEqual(png);
              images.push(image);
            }
            expect(
              (
                await app.inject({
                  method: "PATCH",
                  url: `/admin/catalog/images/${images[1]!.id}`,
                  headers,
                  payload: { isPrimary: true, sortOrder: 0 },
                })
              ).statusCode,
            ).toBe(200);
            expect(
              (
                await app.inject({
                  method: "POST",
                  url: `${path}/activate`,
                  headers,
                })
              ).statusCode,
            ).toBe(200);
            const publicProduct = await app.inject({
              url: `/catalog/products/${marker}`,
            });
            expect(publicProduct.statusCode).toBe(200);
            expect(publicProduct.json()).toMatchObject({
              product: {
                price: 900000,
                currency: "UZS",
                availableSizes: ["XL"],
                images: [
                  { id: images[1]!.id, isPrimary: true, sortOrder: 0 },
                  { id: images[0]!.id },
                ],
              },
            });
            expect(publicProduct.json().product).not.toHaveProperty(
              "sourceUrl",
            );
            const publicList = await app.inject({
              url: `/catalog/products?search=${marker}`,
            });
            expect(publicList.json().products).toHaveLength(1);
            expect(publicList.json().products[0]).not.toHaveProperty(
              "sourceUrl",
            );
            const filtered = await app.inject({
              url: `/admin/catalog/products?search=${marker}&category=${category.slug}&status=ACTIVE`,
              headers,
            });
            expect(filtered.json().products).toHaveLength(1);
            expect(
              (
                await app.inject({
                  method: "POST",
                  url: `/admin/catalog/variants/${variantId}/deactivate`,
                  headers,
                })
              ).statusCode,
            ).toBe(200);
            expect(
              (await app.inject({ url: `/catalog/products/${marker}` })).json()
                .product.availableSizes,
            ).toEqual([]);
            expect(
              (
                await app.inject({
                  method: "POST",
                  url: `/admin/catalog/variants/${variantId}/activate`,
                  headers,
                })
              ).statusCode,
            ).toBe(200);
            expect(
              (
                await app.inject({
                  method: "DELETE",
                  url: `/admin/catalog/images/${images[1]!.id}`,
                  headers,
                })
              ).statusCode,
            ).toBe(200);
            await expect(
              provider.read(images[1]!.storageKey),
            ).rejects.toThrow();
            expect(
              (await app.inject({ url: path, headers })).json().product.images,
            ).toMatchObject([{ id: images[0]!.id, isPrimary: true }]);
            expect(
              (
                await app.inject({
                  method: "PATCH",
                  url: path,
                  headers,
                  payload: { status: "DRAFT", sourceUrl: null },
                })
              ).json(),
            ).toMatchObject({ product: { status: "DRAFT", sourceUrl: null } });
            expect(
              (
                await app.inject({
                  method: "POST",
                  url: `${path}/deactivate`,
                  headers,
                })
              ).statusCode,
            ).toBe(200);
            expect(
              (await app.inject({ url: `/catalog/products/${marker}` }))
                .statusCode,
            ).toBe(404);
            const audit = await tx.auditLog.findFirst({
              where: { entityId: productId },
            });
            expect(audit).toMatchObject({
              actorId: null,
              metadata: {
                authType: "web-admin",
                adminPrincipal: "odilbek_admin",
              },
            });
            expect(
              (
                await app.inject({
                  method: "POST",
                  url: "/admin/auth/logout",
                  headers,
                })
              ).statusCode,
            ).toBe(200);
            expect((await app.inject({ url: path, headers })).statusCode).toBe(
              401,
            );
            throw rollback;
          },
          { timeout: 30000 },
        )
        .catch((error: unknown) => {
          if (error !== rollback) throw error;
        });
      state.tx = null;
      expect(
        await prisma.product.findUnique({ where: { slug: marker } }),
      ).toBeNull();
    } finally {
      state.tx = null;
      await app.close();
      await prisma.$disconnect();
      if (
        dirname(storagePath) === resolve(tmpdir()) &&
        storagePath.startsWith(resolve(tmpdir(), "stenzo-product-test-"))
      ) {
        await rm(storagePath, { recursive: true, force: true });
      }
    }
  },
  45000,
);
