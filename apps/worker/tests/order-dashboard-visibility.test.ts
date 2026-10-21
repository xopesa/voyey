import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { prisma } from "@stenzo/database";
import { financeFixture, financeSeed, payment } from "./helpers/finance.js";
import { marketingRuntime } from "./helpers/marketing-runtime.js";
import { runtimeUser } from "./helpers/customer-operations.js";
import { OrderDashboardVisibilityService } from "../../api/src/modules/admin/order-dashboard-visibility.js";
import { D1OrderRepository } from "../../api/src/d1/repositories.js";
import { D1DashboardRepository as Dashboard } from "../../api/src/d1/dashboard.js";
import { dashboardPeriod } from "../../api/src/modules/admin/dashboard.js";
import { FinanceService } from "../../api/src/modules/admin/finance/analytics.js";
import {
  toOrderDto,
  toAdminOrderDto,
} from "../../api/src/modules/orders/service.js";
import { WEB_ADMIN_ACTOR } from "../../api/src/modules/admin/web-session.js";
const now = Date.parse("2026-10-21T12:00:00Z"),
  query = { range: "custom", from: "2026-10-21", to: "2026-10-21" };
const service = new OrderDashboardVisibilityService();
function completed() {
  const f = financeFixture();
  f.sqlite
    .prepare(
      `UPDATE "Order" SET status='COMPLETED',createdAt=?,completedAt=?,paidAmount=290000,remainingAmount=0 WHERE id='o'`,
    )
    .run(now, now);
  f.sqlite.exec("UPDATE OrderItem SET procurementUnitCost=90000 WHERE id='i'");
  payment(f.sqlite, "paid", "PREPAYMENT", "APPROVED", 145000, now);
  return f;
}

test("hide excludes completed order/count/payments/chart/latest/profit; restore recovers exact metrics and financial ledger never changes", async () => {
  const f = completed();
  try {
    await f.run(async () => {
      const repo = new Dashboard(),
        period = dashboardPeriod(query, now);
      const before = await repo.load(period),
        ledger = await new FinanceService().load(query, now);
      assert.equal(before.kpis.orders, 1);
      assert.equal(before.kpis.receivedPayments, 145000);
      assert.equal(before.profit!.netProfit, 110000);
      const snapshot = () => ({
        items: f.sqlite.prepare("SELECT * FROM OrderItem").all(),
        payments: f.sqlite.prepare("SELECT * FROM Payment").all(),
        refunds: f.sqlite.prepare("SELECT * FROM Refund").all(),
        redemptions: f.sqlite
          .prepare("SELECT * FROM PromoCodeRedemption")
          .all(),
        expenses: f.sqlite.prepare("SELECT * FROM Expense").all(),
        stock: f.sqlite.prepare("SELECT * FROM ProductVariant").all(),
      });
      const original = snapshot();
      const hidden = await service.set("STZ-FINANCE", WEB_ADMIN_ACTOR, {
        hidden: true,
      });
      assert.ok(hidden.dashboardHiddenAt);
      const filtered = await repo.load(period);
      assert.equal(filtered.kpis.orders, 0);
      assert.equal(filtered.kpis.receivedPayments, 0);
      assert.ok(
        filtered.chart.every(
          (day) => day.orders === 0 && day.receivedPayments === 0,
        ),
      );
      assert.equal(filtered.latestOrders.length, 0);
      assert.equal(filtered.profit!.netProfit, 0);
      assert.deepEqual(await new FinanceService().load(query, now), ledger);
      assert.deepEqual(snapshot(), original);
      assert.equal(
        (await prisma.order.findUniqueOrThrow({ where: { id: "o" } })).status,
        "COMPLETED",
      );
      const hiddenList = await new D1OrderRepository().listForAdmin({
        status: "COMPLETED",
        limit: 20,
      });
      assert.equal(hiddenList.orders.length, 1);
      assert.ok(toAdminOrderDto(hiddenList.orders[0]!).dashboardHiddenAt);
      assert.equal(
        "dashboardHiddenAt" in toOrderDto(hiddenList.orders[0]!),
        false,
      );
      await service.set("STZ-FINANCE", WEB_ADMIN_ACTOR, { hidden: false });
      assert.deepEqual(await repo.load(period), before);
      assert.deepEqual(snapshot(), original);
    });
  } finally {
    f.sqlite.close();
  }
});

test("duplicate/concurrent hide is idempotent and audit has one entry per actual change", async () => {
  const f = completed();
  try {
    await f.run(async () => {
      await Promise.all([
        service.set("STZ-FINANCE", WEB_ADMIN_ACTOR, { hidden: true }),
        service.set("STZ-FINANCE", WEB_ADMIN_ACTOR, { hidden: true }),
      ]);
      const stamp = (
        await service.set("STZ-FINANCE", WEB_ADMIN_ACTOR, { hidden: true })
      ).dashboardHiddenAt;
      assert.ok(stamp);
      assert.equal(
        (
          await service.set("STZ-FINANCE", WEB_ADMIN_ACTOR, { hidden: true })
        ).dashboardHiddenAt!.getTime(),
        stamp!.getTime(),
      );
      assert.equal(
        await prisma.auditLog.count({
          where: { action: "order.dashboard_hidden" },
        }),
        1,
      );
      await service.set("STZ-FINANCE", WEB_ADMIN_ACTOR, { hidden: false });
      await service.set("STZ-FINANCE", WEB_ADMIN_ACTOR, { hidden: false });
      assert.equal(
        await prisma.auditLog.count({
          where: { action: "order.dashboard_restored" },
        }),
        1,
      );
    });
  } finally {
    f.sqlite.close();
  }
});

for (const status of [
  "AWAITING_PREPAYMENT",
  "PAID_FULL",
  "SHIPPED",
  "CANCELLED",
])
  test(`cannot hide unfinished/cancelled order ${status}`, async () => {
    const f = completed();
    try {
      await f.run(async () => {
        f.sqlite
          .prepare(`UPDATE "Order" SET status=? WHERE id='o'`)
          .run(status);
        await assert.rejects(
          service.set("STZ-FINANCE", WEB_ADMIN_ACTOR, { hidden: true }),
          { statusCode: 409 },
        );
        assert.equal(
          (await prisma.order.findUniqueOrThrow({ where: { id: "o" } }))
            .dashboardHiddenAt,
          null,
        );
        assert.equal(await prisma.auditLog.count(), 0);
      });
    } finally {
      f.sqlite.close();
    }
  });

test("invalid payload and missing order cannot alter reporting state", async () => {
  const f = completed();
  try {
    await f.run(async () => {
      for (const input of [
        {},
        { hidden: "true" },
        { hidden: 1 },
        { hidden: true, userId: "other" },
      ])
        await assert.rejects(
          service.set("STZ-FINANCE", WEB_ADMIN_ACTOR, input),
        );
      await assert.rejects(
        service.set("missing", WEB_ADMIN_ACTOR, { hidden: true }),
      );
      assert.equal(
        (await prisma.order.findUniqueOrThrow({ where: { id: "o" } }))
          .dashboardHiddenAt,
        null,
      );
      assert.equal(await prisma.auditLog.count(), 0);
    });
  } finally {
    f.sqlite.close();
  }
});

test("hidden incomplete cost order does not block profit from visible orders; general expenses remain counted", async () => {
  const f = completed();
  try {
    await f.run(async () => {
      f.sqlite.exec("UPDATE OrderItem SET procurementUnitCost=NULL");
      const repo = new Dashboard(),
        period = dashboardPeriod(query, now);
      assert.equal((await repo.load(period)).profit!.netProfit, null);
      await service.set("STZ-FINANCE", WEB_ADMIN_ACTOR, { hidden: true });
      assert.equal((await repo.load(period)).profit!.netProfit, 0);
    });
  } finally {
    f.sqlite.close();
  }
});

test("migration preserves existing orders/payment snapshots and makes all orders visible by default", () => {
  const db = new DatabaseSync(":memory:");
  try {
    for (const name of readdirSync(new URL("../migrations/", import.meta.url))
      .sort()
      .filter((name) => !name.startsWith("0015_")))
      db.exec(
        readFileSync(new URL("../migrations/" + name, import.meta.url), "utf8"),
      );
    db.exec(financeSeed);
    payment(db, "legacy", "PREPAYMENT", "APPROVED", 145000, now);
    const before = db
        .prepare('SELECT * FROM "Order"')
        .all()
        .map((row) => ({ ...row })),
      paid = db.prepare("SELECT * FROM Payment").all();
    db.exec(
      readFileSync(
        new URL(
          "../migrations/0015_order_dashboard_visibility.sql",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    const after = db
      .prepare('SELECT * FROM "Order"')
      .all()
      .map(({ dashboardHiddenAt, ...row }) => {
        assert.equal(dashboardHiddenAt, null);
        return row;
      });
    assert.deepEqual(after, before);
    assert.deepEqual(db.prepare("SELECT * FROM Payment").all(), paid);
  } finally {
    db.close();
  }
});

test("isolated Worker protects hide/restore with Admin session, role and CSRF; no customer data or Telegram side effects", async () => {
  const r = await marketingRuntime();
  try {
    const user = await runtimeUser(r, 7788);
    await r.db
      .prepare(
        `INSERT INTO "Order"(id,publicId,userId,idempotencyKey,status,fullName,phone,city,address,subtotal,total,requiredPrepayment,remainingAmount,createdAt,updatedAt,completedAt) VALUES('o','STZ-HIDE',?,'visibility-fixture-key','COMPLETED','Fixture','0000000','Fixture','Fixture',200000,200000,100000,100000,?,?,?)`,
      )
      .bind(user.id, now, now, now)
      .run();
    const endpoint = "/admin/orders/STZ-HIDE/dashboard-visibility";
    assert.equal(
      (await r.call(endpoint, "POST", { hidden: true })).status,
      401,
    );
    assert.equal(
      (
        await r.call(
          endpoint,
          "POST",
          { hidden: true },
          { authorization: "Bearer " + user.token },
          "https://preview.invalid",
        )
      ).status,
      403,
    );
    assert.equal(
      (
        await r.call(
          endpoint,
          "POST",
          { hidden: true },
          { ...r.signed, "x-csrf-token": "invalid" },
        )
      ).status,
      403,
    );
    for (const method of ["hide", "restore"]) {
      const response = await r.admin(
        "/orders/STZ-HIDE/dashboard-visibility",
        "POST",
        { hidden: method === "hide" },
      );
      assert.equal(response.status, 200);
      const list = await r.admin("/orders?status=COMPLETED");
      assert.equal(list.status, 200);
      const detail = await r.call(
        "/orders/STZ-HIDE",
        "GET",
        undefined,
        { authorization: "Bearer " + user.token },
        "https://preview.invalid",
      );
      assert.equal(detail.status, 200);
      assert.equal(
        "dashboardHiddenAt" in
          ((await detail.json()) as { order: object }).order,
        false,
      );
    }
    assert.equal(r.outboundCalls(), 0);
  } finally {
    await r.mf.dispose();
  }
});
