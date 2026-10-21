import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import Fastify, { type FastifyInstance } from "fastify";
import { prisma } from "@stenzo/database";
import { isolatedD1 } from "./helpers/sqlite.js";
import {
  D1OrderRepository,
  D1PaymentRepository,
  D1CartRepository,
  D1UserRepository,
} from "../../api/src/d1/repositories.js";
import { D1TelegramAdminStore } from "../../api/src/d1/telegram-admins.js";
import { D1NotificationDeliveryStore } from "../../api/src/d1/notification-deliveries.js";
import { D1CustomerNotificationDeliveryStore } from "../../api/src/d1/customer-notification-deliveries.js";
import { CheckoutService } from "../../api/src/modules/checkout/service.js";
import { registerCheckoutRoutes } from "../../api/src/modules/checkout/route.js";
import { PaymentService } from "../../api/src/modules/payments/service.js";
import { registerPaymentRoutes } from "../../api/src/modules/payments/route.js";
import { JwtTokenService } from "../../api/src/modules/auth/token.js";
import { UserService } from "../../api/src/modules/users/service.js";
import { NotificationService } from "../../api/src/modules/notifications/service.js";
import { TelegramNotificationProvider } from "../../api/src/modules/notifications/telegram-provider.js";
import { PrivateImageStorageService } from "../../api/src/modules/media/service.js";
import { registerErrorHandler } from "../../api/src/plugins/error-handler.js";
import { png } from "../../api/tests/fixtures/images.js";
import type {
  NotificationDeliveryStore,
  NotificationEvent,
} from "../../api/src/modules/notifications/types.js";

type Mode = "success" | "rejected" | "unconfirmed";
type Fault = "none" | "claim" | "finish";
const customerTable = "CustomerTelegramNotificationDelivery";
const adminTable = "TelegramNotificationDelivery";
const recipient = {
  fullName: "Fixture Buyer",
  phone: "+998900000000",
  city: "Test city",
  address: "Test street 1",
  apartment: null,
  comment: null,
};
const key = "notification-checkout-key-0001";

// Every business record, receipt and Telegram response below is isolated and disposable.
async function fixture(
  run: (f: Awaited<ReturnType<typeof setup>>) => Promise<void>,
  locale: "uz" | "ru" = "uz",
) {
  const db = isolatedD1();
  let app: FastifyInstance | undefined;
  try {
    await db.run(async () => {
      const f = await setup(db, locale);
      app = f.app;
      await run(f);
    });
  } finally {
    await app?.close();
    db.sqlite.close();
  }
}

async function setup(db: ReturnType<typeof isolatedD1>, locale: "uz" | "ru") {
  const { sqlite } = db;
  sqlite.exec(`
    INSERT INTO User(id,telegramId,preferredLocale,languageCode,updatedAt) VALUES('buyer','100','${locale}','${locale === "uz" ? "ru" : "uz"}',1),('admin','101','ru','uz',1);
    INSERT INTO TelegramAdmin(id,telegramId,createdBy,createdAt,updatedAt) VALUES('admin-role','101','isolated-test',1,1);
    INSERT INTO Category(id,nameRu,nameUz,slug,updatedAt) VALUES('category','Test','Sinov','category',1);
    INSERT INTO Product(id,categoryId,nameRu,nameUz,slug,price,status,updatedAt) VALUES('product','category','Test RU','Sinov UZ','product',100001,'ACTIVE',1);
    INSERT INTO ProductVariant(id,productId,sku,size,stock,updatedAt) VALUES('variant','product','TEST-M','M',5,1);
  `);
  await new D1CartRepository().addItem("buyer", {
    productId: "product",
    variantId: "variant",
    quantity: 2,
    heightCm: 180,
    weightKg: 75,
  });
  const modes = { admin: "success" as Mode, customer: "success" as Mode };
  const faults = { admin: "none" as Fault, customer: "none" as Fault };
  const calls: { chat: string; text: string }[] = [],
    logs: unknown[] = [];
  const provider = new TelegramNotificationProvider(
    "123456:" + randomBytes(32).toString("base64url"),
    async (_url, init) => {
      const body =
        init?.body instanceof FormData
          ? {
              chat_id: String(init.body.get("chat_id")),
              text: String(init.body.get("caption")),
            }
          : JSON.parse(String(init?.body));
      calls.push({ chat: body.chat_id, text: body.text });
      const mode = body.chat_id === "101" ? modes.admin : modes.customer;
      if (mode === "rejected")
        return Response.json(
          { ok: false, error_code: 403, description: "sensitive diagnostic" },
          { status: 403 },
        );
      if (mode === "unconfirmed")
        throw new Error("sensitive upstream diagnostic");
      return Response.json({
        ok: true,
        result: {
          message_id: calls.length,
          chat: { id: Number(body.chat_id) },
        },
      });
    },
  );
  const adminStore = new D1NotificationDeliveryStore(),
    customerStore = new D1CustomerNotificationDeliveryStore();
  const wrap = <Event extends NotificationEvent>(
    store: NotificationDeliveryStore<Event>,
    who: "admin" | "customer",
  ): NotificationDeliveryStore<Event> => ({
    async claim(...args) {
      if (faults[who] === "claim") throw Error("storage unavailable");
      return store.claim(...args);
    },
    async finish(...args) {
      if (faults[who] === "finish") throw Error("storage unavailable");
      return store.finish(...args);
    },
  });
  const notifications = new NotificationService(
    provider,
    new D1TelegramAdminStore(),
    {
      error(...args) {
        logs.push(args);
      },
    },
    {
      deliveryStore: wrap(adminStore, "admin"),
      customerDeliveryStore: wrap(customerStore, "customer"),
      adminOrigin: "https://admin.preview.invalid",
    },
  );
  const files = new Map<string, Buffer>();
  let uploads = 0,
    publicId = 0;
  const storage = new PrivateImageStorageService(
    {
      async upload(input) {
        uploads++;
        files.set(input.key, input.data);
      },
      async delete(key) {
        files.delete(key);
      },
      async read(key) {
        return files.get(key)!;
      },
    },
    1024,
  );
  const repo = new D1PaymentRepository();
  const payments = new PaymentService(
    repo,
    storage,
    {
      cardNumber: "LOCAL ONLY",
      cardHolder: "LOCAL ONLY",
      instructionsRu: "Test",
      instructionsUz: "Test",
    },
    notifications,
  );
  const checkoutService = new CheckoutService(
    new D1OrderRepository(),
    () => "STZ-R3-" + ++publicId,
    notifications,
  );
  const tokens = new JwtTokenService(randomBytes(32).toString("hex")),
    users = new UserService(new D1UserRepository());
  const buyerToken = await tokens.issue("buyer"),
    adminToken = await tokens.issue("admin");
  const app = Fastify({ logger: false });
  registerErrorHandler(app);
  app.decorateRequest("currentUser", null);
  registerCheckoutRoutes(app, checkoutService, tokens, users);
  registerPaymentRoutes(
    app,
    payments,
    tokens,
    users,
    tokens,
    users,
    new Set(["101"]),
    1024,
  );
  await app.ready();
  const checkout = async () => {
    const response = await app.inject({
      method: "POST",
      url: "/checkout",
      headers: {
        authorization: "Bearer " + buyerToken,
        "idempotency-key": key,
      },
      payload: recipient,
    });
    assert.equal(response.statusCode, 201, response.body);
    return response.json<{ order: { publicId: string } }>().order;
  };
  const submit = async () => {
    const boundary = "isolated-notification-proof";
    const payload = Buffer.concat([
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="proof.png"\r\nContent-Type: image/png\r\n\r\n`,
      ),
      png,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    const response = await app.inject({
      method: "POST",
      url: "/orders/STZ-R3-1/payments",
      headers: {
        authorization: "Bearer " + buyerToken,
        "idempotency-key": "notification-payment-key-0001",
        "content-type": "multipart/form-data; boundary=" + boundary,
      },
      payload,
    });
    assert.equal(response.statusCode, 201, response.body);
    return response.json<{ payment: { id: string } }>().payment;
  };
  const review = async (id: string, decision: "approve" | "reject") => {
    const response = await app.inject({
      method: "POST",
      url: `/admin/payments/${id}/${decision}`,
      headers: { authorization: "Bearer " + adminToken },
      ...(decision === "reject" ? { payload: { reason: "Test reason" } } : {}),
    });
    assert.equal(response.statusCode, 200, response.body);
  };
  const status = async () => {
    const response = await app.inject({
      method: "PATCH",
      url: "/admin/orders/STZ-R3-1/status",
      headers: { authorization: "Bearer " + adminToken },
      payload: { status: "PURCHASED" },
    });
    assert.equal(response.statusCode, 200, response.body);
  };
  const final = async () => {
    const response = await app.inject({
      method: "POST",
      url: "/admin/orders/STZ-R3-1/request-final-payment",
      headers: { authorization: "Bearer " + adminToken },
      payload: { cargoAmount: 17 },
    });
    assert.equal(response.statusCode, 200, response.body);
  };
  const count = (table: string) =>
    sqlite.prepare(`SELECT count(*) AS n FROM "${table}"`).get()!.n;
  const receipt = (table: string, event: string) =>
    sqlite.prepare(`SELECT * FROM "${table}" WHERE eventType=?`).get(event)!;
  const business = () =>
    ["Order", "Payment", "ProductVariant", "CartItem", "AuditLog"].map(
      (table) => sqlite.prepare(`SELECT * FROM "${table}" ORDER BY id`).all(),
    );
  return {
    app,
    sqlite,
    checkout,
    submit,
    review,
    status,
    final,
    count,
    receipt,
    business,
    modes,
    faults,
    calls,
    logs,
    files,
    uploads: () => uploads,
    notifications,
    customerStore,
    adminStore,
    repo,
    payments,
  };
}

test("checkout SENT receipt dedupes safe concurrent replays without a second Order or stock decrement", async () =>
  fixture(async (f) => {
    await f.checkout();
    assert.equal(f.receipt(adminTable, "order.created").status, "SENT");
    const before = f.business();
    await Promise.all([f.checkout(), f.checkout()]);
    assert.equal(f.calls.length, 1);
    assert.equal(f.count("Order"), 1);
    assert.equal(
      f.sqlite.prepare("SELECT stock FROM ProductVariant").get()!.stock,
      3,
    );
    assert.deepEqual(f.business(), before);
  }));
test("checkout definite FAILED retries once on safe replay after Telegram recovers; business commit survives", async () =>
  fixture(async (f) => {
    f.modes.admin = "rejected";
    await f.checkout();
    assert.equal(f.receipt(adminTable, "order.created").status, "FAILED");
    assert.equal(
      f.receipt(adminTable, "order.created").lastErrorCode,
      "TELEGRAM_REJECTED",
    );
    const before = f.business();
    f.modes.admin = "success";
    await Promise.all([f.checkout(), f.checkout()]);
    await f.checkout();
    assert.equal(f.receipt(adminTable, "order.created").status, "SENT");
    assert.equal(f.calls.length, 2);
    assert.deepEqual(f.business(), before);
    assert.ok(!JSON.stringify(f.logs).includes("sensitive"));
  }));

for (const mode of ["success", "rejected"] as const)
  test(`payment.submitted ${mode}: replay dedupes/retries without another Payment or proof`, async () =>
    fixture(async (f) => {
      await f.checkout();
      f.calls.length = 0;
      f.modes.admin = mode;
      const p = await f.submit();
      assert.equal(
        f.receipt(adminTable, "payment.submitted").status,
        mode === "success" ? "SENT" : "FAILED",
      );
      const before = f.business();
      f.modes.admin = "success";
      const retries = await Promise.all([f.submit(), f.submit()]);
      assert.ok(retries.every((r) => r.id === p.id));
      assert.equal(f.calls.length, mode === "success" ? 1 : 2);
      assert.equal(f.receipt(adminTable, "payment.submitted").status, "SENT");
      assert.equal(f.count("Payment"), 1);
      assert.equal(f.uploads(), 1);
      assert.equal(f.files.size, 1);
      assert.deepEqual(f.business(), before);
    }));

for (const locale of ["uz", "ru"] as const)
  for (const decision of ["approve", "reject"] as const)
    for (const mode of ["success", "rejected"] as const)
      test(`customer ${decision} ${mode} (${locale}): durable retry/dedupe preserves accounting and preferredLocale`, async () =>
        fixture(async (f) => {
          await f.checkout();
          const p = await f.submit();
          f.calls.length = 0;
          f.modes.customer = mode;
          await f.review(p.id, decision);
          const event =
            decision === "approve" ? "payment.approved" : "payment.rejected";
          assert.equal(
            f.receipt(customerTable, event).status,
            mode === "success" ? "SENT" : "FAILED",
          );
          assert.equal(
            f.receipt(customerTable, event).eventKey,
            `${event}:${p.id}`,
          );
          const order = f.sqlite.prepare('SELECT * FROM "Order"').get()!;
          assert.equal(
            order.status,
            decision === "approve"
              ? "AWAITING_PURCHASE"
              : "AWAITING_PREPAYMENT",
          );
          assert.equal(order.paidAmount, decision === "approve" ? 100001 : 0);
          assert.equal(order.remainingAmount, 100001);
          const before = f.business();
          f.modes.customer = "success";
          await Promise.all([
            f.review(p.id, decision),
            f.review(p.id, decision),
          ]);
          await f.review(p.id, decision);
          assert.equal(f.calls.length, mode === "success" ? 1 : 2);
          assert.ok(f.calls.every((c) => c.chat === "100"));
          assert.match(
            f.calls.at(-1)!.text,
            locale === "uz" ? /buyurtmasi/ : /заказ/,
          );
          assert.equal(f.receipt(customerTable, event).status, "SENT");
          assert.equal(f.receipt(customerTable, event).telegramId, "100");
          assert.deepEqual(f.business(), before);
        }, locale));

for (const event of ["status", "final"] as const)
  for (const mode of ["success", "rejected"] as const)
    test(`customer ${event} ${mode}: deterministic durable key and safe recovery`, async () =>
      fixture(async (f) => {
        await f.checkout();
        f.sqlite
          .prepare('UPDATE "Order" SET status=?')
          .run(event === "status" ? "AWAITING_PURCHASE" : "WEIGHING");
        f.calls.length = 0;
        f.modes.customer = mode;
        await f[event]();
        const before = f.business();
        f.modes.customer = "success";
        await f[event]();
        await f[event]();
        const type =
          event === "status"
            ? "order.status_changed"
            : "order.final_payment_requested";
        const orderId = f.sqlite.prepare('SELECT id FROM "Order"').get()!.id;
        assert.equal(
          f.receipt(customerTable, type).eventKey,
          event === "status"
            ? `order.status:${orderId}:PURCHASED`
            : `order.final_payment_requested:${orderId}`,
        );
        assert.equal(f.receipt(customerTable, type).status, "SENT");
        assert.equal(f.calls.length, mode === "success" ? 1 : 2);
        assert.deepEqual(f.business(), before);
      }));

for (const operation of [
  "checkout",
  "submit",
  "approve",
  "reject",
  "status",
  "final",
] as const)
  test(`${operation}: DELIVERY_UNCONFIRMED never auto-retries even after provider recovers`, async () =>
    fixture(async (f) => {
      let paymentId = "";
      if (operation !== "checkout") await f.checkout();
      if (operation === "approve" || operation === "reject")
        paymentId = (await f.submit()).id;
      if (operation === "status" || operation === "final")
        f.sqlite
          .prepare('UPDATE "Order" SET status=?')
          .run(operation === "status" ? "AWAITING_PURCHASE" : "WEIGHING");
      const admin = operation === "checkout" || operation === "submit";
      f.calls.length = 0;
      f.modes[admin ? "admin" : "customer"] = "unconfirmed";
      const perform = () =>
        operation === "approve" || operation === "reject"
          ? f.review(paymentId, operation)
          : f[operation]();
      await perform();
      const before = f.business();
      f.modes.admin = f.modes.customer = "success";
      await perform();
      assert.equal(f.calls.length, 1);
      const table = admin ? adminTable : customerTable;
      const failed = f.sqlite
        .prepare(`SELECT * FROM "${table}" WHERE status='FAILED'`)
        .get()!;
      assert.equal(failed.lastErrorCode, "DELIVERY_UNCONFIRMED");
      assert.deepEqual(f.business(), before);
      assert.ok(!JSON.stringify(f.logs).includes("sensitive"));
    }));

for (const who of ["admin", "customer"] as const)
  for (const stage of ["claim", "finish"] as const)
    test(`${who} receipt ${stage} storage failure: domain succeeds, safe replay respects PENDING`, async () =>
      fixture(async (f) => {
        let paymentId = "";
        if (who === "customer") {
          await f.checkout();
          paymentId = (await f.submit()).id;
        }
        f.calls.length = 0;
        f.faults[who] = stage;
        const perform = () =>
          who === "admin" ? f.checkout() : f.review(paymentId, "approve");
        await perform();
        const before = f.business();
        assert.equal(f.calls.length, stage === "claim" ? 0 : 1);
        f.faults[who] = "none";
        await perform();
        await perform();
        assert.equal(f.calls.length, 1);
        const table = who === "admin" ? adminTable : customerTable;
        assert.equal(
          f.receipt(
            table,
            who === "admin" ? "order.created" : "payment.approved",
          ).status,
          stage === "claim" ? "SENT" : "PENDING",
        );
        assert.deepEqual(f.business(), before);
      }));

test("post-commit notification lookup failure keeps the saved proof; replay recovers without re-upload", async () =>
  fixture(async (f) => {
    await f.checkout();
    f.calls.length = 0;
    const original = f.repo.getOrderForUser.bind(f.repo);
    f.repo.getOrderForUser = async (...args) => {
      if (await prisma.payment.count())
        throw Error("notification lookup unavailable");
      return original(...args);
    };
    const payment = await f.submit();
    assert.equal(f.files.size, 1);
    assert.equal(f.count("Payment"), 1);
    f.repo.getOrderForUser = original;
    assert.equal((await f.submit()).id, payment.id);
    assert.equal(f.files.size, 1);
    assert.equal(f.uploads(), 1);
    assert.equal(f.calls.length, 1);
  }));

test("customer claims use CAS, reject stale completion, and recheck current User eligibility", async () =>
  fixture(async (f) => {
    const claims = await Promise.all([
      f.customerStore.claim("payment.approved:race", "100", "payment.approved"),
      f.customerStore.claim("payment.approved:race", "100", "payment.approved"),
    ]);
    assert.equal(claims.filter(Boolean).length, 1);
    const first = claims.find(Boolean)!;
    await f.customerStore.finish(first, { code: "TELEGRAM_REJECTED" });
    const second = (await f.customerStore.claim(
      "payment.approved:race",
      "100",
      "payment.approved",
    ))!;
    await assert.rejects(
      f.customerStore.finish(first, { messageId: 1 }),
      /not current/,
    );
    await f.customerStore.finish(second, { messageId: 2 });
    assert.equal(
      await f.customerStore.claim(
        "payment.approved:race",
        "100",
        "payment.approved",
      ),
      null,
    );
    f.sqlite.exec("UPDATE User SET status='BLOCKED' WHERE id='buyer'");
    assert.equal(
      await f.customerStore.claim(
        "payment.rejected:blocked",
        "100",
        "payment.rejected",
      ),
      null,
    );
    assert.equal(
      await f.customerStore.claim(
        "payment.rejected:unknown",
        "999",
        "payment.rejected",
      ),
      null,
    );
  }));

test("0007 preserves pre-existing admin receipts and all business rows; only adds notification infrastructure", () => {
  const sqlite = new DatabaseSync(":memory:");
  try {
    for (const name of readdirSync(new URL("../migrations/", import.meta.url))
      .sort()
      .filter((name) => !name.startsWith("0007")))
      sqlite.exec(
        readFileSync(new URL("../migrations/" + name, import.meta.url), "utf8"),
      );
    sqlite.exec(`INSERT INTO User(id,telegramId,updatedAt) VALUES('old-user','123',1);
      INSERT INTO TelegramNotificationDelivery(id,eventKey,telegramId,eventType,status,attemptId,telegramMessageId,createdAt,updatedAt,sentAt)
      VALUES('old-receipt','order.created:old','123','order.created','SENT','old-attempt',777,1,1,1);`);
    const before = ["User", "Order", "Payment", "Product", adminTable].map(
      (table) => sqlite.prepare(`SELECT * FROM "${table}"`).all(),
    );
    sqlite.exec(
      readFileSync(
        new URL(
          "../migrations/0007_customer_notification_deliveries.sql",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    assert.deepEqual(
      ["User", "Order", "Payment", "Product", adminTable].map((table) =>
        sqlite.prepare(`SELECT * FROM "${table}"`).all(),
      ),
      before,
    );
    assert.equal(
      sqlite.prepare(`SELECT count(*) AS n FROM "${customerTable}"`).get()!.n,
      0,
    );
  } finally {
    sqlite.close();
  }
});
