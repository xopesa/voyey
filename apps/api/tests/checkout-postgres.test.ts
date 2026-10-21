import { randomUUID, randomBytes } from "node:crypto";
import Fastify from "fastify";
import { expect, it, vi } from "vitest";
import type { Prisma } from "@stenzo/database";
import { PrismaOrderRepository } from "../src/modules/orders/repository.js";
import { CheckoutService } from "../src/modules/checkout/service.js";
import { registerCheckoutRoutes } from "../src/modules/checkout/route.js";
import { JwtTokenService } from "../src/modules/auth/token.js";
import { UserService } from "../src/modules/users/service.js";
import { registerErrorHandler } from "../src/plugins/error-handler.js";

// Real repository SQL, private uncommitted fixtures, forced rollback. No bot,
// production HTTP listener, payment or committed demo products/orders.
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
  "Checkout rejects missing metrics, creates real PostgreSQL snapshots at server prices, replays idempotently and rolls back fixtures",
  async () => {
    const { prisma } =
      await vi.importActual<typeof import("@stenzo/database")>(
        "@stenzo/database",
      );
    const marker = `STZ-CHECKOUT-TEST-${randomUUID()}`;
    const rollback = new Error("Expected test rollback");
    const before = {
      products: await prisma.product.count(),
      orders: await prisma.order.count(),
    };
    const app = Fastify();
    app.decorateRequest("currentUser", null);
    registerErrorHandler(app);
    const tokens = new JwtTokenService(
      "checkout-private-test-secret-at-least-32-characters",
    );
    const users = new UserService({
      getById: async (id) =>
        state.tx?.user.findUnique({ where: { id } }) ?? null,
      getByTelegramId: async () => null,
      createOrUpdateFromTelegram: async () => {
        throw Error("Not used");
      },
    });
    registerCheckoutRoutes(
      app,
      new CheckoutService(new PrismaOrderRepository(), () => marker),
      tokens,
      users,
    );
    try {
      await expect(
        prisma.$transaction(
          async (tx) => {
            state.tx = tx;
            const user = await tx.user.create({
              data: {
                telegramId: BigInt(`9${randomBytes(6).readUIntBE(0, 6)}`),
                firstName: "TEST ONLY",
              },
            });
            const category = await tx.category.create({
              data: {
                nameRu: "TEST ONLY",
                nameUz: "TEST ONLY",
                slug: marker.toLowerCase(),
              },
            });
            const product = await tx.product.create({
              data: {
                categoryId: category.id,
                nameRu: "Тестовое худи",
                nameUz: "Test hudi",
                slug: `${marker}-product`.toLowerCase(),
                price: 101,
                status: "ACTIVE",
              },
            });
            const variant = await tx.productVariant.create({
              data: {
                productId: product.id,
                sku: marker,
                size: "L",
                color: "Black",
                stock: 3,
              },
            });
            const cart = await tx.cart.create({
              data: {
                userId: user.id,
                items: {
                  create: {
                    productId: product.id,
                    variantId: variant.id,
                    quantity: 1,
                    heightCm: null,
                    weightKg: 75,
                  },
                },
              },
              include: { items: true },
            });
            const token = await tokens.issue(user.id);
            const request = {
              method: "POST" as const,
              url: "/checkout",
              headers: {
                authorization: `Bearer ${token}`,
                "idempotency-key": "postgres-checkout-test-0001",
              },
              payload: {
                fullName: "Test Recipient",
                phone: "+998 90 123 45 67",
                city: "Test",
                address: "Test address",
                apartment: null,
                comment: null,
              },
            };
            const missing = await app.inject(request);
            expect(missing.statusCode).toBe(409);
            expect(missing.json().error).toContain("requires height");
            expect(await tx.order.count({ where: { userId: user.id } })).toBe(
              0,
            );
            await tx.cartItem.update({
              where: { id: cart.items[0]!.id },
              data: { heightCm: 180 },
            });
            await tx.product.update({
              where: { id: product.id },
              data: { price: 850001 },
            });
            const first = await app.inject(request);
            expect(first.statusCode).toBe(201);
            expect(first.json()).toMatchObject({
              order: {
                publicId: marker,
                total: 850001,
                requiredPrepayment: 425001,
                remainingAmount: 425000,
                paidAmount: 0,
                items: [
                  {
                    heightCm: 180,
                    weightKg: 75,
                    unitPrice: 850001,
                    lineTotal: 850001,
                  },
                ],
              },
            });
            expect(
              await tx.cartItem.count({ where: { cartId: cart.id } }),
            ).toBe(0);
            const replay = await app.inject(request);
            expect(replay.statusCode).toBe(201);
            expect(replay.json().order.publicId).toBe(marker);
            expect(await tx.order.count({ where: { userId: user.id } })).toBe(
              1,
            );
            expect(
              await prisma.order.findUnique({ where: { publicId: marker } }),
            ).toBeNull();
            await tx.product.update({
              where: { id: product.id },
              data: { price: 1, nameRu: "Changed after order" },
            });
            expect(
              await tx.orderItem.findFirst({
                where: { order: { publicId: marker } },
              }),
            ).toMatchObject({
              productNameRu: "Тестовое худи",
              unitPrice: 850001,
              heightCm: 180,
              weightKg: 75,
            });
            throw rollback;
          },
          { timeout: 20000 },
        ),
      ).rejects.toBe(rollback);
    } finally {
      state.tx = null;
      await app.close();
    }
    expect(
      await prisma.order.findUnique({ where: { publicId: marker } }),
    ).toBeNull();
    expect(await prisma.product.count()).toBe(before.products);
    expect(await prisma.order.count()).toBe(before.orders);
  },
);
