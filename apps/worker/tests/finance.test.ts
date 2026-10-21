import test from "node:test";
import assert from "node:assert/strict";
import { database } from "@stenzo/database";
import { FinanceService } from "../../api/src/modules/admin/finance/analytics.js";
import {
  financePeriod,
  tashkentTimestamp,
} from "../../api/src/modules/admin/finance/period.js";
import {
  ProcurementService,
  safeMoney,
} from "../../api/src/modules/admin/finance/procurement.js";
import { ExpenseService } from "../../api/src/modules/admin/finance/expenses.js";
import { WEB_ADMIN_ACTOR } from "../../api/src/modules/admin/web-session.js";
import { financeFixture, payment } from "./helpers/finance.js";
import { isolatedD1 } from "./helpers/sqlite.js";
import { marketingRuntime } from "./helpers/marketing-runtime.js";
const service = new FinanceService(),
  cost = new ProcurementService(),
  expenses = new ExpenseService(),
  actor = WEB_ADMIN_ACTOR,
  now = Date.parse("2026-10-20T12:00:00Z");
const q = { range: "custom", from: "2026-10-20", to: "2026-10-20" };
const expense = (
  amount: number,
  category = "CARGO",
  orderPublicId: string | null = "STZ-FINANCE",
) =>
  expenses.save(actor, {
    amount,
    category,
    orderPublicId,
    occurredAt: "2026-10-20T12:00",
    description: null,
  });
const setCost = () =>
  cost.update("STZ-FINANCE", "i", actor, { procurementUnitCost: 90000 });
function completed(f: ReturnType<typeof financeFixture>) {
  f.sqlite
    .prepare(`UPDATE "Order" SET status='COMPLETED',completedAt=? WHERE id='o'`)
    .run(now);
}
test("profit uses net goods revenue, customer cargo, quantity costs and active linked expenses, never double-discounts promo or subtracts global expenses", async () => {
  const f = financeFixture();
  try {
    await f.run(async () => {
      f.sqlite.exec(
        'UPDATE "Order" SET itemsSubtotal=320000,discountAmount=30000,cargoAmount=90000',
      );
      await setCost();
      await expense(60000);
      await expense(5000, "PACKAGING");
      await expense(1234, "ADVERTISING", null);
      const voided = await expense(88888);
      await expenses.void(actor, voided.id);
      const r = await cost.order("STZ-FINANCE");
      assert.equal(r.goodsSubtotal, 320000);
      assert.equal(r.discountAmount, 30000);
      assert.equal(r.goodsRevenue, 290000);
      assert.equal(r.customerCargo, 90000);
      assert.equal(r.revenue, 380000);
      assert.equal(r.procurementCost, 180000);
      assert.equal(r.linkedExpenses, 65000);
      assert.equal(r.directCost, 245000);
      assert.equal(r.profit, 135000);
      assert.equal(r.marginPercent, (135000 / 380000) * 100);
      assert.equal(r.received, 0);
      completed(f);
      const d = await service.load(q, now);
      assert.equal(d.realized.revenue, 380000);
      assert.equal(d.realized.procurement, 180000);
      assert.equal(d.realized.expenses, 65000);
      assert.equal(d.realized.profit, 135000);
      assert.equal(d.cash.expenses, 66234);
      assert.equal(d.cash.cashBeforeProcurement, -66234);
    });
  } finally {
    f.sqlite.close();
  }
});
test("one missing item cost keeps profit/margin null and excludes the entire order from realized monetary aggregates", async () => {
  const f = financeFixture();
  try {
    await f.run(async () => {
      await setCost();
      f.sqlite.exec(
        `INSERT INTO OrderItem(id,orderId,productNameRu,productNameUz,productSlug,sku,size,unitPrice,quantity,lineTotal) VALUES('j','o','A','A','a','OTHER','L',1,1,1);`,
      );
      completed(f);
      const r = await cost.order("STZ-FINANCE");
      assert.equal(r.costComplete, false);
      assert.equal(r.profit, null);
      assert.equal(r.marginPercent, null);
      assert.equal(r.procurementCost, 180000);
      assert.equal(r.missingCosts, 1);
      const d = await service.load(q, now);
      assert.equal(d.realized.completedOrders, 1);
      assert.equal(d.realized.incompleteOrders, 1);
      assert.equal(d.realized.costCompleteOrders, 0);
      assert.equal(d.realized.revenue, 0);
      assert.equal(d.realized.procurement, 0);
      assert.equal(d.realized.profit, 0);
      assert.equal(d.profitableOrders.length, 0);
      assert.equal(d.incompleteOrders[0]!.missingCosts, 1);
    });
  } finally {
    f.sqlite.close();
  }
});
test("negative profit and margin remain visible, cash is independent of economic profit", async () => {
  const f = financeFixture();
  try {
    await f.run(async () => {
      await cost.update("STZ-FINANCE", "i", actor, {
        procurementUnitCost: 200000,
      });
      payment(f.sqlite, "pre", "PREPAYMENT", "APPROVED", 145000);
      payment(f.sqlite, "submitted", "FINAL", "SUBMITTED", 145000);
      payment(f.sqlite, "rejected", "FINAL", "REJECTED", 145000);
      const r = await cost.order("STZ-FINANCE");
      assert.equal(r.profit, -110000);
      assert.equal(r.received, 145000);
      assert.equal(r.outstanding, 145000);
      completed(f);
      const d = await service.load(q, now);
      assert.equal(d.realized.profit, -110000);
      assert.ok(d.realized.marginPercent! < 0);
      assert.equal(d.chart[0]!.profit, -110000);
      assert.equal(d.cash.received, 145000);
      assert.equal(d.cash.goodsReceived, 145000);
      assert.equal(d.cash.cargoReceived, 0);
    });
  } finally {
    f.sqlite.close();
  }
});
test("empty database returns zero cash/cohort/expenses, null margin and 30 zero-filled actual days", async () => {
  const f = isolatedD1();
  try {
    await f.run(async () => {
      const d = await service.load({}, now);
      assert.equal(d.period.from, "2026-09-21");
      assert.equal(d.period.to, "2026-10-20");
      assert.equal(d.chart.length, 30);
      assert.equal(d.cash.received, 0);
      assert.equal(d.cash.goodsReceived, 0);
      assert.equal(d.cash.expenses, 0);
      assert.equal(d.realized.profit, 0);
      assert.equal(d.realized.marginPercent, null);
      assert.equal(d.profitableOrders.length, 0);
      assert.equal(d.incompleteOrders.length, 0);
      assert.ok(
        d.chart.every(
          (r) => r.received === 0 && r.expenses === 0 && r.profit === 0,
        ),
      );
      assert.ok(d.expenseBreakdown.every((r) => r.amount === 0));
    });
  } finally {
    f.sqlite.close();
  }
});
test("approved cash is counted only once by review date, with exact historical goods/cargo split after final approval", async () => {
  const f = financeFixture();
  try {
    await f.run(async () => {
      f.sqlite.exec(
        'UPDATE "Order" SET cargoAmount=90000,cargoPaidAmount=90000,paidAmount=total,remainingAmount=0',
      );
      payment(f.sqlite, "pre", "PREPAYMENT", "APPROVED", 145000);
      payment(f.sqlite, "final", "FINAL", "APPROVED", 235000);
      payment(f.sqlite, "submitted", "FINAL", "SUBMITTED", 999999);
      payment(f.sqlite, "rejected", "FINAL", "REJECTED", 999999);
      const d = await service.load(q, now);
      assert.equal(d.cash.received, 380000);
      assert.equal(d.cash.goodsReceived, 290000);
      assert.equal(d.cash.cargoReceived, 90000);
      assert.equal(d.cash.unallocatedFinalCount, 0);
      assert.equal(d.chart[0]!.received, 380000);
    });
  } finally {
    f.sqlite.close();
  }
});
test("FINAL split uses immutable total minus original prepayment, not remainingAmount now zero; prepayment outside period is not counted again", async () => {
  const f = financeFixture();
  try {
    await f.run(async () => {
      f.sqlite.exec(
        'UPDATE "Order" SET cargoAmount=90000,cargoPaidAmount=90000,paidAmount=total,remainingAmount=0',
      );
      payment(
        f.sqlite,
        "pre",
        "PREPAYMENT",
        "APPROVED",
        145000,
        now - 86400000,
      );
      payment(f.sqlite, "final", "FINAL", "APPROVED", 235000);
      const d = await service.load(q, now);
      assert.equal(d.cash.received, 235000);
      assert.equal(d.cash.goodsReceived, 145000);
      assert.equal(d.cash.cargoReceived, 90000);
    });
  } finally {
    f.sqlite.close();
  }
});
for (const mode of [
  "mismatched amount",
  "missing prepayment",
  "duplicate final",
  "changed cargo",
] as const)
  test(`ambiguous historical FINAL (${mode}) retains exact cash total but never guesses goods/cargo split`, async () => {
    const f = financeFixture();
    try {
      await f.run(async () => {
        f.sqlite.exec(
          'UPDATE "Order" SET cargoAmount=90000,cargoPaidAmount=90000,paidAmount=total,remainingAmount=0',
        );
        if (mode !== "missing prepayment")
          payment(f.sqlite, "pre", "PREPAYMENT", "APPROVED", 145000);
        payment(
          f.sqlite,
          "final",
          "FINAL",
          "APPROVED",
          mode === "mismatched amount" ? 234999 : 235000,
        );
        if (mode === "duplicate final")
          payment(f.sqlite, "dup", "FINAL", "APPROVED", 235000);
        if (mode === "changed cargo")
          f.sqlite.exec('UPDATE "Order" SET cargoAmount=100000');
        const d = await service.load(q, now);
        assert.equal(d.cash.goodsReceived, null);
        assert.equal(d.cash.cargoReceived, null);
        assert.ok(d.cash.unallocatedFinalCount > 0);
        assert.equal(
          d.cash.received,
          (mode === "missing prepayment" ? 0 : 145000) +
            (mode === "mismatched amount" ? 234999 : 235000) +
            (mode === "duplicate final" ? 235000 : 0),
        );
        assert.equal(
          d.cash.unallocatedCash,
          (mode === "mismatched amount" ? 234999 : 235000) *
            (mode === "duplicate final" ? 2 : 1),
        );
      });
    } finally {
      f.sqlite.close();
    }
  });
test("Tashkent day includes start and excludes next midnight for cash, expenses and completed orders, using reviewedAt then submittedAt fallback", async () => {
  const f = financeFixture();
  try {
    await f.run(async () => {
      const start = Date.parse("2026-10-19T19:00:00Z"),
        end = Date.parse("2026-10-20T19:00:00Z");
      payment(f.sqlite, "before", "PREPAYMENT", "APPROVED", 1, start - 1);
      payment(f.sqlite, "start", "PREPAYMENT", "APPROVED", 2, start, null);
      payment(f.sqlite, "last", "PREPAYMENT", "APPROVED", 3, end - 1);
      payment(f.sqlite, "end", "PREPAYMENT", "APPROVED", 4, end);
      payment(
        f.sqlite,
        "review",
        "PREPAYMENT",
        "APPROVED",
        5,
        start - 86400000,
        start,
      );
      await expense(10);
      await expenses.save(actor, {
        category: "OTHER",
        amount: 20,
        occurredAt: "2026-10-21T00:00",
      });
      await setCost();
      f.sqlite
        .prepare("UPDATE \"Order\" SET status='COMPLETED',completedAt=?")
        .run(start);
      const d = await service.load(q, now);
      assert.equal(d.cash.received, 10);
      assert.equal(d.cash.expenses, 10);
      assert.equal(d.realized.completedOrders, 1);
      f.sqlite.prepare('UPDATE "Order" SET completedAt=?').run(end);
      assert.equal((await service.load(q, now)).realized.completedOrders, 0);
    });
  } finally {
    f.sqlite.close();
  }
});
for (const [range, length] of [
  ["today", 1],
  ["7d", 7],
  ["30d", 30],
  ["90d", 90],
] as const)
  test(`finance ${range} period uses Tashkent boundaries and ${length} days`, () => {
    const p = financePeriod({ range }, now);
    assert.equal(p.days.length, length);
    assert.equal(p.end, Date.parse("2026-10-20T19:00:00Z"));
  });
test("custom periods accept 366 inclusive days, reject longer/invalid/reversed/extra queries and timezone ambiguity", () => {
  assert.equal(
    financePeriod(
      { range: "custom", from: "2024-01-01", to: "2024-12-31" },
      now,
    ).days.length,
    366,
  );
  for (const input of [
    { range: "custom", from: "2024-01-01", to: "2025-01-01" },
    { range: "custom", from: "2026-10-20", to: "2026-10-19" },
    { range: "custom", from: "2026-02-30", to: "2026-03-01" },
    { range: "today", from: "2026-10-20" },
    { timezone: "UTC" },
  ])
    assert.throws(() => financePeriod(input, now));
  assert.equal(
    tashkentTimestamp("2026-10-20T00:00").toISOString(),
    "2026-10-19T19:00:00.000Z",
  );
  assert.throws(() => safeMoney(9007199254740992));
});
test("undated historical completed orders remain excluded; expense category totals ignore voids and procurement is not expense cash", async () => {
  const f = financeFixture();
  try {
    await f.run(async () => {
      await setCost();
      f.sqlite.exec("UPDATE \"Order\" SET status='COMPLETED',completedAt=NULL");
      await expense(10, "PACKAGING");
      await expense(20, "DELIVERY");
      const v = await expense(100);
      await expenses.void(actor, v.id);
      const d = await service.load(q, now);
      assert.equal(d.realized.completedOrders, 0);
      assert.equal(d.realized.historicalUndated, 1);
      assert.equal(d.realized.profit, 0);
      assert.equal(d.cash.expenses, 30);
      assert.equal(
        d.expenseBreakdown.find((r) => r.category === "PACKAGING")!.amount,
        10,
      );
      assert.equal(
        d.expenseBreakdown.find((r) => r.category === "CARGO")!.amount,
        0,
      );
    });
  } finally {
    f.sqlite.close();
  }
});
test("incomplete costs and profitable-order tables are independently bounded at ten; sums include the entire selected cohort", async () => {
  const f = financeFixture();
  try {
    await f.run(async () => {
      const order = f.sqlite.prepare('SELECT * FROM "Order"').get()!,
        item = f.sqlite.prepare("SELECT * FROM OrderItem").get()!;
      for (let i = 1; i <= 25; i++) {
        const o = {
          ...order,
          id: "o" + i,
          publicId: "STZ-" + i,
          idempotencyKey: "fixture-key-" + i,
          status: "COMPLETED",
          completedAt: now,
        };
        const fields = Object.keys(o);
        f.sqlite
          .prepare(
            'INSERT INTO "Order"(' +
              fields.map((k) => '"' + k + '"').join(",") +
              ") VALUES(" +
              fields.map(() => "?").join(",") +
              ")",
          )
          .run(...(Object.values(o) as never[]));
        const it = {
          ...item,
          id: "i" + i,
          orderId: "o" + i,
          procurementUnitCost: i <= 13 ? 90000 : null,
        };
        const keys = Object.keys(it);
        f.sqlite
          .prepare(
            "INSERT INTO OrderItem(" +
              keys.map((k) => '"' + k + '"').join(",") +
              ") VALUES(" +
              keys.map(() => "?").join(",") +
              ")",
          )
          .run(...(Object.values(it) as never[]));
      }
      const d = await service.load(q, now);
      assert.equal(d.realized.completedOrders, 25);
      assert.equal(d.realized.costCompleteOrders, 13);
      assert.equal(d.realized.incompleteOrders, 12);
      assert.equal(d.profitableOrders.length, 10);
      assert.equal(d.incompleteOrders.length, 10);
      assert.equal(d.realized.profit, 13 * 110000);
      assert.equal(d.realized.revenue, 25 * 290000 - 12 * 290000);
      const plan = await database()
        .prepare(
          "EXPLAIN QUERY PLAN SELECT * FROM Expense WHERE occurredAt>=? AND occurredAt<? ORDER BY occurredAt DESC,id DESC LIMIT 20",
        )
        .bind(1, now)
        .all();
      assert.ok(JSON.stringify(plan).includes("Expense_occurredAt"));
    });
  } finally {
    f.sqlite.close();
  }
});
test("actual Worker Finance dashboard is Admin-only, read-only and does not seed business records or send notifications", async () => {
  const f = await marketingRuntime();
  try {
    assert.equal((await f.call("/admin/finance")).status, 401);
    const before = (await f.db
      .prepare("SELECT version FROM _Revision")
      .first<{ version: number }>())!.version;
    const r = await f.admin("/finance?range=30d");
    assert.equal(r.status, 200);
    const d = (await r.json()) as {
      cash: { received: number };
      chart: unknown[];
    };
    assert.equal(d.cash.received, 0);
    assert.equal(d.chart.length, 30);
    assert.equal(
      (await f.db
        .prepare("SELECT version FROM _Revision")
        .first<{ version: number }>())!.version,
      before,
    );
    assert.equal(f.outboundCalls(), 0);
    for (const table of ["Expense", "Order", "User", "Payment"])
      assert.equal(
        (await f.db
          .prepare(`SELECT count(*) n FROM "${table}"`)
          .first<{ n: number }>())!.n,
        0,
      );
  } finally {
    await f.mf.dispose();
  }
});
