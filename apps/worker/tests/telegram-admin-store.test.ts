import test from "node:test";
import assert from "node:assert/strict";
import { prisma } from "@stenzo/database";
import { D1TelegramAdminStore } from "../../api/src/d1/telegram-admins.js";
import { D1NotificationDeliveryStore } from "../../api/src/d1/notification-deliveries.js";
import { D1UserRepository } from "../../api/src/d1/repositories.js";
import { withAdminPrincipal } from "../../api/src/d1/principal.js";
import { WEB_ADMIN_ACTOR } from "../../api/src/modules/admin/web-session.js";
import { NotificationService } from "../../api/src/modules/notifications/service.js";
import { TelegramDeliveryError } from "../../api/src/modules/notifications/telegram-provider.js";
import type { OrderRecord } from "../../api/src/modules/orders/types.js";
import type { PaymentRecord } from "../../api/src/modules/payments/types.js";
import type { NotificationOptions } from "../../api/src/modules/notifications/types.js";
import { isolatedD1 } from "./helpers/sqlite.js";
import { png } from "../../api/tests/fixtures/images.js";

const order = {
  id: "synthetic-order",
  publicId: "STZ-SYNTHETIC",
  total: 200000,
  requiredPrepayment: 100000,
  remainingAmount: 100000,
  user: {
    telegramId: 100n,
    username: null,
    firstName: "Test",
    lastName: null,
    languageCode: "ru",
    preferredLocale: "uz",
  },
  items: [
    { productNameRu: "Тест", productNameUz: "Sinov", size: "M", quantity: 1 },
  ],
} as OrderRecord;
const payment = {
  id: "synthetic-payment",
  type: "PREPAYMENT",
  expectedAmount: 100000,
} as PaymentRecord;

test("Telegram admins persist canonical IDs, duplicate/invalid rejection and no fabricated User", async () => {
  const f = isolatedD1();
  try {
    await f.run(async () => {
      const store = new D1TelegramAdminStore();
      const row = await withAdminPrincipal("safe-access-principal-hash", () =>
        store.create(WEB_ADMIN_ACTOR, { telegramId: "123", label: "Test" }),
      );
      assert.equal(row.user, null);
      assert.equal(await prisma.user.count(), 0);
      assert.ok(row.isActive && row.notifyNewOrders && row.notifyPayments);
      assert.equal(
        (
          await prisma.telegramAdmin.findUniqueOrThrow({
            where: { id: row.id },
          })
        ).createdBy,
        "safe-access-principal-hash",
      );
      await assert.rejects(
        store.create(WEB_ADMIN_ACTOR, { telegramId: "123" }),
        { statusCode: 409 },
      );
      for (const id of [
        "",
        "0",
        "-1",
        "01",
        " 1",
        "1 ",
        "1.2",
        "1e2",
        "@name",
        "9007199254740992",
      ])
        await assert.rejects(
          store.create(WEB_ADMIN_ACTOR, { telegramId: id }),
          { statusCode: 400 },
        );
      assert.ok(await store.isAdmin("123"));
      await assert.rejects(
        store.update(WEB_ADMIN_ACTOR, "missing", { isActive: false }),
        { statusCode: 404 },
      );
    });
  } finally {
    f.sqlite.close();
  }
});

test("linked User metadata/preferredLocale, soft disable/enable and mutation audits", async () => {
  const f = isolatedD1();
  try {
    await f.run(async () => {
      const store = new D1TelegramAdminStore(),
        users = new D1UserRepository();
      const user = await users.createOrUpdateFromTelegram({
        telegramId: 123n,
        username: "synthetic",
        firstName: "Test",
        languageCode: "uz",
      });
      await users.setPreferredLocale(user.id, "ru");
      const row = await store.create(WEB_ADMIN_ACTOR, { telegramId: "123" });
      assert.equal(row.user?.preferredLocale, "ru");
      await store.update(WEB_ADMIN_ACTOR, row.id, {
        label: "Manager",
        notifyPayments: false,
      });
      await store.disable(WEB_ADMIN_ACTOR, row.id);
      assert.equal(await store.isAdmin("123"), false);
      await store.update(WEB_ADMIN_ACTOR, row.id, { isActive: true });
      assert.ok(await store.isAdmin("123"));
      const audit = await prisma.auditLog.findMany({
        where: { entityId: row.id },
      });
      for (const action of ["created", "updated", "disabled", "enabled"])
        assert.ok(audit.some((a) => a.action === `telegram_admin.${action}`));
      const metadata = audit.find(
        (a) => a.action === "telegram_admin.disabled",
      )!.metadata as Record<string, unknown>;
      assert.equal(metadata.telegramId, "123");
      assert.equal(metadata.isActive, false);
      assert.equal(metadata.notifyPayments, false);
    });
  } finally {
    f.sqlite.close();
  }
});

test("dynamic D1 recipients respect independent flags and locale, immediately without redeploy", async () => {
  const f = isolatedD1();
  try {
    await f.run(async () => {
      const admins = new D1TelegramAdminStore();
      const one = await admins.create(WEB_ADMIN_ACTOR, { telegramId: "101" });
      const two = await admins.create(WEB_ADMIN_ACTOR, { telegramId: "102" });
      const three = await admins.create(WEB_ADMIN_ACTOR, { telegramId: "103" });
      const user = await new D1UserRepository().createOrUpdateFromTelegram({
        telegramId: 102n,
        languageCode: "uz",
      });
      await new D1UserRepository().setPreferredLocale(user.id, "ru");
      await admins.update(WEB_ADMIN_ACTOR, one.id, { notifyNewOrders: false });
      await admins.update(WEB_ADMIN_ACTOR, two.id, { notifyPayments: false });
      await admins.disable(WEB_ADMIN_ACTOR, three.id);
      const calls: {
        id: string;
        text: string;
        options?: NotificationOptions;
        photo?: boolean;
      }[] = [];
      const service = new NotificationService(
        {
          async sendPhoto(id, bytes, mime, caption) {
            assert.deepEqual(bytes, png);
            assert.equal(mime, "image/png");
            calls.push({ id, text: caption, photo: true });
            return { messageId: calls.length };
          },
          async sendText(id, text, options) {
            calls.push({ id, text, options });
            return { messageId: calls.length };
          },
        },
        admins,
        { error() {} },
        {
          deliveryStore: new D1NotificationDeliveryStore(),
          adminOrigin: "https://admin.preview.invalid",
        },
      );
      await service.orderCreated(order);
      assert.deepEqual(
        calls.map((c) => c.id),
        ["102"],
      );
      assert.match(calls[0]!.text, /Новый заказ/);
      assert.equal(
        calls[0]!.options?.button?.url,
        "https://admin.preview.invalid/admin/orders/STZ-SYNTHETIC",
      );
      await service.paymentSubmitted({
        order,
        payment,
        isRetry: false,
        readProof: async () => ({ data: png, mimeType: "image/png" }),
      });
      assert.equal(calls[1]!.id, "101");
      assert.match(calls[1]!.text, /To‘lov tasdig‘i/);
      assert.equal(calls[1]!.photo, true);
      await admins.disable(WEB_ADMIN_ACTOR, two.id);
      await admins.update(WEB_ADMIN_ACTOR, three.id, { isActive: true });
      await service.orderCreated({ ...order, id: "next-order" });
      assert.equal(calls.at(-1)!.id, "103");
      assert.match(calls.at(-1)!.text, /Yangi buyurtma/);
      await service.orderCreated({ ...order, id: "next-order" });
      assert.equal(calls.length, 3);
      const deliveries = await prisma.telegramNotificationDelivery.findMany();
      assert.equal(deliveries.length, 3);
      assert.ok(
        deliveries.every(
          (row) => row.status === "SENT" && row.sentAt && row.telegramMessageId,
        ),
      );
      await service.paymentSubmitted({
        order,
        payment,
        isRetry: false,
        readProof: async () => ({ data: png, mimeType: "image/png" }),
      });
      assert.equal(calls.filter((c) => c.id === "101").length, 1);
    });
  } finally {
    f.sqlite.close();
  }
});

test("durable delivery CAS claims dedupe concurrent events and recheck eligibility", async () => {
  const f = isolatedD1();
  try {
    await f.run(async () => {
      const admins = new D1TelegramAdminStore(),
        store = new D1NotificationDeliveryStore();
      const admin = await admins.create(WEB_ADMIN_ACTOR, { telegramId: "101" });
      const claims = await Promise.all([
        store.claim("order.created:race", "101", "order.created"),
        store.claim("order.created:race", "101", "order.created"),
      ]);
      assert.equal(claims.filter(Boolean).length, 1);
      const claim = claims.find(Boolean)!;
      await store.finish(claim, { messageId: 77 });
      assert.equal(
        await store.claim("order.created:race", "101", "order.created"),
        null,
      );
      await admins.disable(WEB_ADMIN_ACTOR, admin.id);
      assert.equal(
        await store.claim("order.created:disabled", "101", "order.created"),
        null,
      );
      assert.equal(
        await store.claim(
          "payment.submitted:unknown",
          "999",
          "payment.submitted",
        ),
        null,
      );
    });
  } finally {
    f.sqlite.close();
  }
});

for (const mode of [
  "rejected",
  "uncertain",
  "receipt-save-failed",
  "missing-receipt",
] as const)
  test(`notification failure ${mode} is contained with safe retry semantics`, async () => {
    const f = isolatedD1();
    try {
      await f.run(async () => {
        const admins = new D1TelegramAdminStore(),
          store = new D1NotificationDeliveryStore();
        await admins.create(WEB_ADMIN_ACTOR, { telegramId: "101" });
        let calls = 0;
        const logs: unknown[] = [];
        const provider = {
          async sendText() {
            calls++;
            if (mode === "rejected" && calls === 1)
              throw new TelegramDeliveryError("TELEGRAM_REJECTED");
            if (mode === "uncertain")
              throw new Error("sensitive upstream diagnostic");
            if (mode === "missing-receipt") return;
            return { messageId: 99 };
          },
        };
        const deliveryStore =
          mode === "receipt-save-failed"
            ? {
                claim: store.claim.bind(store),
                async finish() {
                  throw new Error("storage down");
                },
              }
            : store;
        const service = new NotificationService(
          provider,
          admins,
          {
            error(...args) {
              logs.push(args);
            },
          },
          { deliveryStore, adminOrigin: "https://admin.preview.invalid" },
        );
        await service.orderCreated(order);
        await service.orderCreated(order);
        assert.equal(calls, mode === "rejected" ? 2 : 1);
        const row = (await prisma.telegramNotificationDelivery.findMany())[0]!;
        assert.equal(
          row.status,
          mode === "rejected"
            ? "SENT"
            : mode === "receipt-save-failed"
              ? "PENDING"
              : "FAILED",
        );
        assert.ok(!JSON.stringify(logs).includes("sensitive"));
      });
    } finally {
      f.sqlite.close();
    }
  });

test("recipient/delivery storage and logger failures never escape notifications", async () => {
  const service = new NotificationService(
    {
      async sendText() {
        throw new Error("must not send");
      },
    },
    {
      async recipients() {
        throw new Error("db down");
      },
    },
    {
      error() {
        throw new Error("logger down");
      },
    },
    {
      deliveryStore: new D1NotificationDeliveryStore(),
      adminOrigin: "https://admin.preview.invalid",
    },
  );
  await service.orderCreated(order);
  await service.paymentSubmitted({
    order,
    payment,
    isRetry: false,
    readProof: async () => ({ data: png, mimeType: "image/png" }),
  });
});
