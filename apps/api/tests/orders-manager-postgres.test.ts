import { randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { hash, argon2id } from "argon2";
import Fastify from "fastify";
import { expect, it, vi } from "vitest";
import type { Prisma } from "@stenzo/database";
import { registerWebAdminAuth } from "../src/modules/admin/web-auth.js";
import { WebAdminSessions } from "../src/modules/admin/web-session.js";
import {
  createAdminGuard,
  registerAdminProtection,
} from "../src/modules/admin/authorization.js";
import { JwtTokenService } from "../src/modules/auth/token.js";
import { PrismaOrderRepository } from "../src/modules/orders/repository.js";
import { OrderService } from "../src/modules/orders/service.js";
import { registerOrderRoutes } from "../src/modules/orders/route.js";
import { PrismaPaymentRepository } from "../src/modules/payments/repository.js";
import { PaymentService } from "../src/modules/payments/service.js";
import { registerPaymentRoutes } from "../src/modules/payments/route.js";
import { LocalFileStorageProvider } from "../src/modules/media/local-storage.js";
import { PrivateImageStorageService } from "../src/modules/media/service.js";
import { NotificationService } from "../src/modules/notifications/service.js";
import { UserService } from "../src/modules/users/service.js";
import type { UserRecord } from "../src/modules/users/types.js";

// Production repositories run real SQL in a private outer transaction. Fixtures
// are never committed or visible to the shop. Telegram provider is memory-only.
const state = vi.hoisted(() => ({
  tx: null as Prisma.TransactionClient | null,
}));
const browserCheck = process.env.STENZO_ORDERS_UI_TEST === "1";
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
        const selected = state.tx ?? target;
        const value = Reflect.get(selected, key);
        return typeof value === "function" ? value.bind(selected) : value;
      },
    }),
  };
});

it.skipIf(process.env.STENZO_TEST_POSTGRES !== "1")(
  "web Orders Manager reviews private proofs, follows payment policy and records notifications with PostgreSQL rollback",
  async () => {
    const { prisma } =
      await vi.importActual<typeof import("@stenzo/database")>(
        "@stenzo/database",
      );
    const marker = `STZ-TEST-${randomUUID()}`;
    const root = await mkdtemp(resolve(tmpdir(), "stenzo-orders-test-"));
    const provider = new LocalFileStorageProvider(root);
    const app = Fastify();
    const origin = browserCheck
      ? "http://127.0.0.1:3102"
      : "http://localhost:3002";
    let bootstrapCookie = "";
    let finishBrowser: (() => void) | undefined;
    let submitBrowserProof: (() => Promise<string>) | undefined;
    const password = randomBytes(32).toString("base64url");
    const users = new Map<string, UserRecord>();
    const userService = new UserService({
      getById: async (id) => users.get(id) ?? null,
      getByTelegramId: async (id) =>
        [...users.values()].find((user) => user.telegramId === id) ?? null,
      createOrUpdateFromTelegram: async () => {
        throw new Error("Not used");
      },
    });
    const tokens = new JwtTokenService(
      "orders-manager-test-secret-at-least-32-characters",
    );
    const messages: { chatId: string; text: string }[] = [];
    const notifications = new NotificationService(
      {
        sendText: async (chatId, text) => {
          messages.push({ chatId, text });
        },
      },
      new Set(["42"]),
    );
    app.decorateRequest("currentUser", null);
    registerWebAdminAuth(
      app,
      new WebAdminSessions(await hash(password, { type: argon2id }), origin),
    );
    registerAdminProtection(
      app,
      createAdminGuard(tokens, userService, new Set(["42"])),
    );
    registerOrderRoutes(
      app,
      new OrderService(new PrismaOrderRepository()),
      tokens,
      userService,
      tokens,
      userService,
      new Set(["42"]),
    );
    registerPaymentRoutes(
      app,
      new PaymentService(
        new PrismaPaymentRepository(),
        new PrivateImageStorageService(provider, 5242880),
        {
          cardNumber: "test",
          cardHolder: "test",
          instructionsRu: "test",
          instructionsUz: "test",
        },
        notifications,
      ),
      tokens,
      userService,
      tokens,
      userService,
      new Set(["42"]),
      5242880,
    );
    const rollback = new Error("intentional orders integration rollback");
    if (browserCheck) {
      // Test-only loopback harness. No credential is printed or persisted.
      app.get("/__test/bootstrap", async (_request, reply) =>
        reply
          .header("set-cookie", bootstrapCookie)
          .redirect(`${origin}/orders/${marker}`),
      );
      app.post("/__test/submit", async (request, reply) => {
        if (request.headers["x-fixture-control"] !== "1" || !submitBrowserProof)
          return reply.status(403).send({ error: "Test control unavailable" });
        return { id: await submitBrowserProof() };
      });
      app.post("/__test/finish", async (request, reply) => {
        if (request.headers["x-fixture-control"] !== "1")
          return reply.status(403).send({ error: "Test control unavailable" });
        finishBrowser?.();
        return { ok: true };
      });
    }
    try {
      const login = await app.inject({
        method: "POST",
        url: "/admin/auth/login",
        headers: { origin, "x-stenzo-admin": "1" },
        payload: { login: "voyey_admin", password },
      });
      expect(login.statusCode).toBe(200);
      bootstrapCookie = String(login.headers["set-cookie"]);
      const headers = {
        cookie: String(login.headers["set-cookie"]).split(";")[0]!,
        origin,
        "x-csrf-token": login.json<{ csrfToken: string }>().csrfToken,
      };
      await prisma
        .$transaction(
          async (tx) => {
            state.tx = tx;
            const customer = await tx.user.create({
              data: {
                telegramId: BigInt(`0x${randomBytes(6).toString("hex")}`),
                firstName: "Test",
                lastName: "Customer",
                username: "test_customer",
                languageCode: "uz",
              },
            });
            users.set(customer.id, customer);
            users.set("other-customer", {
              ...customer,
              id: "other-customer",
              telegramId: customer.telegramId + 1n,
            });
            const owner = {
              authorization: `Bearer ${await tokens.issue(customer.id)}`,
            };
            const other = {
              authorization: `Bearer ${await tokens.issue("other-customer")}`,
            };
            const category = await tx.category.findFirstOrThrow();
            const product = await tx.product.create({
              data: {
                categoryId: category.id,
                nameRu: "Текущее имя",
                nameUz: "Hozirgi nom",
                slug: marker.toLowerCase(),
                price: 999999,
                sourceUrl: "https://example.com/private-procurement",
              },
            });
            const order = await tx.order.create({
              data: {
                publicId: marker,
                userId: customer.id,
                idempotencyKey: marker,
                fullName: "Test Customer",
                phone: "+998900000000",
                city: "Test",
                address: "Test address",
                comment: "Test comment",
                total: 1150001,
                subtotal: 1150001,
                requiredPrepayment: 575001,
                remainingAmount: 575000,
                items: {
                  create: [
                    {
                      productId: product.id,
                      productNameRu: "Снимок худи",
                      productNameUz: "Hudi nusxasi",
                      productSlug: product.slug,
                      imageUrl: "https://example.com/snapshot.png",
                      sku: "SNAP-XL",
                      size: "XL",
                      color: "Black",
                      quantity: 1,
                      unitPrice: 850001,
                      lineTotal: 850001,
                      heightCm: 182,
                      weightKg: 79,
                    },
                    {
                      productNameRu: "Снимок футболки",
                      productNameUz: "Futbolka nusxasi",
                      productSlug: "deleted-product",
                      sku: "SNAP-M",
                      size: "M",
                      quantity: 2,
                      unitPrice: 150000,
                      lineTotal: 300000,
                      heightCm: 168,
                      weightKg: 59,
                    },
                  ],
                },
              },
            });
            const originalItems = await tx.orderItem.findMany({
              where: { orderId: order.id },
              orderBy: { id: "asc" },
            });
            const orderPath = `/admin/orders/${marker}`;
            expect(
              await prisma.order.findUnique({ where: { publicId: marker } }),
            ).toBeNull();
            for (const url of [
              "/admin/orders",
              orderPath,
              "/admin/payments",
              "/admin/payments/missing/proof",
            ]) {
              expect((await app.inject({ url })).statusCode).toBe(401);
              expect(
                (await app.inject({ url, headers: other })).statusCode,
              ).toBe(403);
            }
            expect(
              (await app.inject({ url: `/orders/${marker}`, headers: other }))
                .statusCode,
            ).toBe(404);
            expect(
              (await app.inject({ url: `/orders/${marker}`, headers }))
                .statusCode,
            ).toBe(401);
            const publicOrder = await app.inject({
              url: `/orders/${marker}`,
              headers: owner,
            });
            expect(publicOrder.statusCode).toBe(200);
            expect(publicOrder.json().order.items[0]).not.toHaveProperty(
              "sourceUrl",
            );
            expect(publicOrder.json().order).not.toHaveProperty("nextStatus");
            const detail = await app.inject({ url: orderPath, headers });
            expect(detail.statusCode).toBe(200);
            expect(detail.json().order.items).toEqual(
              expect.arrayContaining([
                expect.objectContaining({
                  productNameRu: "Снимок худи",
                  unitPrice: 850001,
                  heightCm: 182,
                  weightKg: 79,
                  sourceUrl: product.sourceUrl,
                }),
                expect.objectContaining({
                  heightCm: 168,
                  weightKg: 59,
                  sourceUrl: null,
                }),
              ]),
            );
            expect(detail.json().order.nextStatus).toBeNull();
            expect(
              (
                await app.inject({
                  url: `/admin/orders?status=AWAITING_PREPAYMENT&search=${marker.toLowerCase()}`,
                  headers,
                })
              ).json().orders,
            ).toHaveLength(1);
            expect(
              (
                await app.inject({
                  url: `/admin/orders?status=COMPLETED&search=${marker}`,
                  headers,
                })
              ).json().orders,
            ).toHaveLength(0);
            const proof = Buffer.from(
              "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGNoaGgAAAMEAYFL09IQAAAAAElFTkSuQmCC",
              "base64",
            );
            const boundary = "orders-proof-boundary";
            const payload = Buffer.concat([
              Buffer.from(
                `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="proof.png"\r\nContent-Type: image/png\r\n\r\n`,
              ),
              proof,
              Buffer.from(`\r\n--${boundary}--\r\n`),
            ]);
            async function submit(key: string) {
              const result = await app.inject({
                method: "POST",
                url: `/orders/${marker}/payments`,
                headers: {
                  ...owner,
                  "idempotency-key": key,
                  "content-type": `multipart/form-data; boundary=${boundary}`,
                },
                payload,
              });
              expect(result.statusCode).toBe(201);
              return result.json<{ payment: { id: string } }>().payment.id;
            }
            const firstId = await submit(`first-${marker}`);
            if (browserCheck) {
              submitBrowserProof = () => submit(`browser-${randomUUID()}`);
              const finished = new Promise<void>((resolve) => {
                finishBrowser = resolve;
              });
              await app.listen({ port: 3103, host: "127.0.0.1" });
              await finished;
              expect(
                (await tx.order.findUniqueOrThrow({ where: { id: order.id } }))
                  .status,
              ).toBe("COMPLETED");
              expect(
                await tx.orderItem.findMany({
                  where: { orderId: order.id },
                  orderBy: { id: "asc" },
                }),
              ).toEqual(originalItems);
              expect(messages.length).toBeGreaterThan(0);
              throw rollback;
            }
            const firstPath = `/admin/payments/${firstId}`;
            const pending = await app.inject({
              url: "/admin/payments?status=SUBMITTED",
              headers,
            });
            expect(pending.json().payments).toEqual(
              expect.arrayContaining([
                expect.objectContaining({
                  id: firstId,
                  expectedAmount: 575001,
                }),
              ]),
            );
            const proofRead = await app.inject({
              url: `${firstPath}/proof`,
              headers,
            });
            expect(proofRead.statusCode).toBe(200);
            expect(proofRead.headers["cache-control"]).toContain("no-store");
            expect(proofRead.rawPayload).toEqual(proof);
            expect(
              (await app.inject({ url: `${firstPath}/proof`, headers: owner }))
                .statusCode,
            ).toBe(403);
            expect(
              (
                await app.inject({
                  url: `/media/payment-proofs/${firstId}.png`,
                })
              ).statusCode,
            ).toBe(404);
            expect(
              (await app.inject({ url: firstPath, headers })).json().payment,
            ).not.toHaveProperty("proofStorageKey");
            for (const path of [
              `${firstPath}/approve`,
              `${firstPath}/reject`,
              `${orderPath}/request-final-payment`,
            ]) {
              expect(
                (
                  await app.inject({
                    method: "POST",
                    url: path,
                    headers: { cookie: headers.cookie, origin },
                    payload: {},
                  })
                ).statusCode,
              ).toBe(403);
              expect(
                (
                  await app.inject({
                    method: "POST",
                    url: path,
                    headers: { ...headers, origin: "https://evil.test" },
                    payload: {},
                  })
                ).statusCode,
              ).toBe(403);
            }
            expect(
              (
                await app.inject({
                  method: "PATCH",
                  url: `${orderPath}/status`,
                  headers: { cookie: headers.cookie, origin },
                  payload: { status: "PURCHASED" },
                })
              ).statusCode,
            ).toBe(403);
            const rejected = await app.inject({
              method: "POST",
              url: `${firstPath}/reject`,
              headers,
              payload: { reason: "Сумма не поступила" },
            });
            expect(rejected.statusCode).toBe(200);
            expect(rejected.json().payment.rejectionReason).toBe(
              "Сумма не поступила",
            );
            expect(
              (
                await app.inject({
                  method: "POST",
                  url: `${firstPath}/approve`,
                  headers,
                })
              ).statusCode,
            ).toBe(409);
            const retryId = await submit(`retry-${marker}`);
            const retryPath = `/admin/payments/${retryId}`;
            const approval = await app.inject({
              method: "POST",
              url: `${retryPath}/approve`,
              headers,
            });
            expect(approval.statusCode).toBe(200);
            expect(approval.json().payment.order).toMatchObject({
              status: "AWAITING_PURCHASE",
              nextStatus: "PURCHASED",
              finance: {
                confirmedPrepayment: 575001,
                remainingProducts: 575000,
              },
            });
            const beforeRepeat = messages.length;
            expect(
              (
                await app.inject({
                  method: "POST",
                  url: `${retryPath}/approve`,
                  headers,
                })
              ).statusCode,
            ).toBe(200);
            expect(messages).toHaveLength(beforeRepeat);
            expect(
              (await tx.payment.findUniqueOrThrow({ where: { id: retryId } }))
                .reviewedByUserId,
            ).toBeNull();
            expect(
              (
                await app.inject({
                  method: "PATCH",
                  url: `${orderPath}/status`,
                  headers,
                  payload: { status: "PAID_FULL" },
                })
              ).statusCode,
            ).toBe(409);
            expect(
              (
                await app.inject({
                  method: "POST",
                  url: `${orderPath}/request-final-payment`,
                  headers,
                  payload: { cargoAmount: 65000 },
                })
              ).statusCode,
            ).toBe(409);
            for (const status of [
              "PURCHASED",
              "IN_TRANSIT",
              "ARRIVED",
              "WEIGHING",
            ]) {
              expect(
                (
                  await app.inject({
                    method: "PATCH",
                    url: `${orderPath}/status`,
                    headers,
                    payload: { status },
                  })
                ).statusCode,
              ).toBe(200);
            }
            expect(
              (await app.inject({ url: orderPath, headers })).json().order,
            ).toMatchObject({ nextStatus: null, canRequestFinalPayment: true });
            for (const cargoAmount of [-1, 1.5, 2147483647, 2147483648])
              expect(
                (
                  await app.inject({
                    method: "POST",
                    url: `${orderPath}/request-final-payment`,
                    headers,
                    payload: { cargoAmount },
                  })
                ).statusCode,
              ).toBe(400);
            const cargo = await app.inject({
              method: "POST",
              url: `${orderPath}/request-final-payment`,
              headers,
              payload: { cargoAmount: 65000 },
            });
            expect(cargo.statusCode).toBe(200);
            expect(cargo.json().order).toMatchObject({
              status: "AWAITING_FINAL_PAYMENT",
              cargoAmount: 65000,
              payment: { amountDue: 640000 },
              finance: { finalPaymentTotal: 640000 },
            });
            const beforeCargoRepeat = messages.length;
            expect(
              (
                await app.inject({
                  method: "POST",
                  url: `${orderPath}/request-final-payment`,
                  headers,
                  payload: { cargoAmount: 65000 },
                })
              ).statusCode,
            ).toBe(200);
            expect(messages).toHaveLength(beforeCargoRepeat);
            const finalId = await submit(`final-${marker}`);
            expect(
              (
                await app.inject({ url: `/admin/payments/${finalId}`, headers })
              ).json().payment,
            ).toMatchObject({
              type: "FINAL",
              expectedAmount: 640000,
              status: "SUBMITTED",
            });
            expect(
              (
                await app.inject({
                  method: "POST",
                  url: `/admin/payments/${finalId}/approve`,
                  headers,
                })
              ).json().payment.order,
            ).toMatchObject({
              status: "PAID_FULL",
              nextStatus: "READY_TO_SHIP",
              remainingAmount: 0,
              finance: { finalPaymentTotal: 640000 },
            });
            for (const status of ["READY_TO_SHIP", "SHIPPED", "COMPLETED"])
              expect(
                (
                  await app.inject({
                    method: "PATCH",
                    url: `${orderPath}/status`,
                    headers,
                    payload: { status },
                  })
                ).statusCode,
              ).toBe(200);
            expect(
              (await app.inject({ url: orderPath, headers })).json().order
                .nextStatus,
            ).toBeNull();
            expect(
              await tx.orderItem.findMany({
                where: { orderId: order.id },
                orderBy: { id: "asc" },
              }),
            ).toEqual(originalItems);
            const audit = await tx.auditLog.findFirst({
              where: { entityId: retryId, action: "payment.approved" },
            });
            expect(audit).toMatchObject({
              actorId: null,
              metadata: {
                adminPrincipal: "voyey_admin",
                authType: "web-admin",
              },
            });
            expect(
              messages.some(
                (message) => message.chatId === customer.telegramId.toString(),
              ),
            ).toBe(true);
            expect(
              messages.some((message) => message.text.includes("640")),
            ).toBe(true);
            expect(
              (
                await app.inject({
                  method: "POST",
                  url: "/admin/auth/logout",
                  headers,
                })
              ).statusCode,
            ).toBe(200);
            expect(
              (await app.inject({ url: `${firstPath}/proof`, headers }))
                .statusCode,
            ).toBe(401);
            throw rollback;
          },
          { timeout: browserCheck ? 600000 : 45000 },
        )
        .catch((error: unknown) => {
          if (error !== rollback) throw error;
        });
      state.tx = null;
      expect(
        await prisma.order.findUnique({ where: { publicId: marker } }),
      ).toBeNull();
    } finally {
      state.tx = null;
      await app.close();
      await prisma.$disconnect();
      if (
        dirname(root) === resolve(tmpdir()) &&
        root.startsWith(resolve(tmpdir(), "stenzo-orders-test-"))
      )
        await rm(root, { recursive: true, force: true });
    }
  },
  browserCheck ? 630000 : 60000,
);
