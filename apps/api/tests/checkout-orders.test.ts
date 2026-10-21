import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";

import { CheckoutEmptyCartError } from "../src/modules/checkout/errors.js";
import { registerCheckoutRoutes } from "../src/modules/checkout/route.js";
import { CheckoutService } from "../src/modules/checkout/service.js";
import type {
  CartProductRecord,
  CartRecord,
  CartVariantRecord,
} from "../src/modules/cart/types.js";
import type {
  CheckoutResult,
  CheckoutWriteInput,
  OrderRepository,
} from "../src/modules/orders/repository.js";
import { OrderInvalidCursorError } from "../src/modules/orders/errors.js";
import { registerOrderRoutes } from "../src/modules/orders/route.js";
import { OrderService } from "../src/modules/orders/service.js";
import type {
  AdminOrderListQuery,
  OrderItemRecord,
  OrderListQuery,
  OrderListResult,
  OrderRecord,
} from "../src/modules/orders/types.js";
import { JwtTokenService } from "../src/modules/auth/token.js";
import { NotificationService } from "../src/modules/notifications/service.js";
import type {
  NotificationLogger,
  NotificationProvider,
} from "../src/modules/notifications/types.js";
import { createTestUserService, testUsers } from "./helpers/auth.js";

const timestamp = new Date("2026-09-29T00:00:00.000Z");
const jwtSecret = "stenzo-checkout-test-secret-longer-than-32-characters";

function product(): CartProductRecord {
  return {
    id: "product-1",
    nameRu: "Худи Core",
    nameUz: "Core hudi",
    slug: "core-hoodie",
    price: 101,
    currency: "UZS",
    status: "ACTIVE",
    category: { isActive: true },
    images: [
      { url: "https://media.example/core.jpg", isPrimary: true, sortOrder: 0 },
    ],
  };
}

function variant(): CartVariantRecord {
  return {
    id: "variant-1",
    productId: "product-1",
    sku: "CORE-BLK-M",
    size: "M",
    color: "Black",
    stock: 5,
    isActive: true,
  };
}

function cartFor(userId: string): CartRecord {
  const selectedProduct = product();
  const selectedVariant = variant();
  return {
    id: `cart-${userId}`,
    userId,
    createdAt: timestamp,
    updatedAt: timestamp,
    items: [
      {
        id: `item-${userId}`,
        cartId: `cart-${userId}`,
        productId: selectedProduct.id,
        variantId: selectedVariant.id,
        quantity: 1,
        heightCm: 181,
        weightKg: 82,
        createdAt: timestamp,
        updatedAt: timestamp,
        product: selectedProduct,
        variant: selectedVariant,
      },
    ],
  };
}

class MemoryOrderRepository implements OrderRepository {
  public readonly carts = new Map<string, CartRecord>();
  public readonly orders: OrderRecord[] = [];
  public failNextCheckout = false;
  private nextOrderId = 1;

  public checkout(input: CheckoutWriteInput): Promise<CheckoutResult> {
    const existing = this.orders.find(
      (order) =>
        order.userId === input.userId &&
        order.idempotencyKey === input.idempotencyKey,
    );
    if (existing) return Promise.resolve({ order: existing, created: false });
    const cart = this.carts.get(input.userId);
    if (!cart || cart.items.length === 0) throw new CheckoutEmptyCartError();
    const prepared = input.prepare(cart);
    if (this.failNextCheckout) {
      this.failNextCheckout = false;
      throw new Error("simulated transaction failure");
    }
    const sequence = this.nextOrderId++;
    const user = testUsers.find((candidate) => candidate.id === input.userId)!;
    const orderId = `order-${sequence}`;
    const items: OrderItemRecord[] = prepared.items.map((item, index) => ({
      id: `${orderId}-item-${index + 1}`,
      orderId,
      createdAt: new Date(timestamp.getTime() + sequence * 1000),
      ...item,
    }));
    const order: OrderRecord = {
      id: orderId,
      publicId: input.publicId,
      userId: input.userId,
      idempotencyKey: input.idempotencyKey,
      status: "AWAITING_PREPAYMENT",
      ...input.recipient,
      currency: "UZS",
      subtotal: prepared.subtotal,
      total: prepared.total,
      requiredPrepayment: prepared.requiredPrepayment,
      paidAmount: prepared.paidAmount,
      remainingAmount: prepared.remainingAmount,
      cargoAmount: prepared.cargoAmount,
      cargoPaidAmount: prepared.cargoPaidAmount,
      createdAt: new Date(timestamp.getTime() + sequence * 1000),
      updatedAt: new Date(timestamp.getTime() + sequence * 1000),
      items,
      payments: [],
      user: {
        id: user.id,
        telegramId: user.telegramId,
        username: user.username,
        firstName: user.firstName,
        lastName: user.lastName,
        languageCode: user.languageCode,
      },
    };
    this.orders.push(order);
    cart.items = [];
    return Promise.resolve({ order, created: true });
  }

  public listForUser(
    userId: string,
    query: OrderListQuery,
  ): Promise<OrderListResult> {
    return this.list(
      this.orders.filter((order) => order.userId === userId),
      query,
    );
  }

  public getForUser(
    userId: string,
    publicId: string,
  ): Promise<OrderRecord | null> {
    return Promise.resolve(
      this.orders.find(
        (order) => order.userId === userId && order.publicId === publicId,
      ) ?? null,
    );
  }

  public listForAdmin(query: AdminOrderListQuery): Promise<OrderListResult> {
    return this.list(
      this.orders.filter(
        (order) => !query.status || order.status === query.status,
      ),
      query,
    );
  }

  public getForAdmin(publicId: string): Promise<OrderRecord | null> {
    return Promise.resolve(
      this.orders.find((order) => order.publicId === publicId) ?? null,
    );
  }

  private list(
    orders: OrderRecord[],
    query: OrderListQuery,
  ): Promise<OrderListResult> {
    let sorted = [...orders].sort(
      (left, right) => right.createdAt.getTime() - left.createdAt.getTime(),
    );
    if (query.cursor) {
      const index = sorted.findIndex((order) => order.id === query.cursor);
      if (index < 0) throw new OrderInvalidCursorError();
      sorted = sorted.slice(index + 1);
    }
    const visible = sorted.slice(0, query.limit);
    return Promise.resolve({
      orders: visible,
      nextCursor:
        sorted.length > query.limit ? (visible.at(-1)?.id ?? null) : null,
    });
  }
}

class RecordingNotificationProvider implements NotificationProvider {
  public readonly messages: Array<{ chatId: string; text: string }> = [];

  public constructor(private readonly fail = false) {}

  public sendText(chatId: string, text: string): Promise<void> {
    this.messages.push({ chatId, text });
    if (this.fail) {
      return Promise.reject(
        new Error("secret-token payment-proofs/private-file.png"),
      );
    }
    return Promise.resolve();
  }
}

class RecordingNotificationLogger implements NotificationLogger {
  public readonly entries: unknown[] = [];

  public error(message: string, context: unknown): void {
    this.entries.push({ message, context });
  }
}

const recipient = {
  fullName: "Ali Valiyev",
  phone: "+998 90 123 45 67",
  city: "Tashkent",
  address: "Amir Temur 1",
  apartment: "12",
  comment: null,
};

async function createFixture(notificationFailure = false) {
  const app = Fastify();
  app.decorateRequest("currentUser", null);
  const repository = new MemoryOrderRepository();
  const tokenService = new JwtTokenService(jwtSecret);
  const notificationProvider = new RecordingNotificationProvider(
    notificationFailure,
  );
  const notificationLogger = new RecordingNotificationLogger();
  const notifications = new NotificationService(
    notificationProvider,
    new Set(["42"]),
    notificationLogger,
  );
  let nextPublicId = 1;
  const checkoutService = new CheckoutService(
    repository,
    () => `STZ-TEST-${String(nextPublicId++).padStart(6, "0")}`,
    notifications,
  );
  const orderService = new OrderService(repository);
  const userService = createTestUserService();
  registerCheckoutRoutes(app, checkoutService, tokenService, userService);
  registerOrderRoutes(
    app,
    orderService,
    tokenService,
    userService,
    tokenService,
    userService,
    new Set(["42"]),
  );
  return {
    app,
    repository,
    userOneToken: await tokenService.issue("user-1"),
    userTwoToken: await tokenService.issue("user-2"),
    adminToken: await tokenService.issue("admin"),
    notificationProvider,
    notificationLogger,
  };
}

function checkoutRequest(token: string, key: string) {
  return {
    method: "POST" as const,
    url: "/checkout",
    headers: {
      authorization: `Bearer ${token}`,
      "idempotency-key": key,
    },
    payload: recipient,
  };
}

describe("checkout and orders API", () => {
  it("a thrown notification after order commit still returns the committed order", async () => {
    const fixture = await createFixture();
    fixture.repository.carts.set("user-1", cartFor("user-1"));
    const spy = vi
      .spyOn(NotificationService.prototype, "orderCreated")
      .mockRejectedValue(new Error("recipient database unavailable"));
    try {
      const response = await fixture.app.inject(
        checkoutRequest(fixture.userOneToken, "notify-db-unavailable"),
      );
      expect(response.statusCode).toBe(201);
      expect(fixture.repository.orders).toHaveLength(1);
    } finally {
      spy.mockRestore();
      await fixture.app.close();
    }
  });
  it.each([
    { heightCm: null, weightKg: 82 },
    { heightCm: 181, weightKg: null },
    { heightCm: 99, weightKg: 82 },
    { heightCm: 251, weightKg: 82 },
    { heightCm: 180.5, weightKg: 82 },
    { heightCm: 181, weightKg: 29 },
    { heightCm: 181, weightKg: 301 },
    { heightCm: 181, weightKg: 82.5 },
  ])(
    "rejects invalid or missing measurements for any cart position: %j",
    async (measurements) => {
      const { app, repository, userOneToken, notificationProvider } =
        await createFixture();
      const cart = cartFor("user-1");
      const second = {
        ...cart.items[0]!,
        id: "second-position",
        ...measurements,
      };
      cart.items.push(second);
      repository.carts.set("user-1", cart);
      const response = await app.inject(
        checkoutRequest(userOneToken, "invalid-measurements-0001"),
      );
      expect(response.statusCode).toBe(409);
      expect(response.json().message).toContain("requires height");
      expect(repository.orders).toHaveLength(0);
      expect(cart.items).toHaveLength(2);
      expect(notificationProvider.messages).toHaveLength(0);
      await app.close();
    },
  );

  it.each([
    { fullName: " " },
    { phone: "not a phone" },
    { city: "" },
    { address: "a" },
    { fullName: "x".repeat(201) },
    { phone: "1".repeat(25) },
    { city: "x".repeat(101) },
    { address: "x".repeat(501) },
    { apartment: "x".repeat(101) },
    { comment: "x".repeat(1001) },
  ])("rejects invalid recipient fields server-side: %j", async (patch) => {
    const { app, repository, userOneToken } = await createFixture();
    repository.carts.set("user-1", cartFor("user-1"));
    const response = await app.inject({
      ...checkoutRequest(userOneToken, "invalid-recipient-0001"),
      payload: { ...recipient, ...patch },
    });
    expect(response.statusCode).toBe(400);
    expect(repository.orders).toHaveLength(0);
    expect(repository.carts.get("user-1")!.items).toHaveLength(1);
    await app.close();
  });

  it("uses the current server price, snapshots every measurement and supports valid bounds", async () => {
    const { app, repository, userOneToken } = await createFixture();
    const cart = cartFor("user-1");
    cart.items[0]!.product.price = 850001;
    cart.items[0]!.heightCm = 100;
    cart.items[0]!.weightKg = 30;
    cart.items.push({
      ...cart.items[0]!,
      id: "second-item",
      heightCm: 250,
      weightKg: 300,
    });
    repository.carts.set("user-1", cart);
    const request = checkoutRequest(
      userOneToken,
      "current-price-boundary-0001",
    );
    const response = await app.inject(request);
    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      order: {
        total: 1700002,
        requiredPrepayment: 850001,
        remainingAmount: 850001,
        items: [
          { unitPrice: 850001, heightCm: 100, weightKg: 30 },
          { unitPrice: 850001, heightCm: 250, weightKg: 300 },
        ],
      },
    });
    const replay = await app.inject(request);
    expect(replay.statusCode).toBe(201);
    expect(replay.json().order.publicId).toBe(response.json().order.publicId);
    expect(repository.orders).toHaveLength(1);
    await app.close();
  });

  it("rejects an empty cart", async () => {
    const { app, userOneToken } = await createFixture();
    const response = await app.inject(
      checkoutRequest(userOneToken, "empty-cart-key-0001"),
    );

    expect(response.statusCode).toBe(409);
    await app.close();
  });

  it("creates an immutable snapshot, rounds odd prepayment up and clears the cart", async () => {
    const { app, repository, userOneToken, notificationProvider } =
      await createFixture();
    const cart = cartFor("user-1");
    repository.carts.set("user-1", cart);
    const request = checkoutRequest(userOneToken, "checkout-key-user1-0001");
    const first = await app.inject(request);
    const firstOrder = first.json<{ order: { publicId: string } }>().order;

    expect(first.statusCode).toBe(201);
    expect(first.json()).toMatchObject({
      order: {
        publicId: expect.stringMatching(/^STZ-/),
        status: "AWAITING_PREPAYMENT",
        subtotal: 101,
        total: 101,
        requiredPrepayment: 51,
        remainingAmount: 50,
        paidAmount: 0,
        cargoAmount: null,
        items: [
          {
            productNameRu: "Худи Core",
            sku: "CORE-BLK-M",
            unitPrice: 101,
            lineTotal: 101,
            heightCm: 181,
            weightKg: 82,
          },
        ],
      },
    });
    expect(cart.items).toHaveLength(0);

    cart.items = cartFor("user-1").items;
    cart.items[0]!.product.nameRu = "Новое имя";
    cart.items[0]!.product.price = 999;
    const replay = await app.inject(request);
    const details = await app.inject({
      method: "GET",
      url: `/orders/${firstOrder.publicId}`,
      headers: { authorization: `Bearer ${userOneToken}` },
    });
    expect(replay.json()).toMatchObject({
      order: { publicId: firstOrder.publicId },
    });
    expect(repository.orders).toHaveLength(1);
    expect(cart.items).toHaveLength(1);
    expect(notificationProvider.messages).toHaveLength(1);
    expect(notificationProvider.messages[0]).toMatchObject({ chatId: "42" });
    expect(notificationProvider.messages[0]!.text).toContain("Новый заказ");
    expect(notificationProvider.messages[0]!.text).toContain("размер M × 1");
    expect(notificationProvider.messages[0]!.text).toContain("51 UZS");
    expect(details.json()).toMatchObject({
      order: { items: [{ productNameRu: "Худи Core", unitPrice: 101 }] },
    });
    await app.close();
  });

  it("keeps the cart when the atomic checkout transaction fails", async () => {
    const { app, repository, userOneToken, notificationProvider } =
      await createFixture();
    const cart = cartFor("user-1");
    repository.carts.set("user-1", cart);
    repository.failNextCheckout = true;
    const response = await app.inject(
      checkoutRequest(userOneToken, "transaction-fail-0001"),
    );

    expect(response.statusCode).toBe(500);
    expect(cart.items).toHaveLength(1);
    expect(repository.orders).toHaveLength(0);
    expect(notificationProvider.messages).toHaveLength(0);
    await app.close();
  });

  it("does not fail checkout or leak sensitive payload when Telegram fails", async () => {
    const {
      app,
      repository,
      userOneToken,
      notificationProvider,
      notificationLogger,
    } = await createFixture(true);
    repository.carts.set("user-1", cartFor("user-1"));
    const response = await app.inject(
      checkoutRequest(userOneToken, "telegram-failure-0001"),
    );

    expect(response.statusCode).toBe(201);
    expect(repository.orders).toHaveLength(1);
    expect(notificationProvider.messages).toHaveLength(1);
    expect(notificationProvider.messages[0]!.text).not.toContain(
      recipient.address,
    );
    expect(notificationProvider.messages[0]!.text).not.toContain(
      recipient.phone,
    );
    const logged = JSON.stringify(notificationLogger.entries);
    expect(logged).not.toContain("secret-token");
    expect(logged).not.toContain("payment-proofs");
    expect(logged).not.toContain("JWT");
    await app.close();
  });

  it("revalidates current product and variant state during checkout", async () => {
    const { app, repository, userOneToken } = await createFixture();
    const cart = cartFor("user-1");
    cart.items[0]!.variant.isActive = false;
    repository.carts.set("user-1", cart);
    const response = await app.inject(
      checkoutRequest(userOneToken, "inactive-variant-0001"),
    );

    expect(response.statusCode).toBe(409);
    expect(cart.items).toHaveLength(1);
    await app.close();
  });

  it("enforces ownership, paginates orders and protects admin order data", async () => {
    const { app, repository, userOneToken, userTwoToken, adminToken } =
      await createFixture();
    repository.carts.set("user-1", cartFor("user-1"));
    const first = await app.inject(
      checkoutRequest(userOneToken, "pagination-user1-0001"),
    );
    const firstId = first.json<{ order: { publicId: string } }>().order
      .publicId;
    repository.carts.set("user-1", cartFor("user-1"));
    await app.inject(checkoutRequest(userOneToken, "pagination-user1-0002"));
    repository.carts.set("user-2", cartFor("user-2"));
    await app.inject(checkoutRequest(userTwoToken, "pagination-user2-0001"));

    const foreign = await app.inject({
      method: "GET",
      url: `/orders/${firstId}`,
      headers: { authorization: `Bearer ${userTwoToken}` },
    });
    const pageOne = await app.inject({
      method: "GET",
      url: "/orders?limit=1",
      headers: { authorization: `Bearer ${userOneToken}` },
    });
    const cursor = pageOne.json<{ nextCursor: string }>().nextCursor;
    const pageTwo = await app.inject({
      method: "GET",
      url: `/orders?limit=1&cursor=${cursor}`,
      headers: { authorization: `Bearer ${userOneToken}` },
    });
    const customerAdmin = await app.inject({
      method: "GET",
      url: "/admin/orders",
      headers: { authorization: `Bearer ${userOneToken}` },
    });
    const admin = await app.inject({
      method: "GET",
      url: "/admin/orders",
      headers: { authorization: `Bearer ${adminToken}` },
    });

    expect(foreign.statusCode).toBe(404);
    expect(pageOne.json<{ orders: unknown[] }>().orders).toHaveLength(1);
    expect(cursor).toBeTruthy();
    expect(pageTwo.json<{ orders: unknown[] }>().orders).toHaveLength(1);
    expect(customerAdmin.statusCode).toBe(403);
    expect(admin.statusCode).toBe(200);
    const adminOrders = admin.json<{ orders: unknown[] }>().orders;
    expect(adminOrders).toHaveLength(3);
    expect(adminOrders[0]).toMatchObject({
      customer: {
        telegramId: expect.any(String),
        username: expect.any(String),
      },
      recipient: { phone: recipient.phone, address: recipient.address },
    });
    await app.close();
  });
});
