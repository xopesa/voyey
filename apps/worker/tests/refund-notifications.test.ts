import test from "node:test";
import assert from "node:assert/strict";
import { prisma } from "@stenzo/database";
import { financeFixture, payment } from "./helpers/finance.js";
import { LifecycleService } from "../../api/src/modules/admin/lifecycle.js";
import { RefundService } from "../../api/src/modules/admin/refunds.js";
import { NotificationService } from "../../api/src/modules/notifications/service.js";
import { TelegramDeliveryError } from "../../api/src/modules/notifications/telegram-provider.js";
import { D1CustomerNotificationDeliveryStore } from "../../api/src/d1/customer-notification-deliveries.js";
import { FinanceService } from "../../api/src/modules/admin/finance/analytics.js";
import { CustomerService } from "../../api/src/modules/admin/customers.js";
import { WEB_ADMIN_ACTOR } from "../../api/src/modules/admin/web-session.js";
const actor = WEB_ADMIN_ACTOR,
  body = { reason: "OUT_OF_STOCK", note: "INTERNAL-CANCELLATION" },
  now = Date.parse("2026-10-20T12:00:00Z");
for (const locale of ["ru", "uz"] as const)
  test(`durable cancellation/refund ${locale}: localized reason, pending amount, preferredLocale, privacy and SENT dedupe`, async () => {
    const f = financeFixture();
    try {
      await f.run(async () => {
        f.sqlite.prepare("UPDATE User SET preferredLocale=?").run(locale);
        payment(f.sqlite, "pre", "PREPAYMENT", "APPROVED", 145000);
        const sent: { chat: string; text: string }[] = [];
        const n = new NotificationService(
          {
            sendText: async (chat, text) => {
              sent.push({ chat, text });
              return { messageId: sent.length };
            },
          },
          new Set(),
          { error() {} },
          {
            customerDeliveryStore: new D1CustomerNotificationDeliveryStore(),
            refundDeliveryStore:
              new D1CustomerNotificationDeliveryStore<"refund.completed">(
                "CustomerRefundNotificationDelivery",
              ),
          },
        );
        const lifecycle = new LifecycleService(n),
          refunds = new RefundService(n);
        const a = await lifecycle.cancel("STZ-FINANCE", actor, body);
        await lifecycle.cancel("STZ-FINANCE", actor, body);
        assert.equal(sent.length, 1);
        assert.match(
          sent[0]!.text,
          locale === "ru" ? /Заказ.*отменён/ : /bekor qilindi/,
        );
        assert.match(
          sent[0]!.text,
          locale === "ru" ? /Нет в наличии/ : /Mavjud emas/,
        );
        assert.match(sent[0]!.text, /145.?000/);
        assert.equal(sent[0]!.text.includes("INTERNAL"), false);
        await refunds.complete(a.refund!.id, actor, {
          reference: "PRIVATE",
          note: "INTERNAL-REFUND",
        });
        await refunds.complete(a.refund!.id, actor, {});
        assert.equal(sent.length, 2);
        assert.match(
          sent[1]!.text,
          locale === "ru" ? /Возврат.*выполнен/ : /pul qaytarildi/,
        );
        assert.equal(sent[1]!.text.includes("PRIVATE"), false);
        assert.equal(
          (
            await prisma.user.findUniqueOrThrow({
              where: { id: "finance-user" },
            })
          ).preferredLocale,
          locale,
        );
        assert.equal(
          await prisma.customerRefundNotificationDelivery.count({
            where: { status: "SENT" },
          }),
          1,
        );
      });
    } finally {
      f.sqlite.close();
    }
  });
for (const mode of [
  "TELEGRAM_REJECTED",
  "DELIVERY_UNCONFIRMED",
  "STORAGE_FAIL",
] as const)
  test(`refund failure ${mode} cannot roll back domain; only definite rejection retries`, async () => {
    const f = financeFixture();
    try {
      await f.run(async () => {
        payment(f.sqlite, "pre", "PREPAYMENT", "APPROVED", 145000);
        let attempts = 0,
          fail = true;
        const realStore =
          new D1CustomerNotificationDeliveryStore<"refund.completed">(
            "CustomerRefundNotificationDelivery",
          );
        const n = new NotificationService(
          {
            sendText: async () => {
              attempts++;
              if (fail && mode !== "STORAGE_FAIL")
                throw new TelegramDeliveryError(mode);
              return { messageId: 1 };
            },
          },
          new Set(),
          { error() {} },
          {
            refundDeliveryStore:
              mode === "STORAGE_FAIL"
                ? {
                    claim: (...args) => realStore.claim(...args),
                    finish: async (claim, result) => {
                      if (fail) throw Error("isolated storage failure");
                      if ("code" in result) {
                        assert.notEqual(result.code, "PROOF_UNAVAILABLE");
                        return realStore.finish(claim, {
                          code:
                            result.code === "TELEGRAM_REJECTED"
                              ? result.code
                              : "DELIVERY_UNCONFIRMED",
                        });
                      }
                      return realStore.finish(claim, result);
                    },
                  }
                : realStore,
          },
        );
        const a = await new LifecycleService().cancel(
            "STZ-FINANCE",
            actor,
            body,
          ),
          s = new RefundService(n);
        await s.complete(a.refund!.id, actor, {});
        assert.equal(
          (
            await prisma.refund.findUniqueOrThrow({
              where: { id: a.refund!.id },
            })
          ).status,
          "COMPLETED",
        );
        fail = false;
        await s.complete(a.refund!.id, actor, {});
        assert.equal(attempts, mode === "TELEGRAM_REJECTED" ? 2 : 1);
        assert.equal(
          await prisma.auditLog.count({
            where: { action: "refund.completed" },
          }),
          1,
        );
      });
    } finally {
      f.sqlite.close();
    }
  });
test("unpaid cancellation sends no fake refund amount and cancellation delivery failure leaves committed status intact", async () => {
  const f = financeFixture();
  try {
    await f.run(async () => {
      let text = "";
      const n = new NotificationService(
        {
          sendText: async (_chat, t) => {
            text = t;
            throw new TelegramDeliveryError("DELIVERY_UNCONFIRMED");
          },
        },
        new Set(),
        { error() {} },
        { customerDeliveryStore: new D1CustomerNotificationDeliveryStore() },
      );
      const s = new LifecycleService(n);
      await s.cancel("STZ-FINANCE", actor, body);
      assert.equal(text.includes("145"), false);
      assert.equal(text.includes("Qaytariladi"), false);
      assert.equal((await s.state("STZ-FINANCE")).status, "CANCELLED");
      assert.equal(await prisma.refund.count(), 0);
    });
  } finally {
    f.sqlite.close();
  }
});
test("finance keeps approved gross, pending obligation is not outflow; completed refund changes cash once by completion date and customer totals remain separate", async () => {
  const f = financeFixture();
  try {
    await f.run(async () => {
      payment(f.sqlite, "pre", "PREPAYMENT", "APPROVED", 145000, now);
      const a = await new LifecycleService().cancel("STZ-FINANCE", actor, body),
        service = new FinanceService(),
        q = { range: "custom", from: "2026-10-20", to: "2026-10-20" };
      let d = await service.load(q, now);
      assert.equal(d.cash.received, 145000);
      assert.equal(d.cash.refunded, 0);
      assert.equal(d.cash.pendingRefundAmount, 145000);
      assert.equal(d.cash.pendingRefundCount, 1);
      assert.equal(d.cash.cashBeforeProcurement, 145000);
      assert.equal(d.realized.completedOrders, 0);
      const s = new RefundService();
      await s.complete(a.refund!.id, actor, {});
      await s.complete(a.refund!.id, actor, {});
      f.sqlite.prepare("UPDATE Refund SET completedAt=?").run(now);
      d = await service.load(q, now);
      assert.equal(d.cash.received, 145000);
      assert.equal(d.cash.refunded, 145000);
      assert.equal(d.cash.cashBeforeProcurement, 0);
      assert.equal(d.cash.pendingRefundAmount, 0);
      assert.equal(d.chart[0]!.refunds, 145000);
      const card = await new CustomerService().card("finance-user");
      assert.equal(card.approvedPayments, 145000);
      assert.equal(card.refunded, 145000);
      assert.equal(card.pendingRefunds, 0);
      f.sqlite.prepare("UPDATE Refund SET completedAt=?").run(now + 86400000);
      assert.equal((await service.load(q, now)).cash.refunded, 0);
    });
  } finally {
    f.sqlite.close();
  }
});
