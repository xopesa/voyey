import test from "node:test";
import assert from "node:assert/strict";
import { database, withDatabase } from "@stenzo/database";
import { D1DashboardRepository } from "../../api/src/d1/dashboard.js";
import { dashboardPeriod } from "../../api/src/modules/admin/dashboard.js";
import { HttpError } from "../../api/src/modules/auth/errors.js";
import { isolatedD1 } from "./helpers/sqlite.js";

const NOW = Date.parse("2026-10-19T10:00:00Z");
const period = (query: unknown = { range: "7d" }) =>
  dashboardPeriod(query, NOW);
const iso = (date: string) => Date.parse(date);
for (const [range, from, length] of [
  ["today", "2026-10-19", 1],
  ["7d", "2026-10-13", 7],
  ["30d", "2026-09-20", 30],
] as const)
  test(`${range} includes today and exactly ${length} Tashkent calendar days`, () => {
    const p = period({ range });
    assert.equal(p.from, from);
    assert.equal(p.to, "2026-10-19");
    assert.equal(p.days.length, length);
    assert.equal(p.end, iso("2026-10-19T19:00:00Z"));
  });
test("default range is 7d", () =>
  assert.deepEqual(period({}), period({ range: "7d" })));
test("server today changes precisely at Tashkent midnight, not UTC/browser midnight", () => {
  const before = dashboardPeriod(
    { range: "today" },
    iso("2026-10-18T18:59:59.999Z"),
  );
  const after = dashboardPeriod(
    { range: "today" },
    iso("2026-10-18T19:00:00Z"),
  );
  assert.equal(before.from, "2026-10-18");
  assert.equal(after.from, "2026-10-19");
  assert.equal(after.start, iso("2026-10-18T19:00:00Z"));
  assert.equal(after.timezone, "Asia/Tashkent");
});
test("custom range is inclusive and supports leap day / exactly 366 days", () => {
  const p = period({ range: "custom", from: "2024-01-01", to: "2024-12-31" });
  assert.equal(p.days.length, 366);
  assert.ok(p.days.includes("2024-02-29"));
  assert.equal(
    period({ range: "custom", from: "2026-10-19", to: "2026-10-19" }).days
      .length,
    1,
  );
});
for (const [name, query] of Object.entries({
  reverse: { range: "custom", from: "2026-10-20", to: "2026-10-19" },
  missing: { range: "custom", from: "2026-10-19" },
  invalidDate: { range: "custom", from: "2026-02-29", to: "2026-03-01" },
  overflowDate: { range: "custom", from: "2026-02-30", to: "2026-03-01" },
  excessive: { range: "custom", from: "2024-01-01", to: "2025-01-01" },
  timestamp: {
    range: "custom",
    from: "2026-10-19T00:00:00Z",
    to: "2026-10-20",
  },
  unknownRange: { range: "all" },
  clientTimezone: { range: "today", timezone: "UTC" },
  presetDates: { range: "today", from: "2026-10-18", to: "2026-10-19" },
}))
  test(`invalid custom/query rejected: ${name}`, () =>
    assert.throws(
      () => period(query),
      (e) => e instanceof HttpError && e.statusCode === 400,
    ));

type Fixture = ReturnType<typeof isolatedD1>;
async function fixture(
  run: (f: Fixture, repo: D1DashboardRepository) => Promise<void>,
) {
  const f = isolatedD1();
  try {
    await f.run(() => run(f, new D1DashboardRepository()));
  } finally {
    f.sqlite.close();
  }
}
function buyer(f: Fixture, extra = "") {
  f.sqlite.exec(
    `INSERT INTO User(id,telegramId,username,firstName,lastName,updatedAt) VALUES('buyer','12345','fixture_buyer','First','Last',1);${extra}`,
  );
}
function order(
  f: Fixture,
  id: string,
  created = "2026-10-19T09:00:00Z",
  status = "AWAITING_PREPAYMENT",
  paid = 0,
  name = "Fixture Buyer",
) {
  f.sqlite
    .prepare(
      `INSERT INTO "Order"(id,publicId,userId,idempotencyKey,status,fullName,phone,city,address,total,subtotal,requiredPrepayment,paidAmount,remainingAmount,cargoAmount,cargoPaidAmount,createdAt,updatedAt) VALUES(?,?, 'buyer', ?, ?, ?, 'private-phone', 'private-city', 'private-address',1000,1000,500,?,?,100,100,?,1)`,
    )
    .run(
      id,
      "STZ-" + id,
      id,
      status,
      name,
      paid,
      paid ? 1000 - paid : 500,
      iso(created),
    );
}
function payment(
  f: Fixture,
  id: string,
  status = "APPROVED",
  amount = 500,
  reviewed: string | null = "2026-10-19T09:00:00Z",
  submitted = "2026-10-18T09:00:00Z",
  type = "PREPAYMENT",
) {
  f.sqlite
    .prepare(
      `INSERT INTO Payment(id,orderId,type,status,expectedAmount,idempotencyKey,proofStorageKey,proofMimeType,submittedAt,reviewedAt,updatedAt) VALUES(?,'order',?,?,?,?,?,'image/png',?,?,1)`,
    )
    .run(
      id,
      type,
      status,
      amount,
      id,
      "private-proof-" + id,
      iso(submitted),
      reviewed === null ? null : iso(reviewed),
    );
}
test("empty DB returns only zeros, zero-filled chart, and no latest orders", async () =>
  fixture(async (_f, repo) => {
    const result = await repo.load(period());
    assert.ok(Object.values(result.kpis).every((v) => v === 0));
    assert.deepEqual(result.latestOrders, []);
    assert.equal(result.chart.length, 7);
    assert.ok(
      result.chart.every(
        (row) => row.orders === 0 && row.receivedPayments === 0,
      ),
    );
    assert.deepEqual(result.products, {
      total: 0,
      active: 0,
      draft: 0,
      inactive: 0,
      lowStockVariants: 0,
      outOfStockVariants: 0,
      lowStockThreshold: 3,
    });
  }));
test("selected period includes its exact start and excludes previous day / exclusive end", async () =>
  fixture(async (f, repo) => {
    buyer(f);
    const p = period({ range: "today" });
    order(f, "previous", new Date(p.start - 1).toISOString());
    order(f, "start", new Date(p.start).toISOString());
    order(f, "end-minus-one", new Date(p.end - 1).toISOString());
    order(f, "next", new Date(p.end).toISOString());
    assert.equal((await repo.load(p)).kpis.orders, 2);
  }));
test("orders chart buckets by Tashkent day and zero-fills missing days", async () =>
  fixture(async (f, repo) => {
    buyer(f);
    order(f, "one", "2026-10-17T19:00:00Z");
    order(f, "two", "2026-10-18T18:59:59.999Z");
    order(f, "three", "2026-10-18T19:00:00Z");
    const r = await repo.load(period());
    assert.deepEqual(
      r.chart.map((row) => row.orders),
      [0, 0, 0, 0, 0, 2, 1],
    );
    assert.equal(r.kpis.orders, 3);
  }));
test("approved payment contributes expectedAmount", async () =>
  fixture(async (f, repo) => {
    buyer(f);
    order(f, "order");
    payment(f, "approved", "APPROVED", 321);
    assert.equal((await repo.load(period())).kpis.receivedPayments, 321);
  }));
for (const status of ["SUBMITTED", "REJECTED"])
  test(`${status} payments never count`, async () =>
    fixture(async (f, repo) => {
      buyer(f);
      order(f, "order");
      payment(f, status, status, 999);
      const r = await repo.load(period());
      assert.equal(r.kpis.receivedPayments, 0);
      assert.ok(r.chart.every((row) => row.receivedPayments === 0));
    }));
test("prepayment + final including cargo counted exactly once, never added to Order.paidAmount", async () =>
  fixture(async (f, repo) => {
    buyer(f);
    order(f, "order", undefined, "COMPLETED", 1000);
    payment(f, "pre", "APPROVED", 500);
    payment(f, "final", "APPROVED", 600, undefined, undefined, "FINAL");
    const r = await repo.load(period());
    assert.equal(r.kpis.receivedPayments, 1100);
    assert.equal(r.latestOrders[0]!.paid, 1100);
  }));
test("reviewedAt governs approved payment day, even when submitted outside period", async () =>
  fixture(async (f, repo) => {
    buyer(f);
    order(f, "order");
    payment(
      f,
      "reviewed",
      "APPROVED",
      77,
      "2026-10-18T19:00:00Z",
      "2026-09-01T10:00:00Z",
    );
    const r = await repo.load(period({ range: "today" }));
    assert.equal(r.kpis.receivedPayments, 77);
    assert.equal(r.chart[0]!.receivedPayments, 77);
  }));
test("reviewedAt outside period excludes payment submitted inside period", async () =>
  fixture(async (f, repo) => {
    buyer(f);
    order(f, "order");
    payment(
      f,
      "reviewed-before",
      "APPROVED",
      100,
      "2026-10-18T18:59:59.999Z",
      "2026-10-19T10:00:00Z",
    );
    assert.equal(
      (await repo.load(period({ range: "today" }))).kpis.receivedPayments,
      0,
    );
  }));
test("legacy approved payment without reviewedAt uses submittedAt fallback", async () =>
  fixture(async (f, repo) => {
    buyer(f);
    order(f, "order");
    payment(f, "legacy", "APPROVED", 33, null, "2026-10-18T19:00:00Z");
    assert.equal(
      (await repo.load(period({ range: "today" }))).kpis.receivedPayments,
      33,
    );
  }));
test("payment chart uses Tashkent boundaries and zero-filled days", async () =>
  fixture(async (f, repo) => {
    buyer(f);
    order(f, "order");
    payment(f, "a", "APPROVED", 10, "2026-10-18T18:59:59.999Z");
    payment(f, "b", "APPROVED", 20, "2026-10-18T19:00:00Z");
    payment(f, "c", "APPROVED", 100, "2026-10-19T19:00:00Z");
    const r = await repo.load(period());
    assert.deepEqual(
      r.chart.map((row) => row.receivedPayments),
      [0, 0, 0, 0, 0, 10, 20],
    );
    assert.equal(r.kpis.receivedPayments, 30);
  }));
test("awaiting review is a current count, not restricted by selected period", async () =>
  fixture(async (f, repo) => {
    buyer(f);
    order(f, "pre", "2026-09-01T00:00:00Z", "PREPAYMENT_SUBMITTED");
    order(f, "final", undefined, "FINAL_PAYMENT_SUBMITTED");
    order(f, "waiting");
    assert.equal((await repo.load(period())).kpis.awaitingReview, 2);
  }));
test("in-progress excludes initial unpaid/unapproved, completed and cancelled; includes remaining fulfilment stages", async () =>
  fixture(async (f, repo) => {
    buyer(f);
    const active = [
      "AWAITING_PURCHASE",
      "PURCHASED",
      "IN_TRANSIT",
      "ARRIVED",
      "WEIGHING",
      "AWAITING_FINAL_PAYMENT",
      "FINAL_PAYMENT_SUBMITTED",
      "PAID_FULL",
      "READY_TO_SHIP",
      "SHIPPED",
    ];
    for (const status of [
      ...active,
      "AWAITING_PREPAYMENT",
      "PREPAYMENT_SUBMITTED",
      "COMPLETED",
      "CANCELLED",
    ])
      order(f, status, undefined, status);
    assert.equal((await repo.load(period())).kpis.inProgress, active.length);
  }));
test("product summary counts statuses; low 1–3 and zero separate, null/inactive variants excluded", async () =>
  fixture(async (f, repo) => {
    f.sqlite
      .exec(`INSERT INTO Category(id,nameRu,nameUz,slug,updatedAt) VALUES('cat','Test','Test','test',1);
    INSERT INTO Product(id,categoryId,nameRu,nameUz,slug,price,status,updatedAt) VALUES('a','cat','A','A','a',100,'ACTIVE',1),('b','cat','B','B','b',100,'DRAFT',1),('c','cat','C','C','c',100,'INACTIVE',1);`);
    for (const [id, stock, active] of [
      ["zero", 0, 1],
      ["one", 1, 1],
      ["two", 2, 1],
      ["three", 3, 1],
      ["four", 4, 1],
      ["null", null, 1],
      ["off", 1, 0],
      ["off-zero", 0, 0],
    ] as const)
      f.sqlite
        .prepare(
          "INSERT INTO ProductVariant(id,productId,sku,size,stock,isActive,updatedAt) VALUES(?,'a',?,'M',?,?,1)",
        )
        .run(id, id, stock, active);
    const r = await repo.load(period());
    assert.equal(r.kpis.activeProducts, 1);
    assert.equal(r.kpis.lowStockVariants, 4);
    assert.deepEqual(r.products, {
      total: 3,
      active: 1,
      draft: 1,
      inactive: 1,
      lowStockVariants: 3,
      outOfStockVariants: 1,
      lowStockThreshold: 3,
    });
  }));
test("latest orders max 8, newest first with deterministic tie-breaker, across all periods", async () =>
  fixture(async (f, repo) => {
    buyer(f);
    for (let i = 0; i < 12; i++)
      order(
        f,
        String(i).padStart(2, "0"),
        `2026-09-${String(i + 1).padStart(2, "0")}T10:00:00Z`,
      );
    order(f, "tie", "2026-09-12T10:00:00Z");
    const r = await repo.load(period());
    assert.equal(r.kpis.orders, 0);
    assert.equal(r.latestOrders.length, 8);
    assert.deepEqual(
      r.latestOrders.map((o) => o.publicId),
      [
        "STZ-tie",
        "STZ-11",
        "STZ-10",
        "STZ-09",
        "STZ-08",
        "STZ-07",
        "STZ-06",
        "STZ-05",
      ],
    );
  }));
test("latest customer falls back to Telegram username, name and ID without exposing private fields", async () =>
  fixture(async (f, repo) => {
    buyer(f);
    order(f, "order", undefined, undefined, 0, "  ");
    let r = await repo.load(period());
    assert.equal(r.latestOrders[0]!.customer, "@fixture_buyer");
    f.sqlite.exec("UPDATE User SET username=NULL");
    r = await repo.load(period());
    assert.equal(r.latestOrders[0]!.customer, "First Last");
    f.sqlite.exec("UPDATE User SET firstName=NULL,lastName=NULL");
    r = await repo.load(period());
    assert.equal(r.latestOrders[0]!.customer, "12345");
    assert.deepEqual(
      Object.keys(r.latestOrders[0]!).sort(),
      ["publicId", "customer", "total", "paid", "status", "createdAt"].sort(),
    );
    assert.doesNotMatch(
      JSON.stringify(r),
      /private-|proof|token|secret|phone|address/i,
    );
  }));
test("dashboard performs exactly seven read-only queries and creates no DB changes/audits", async () =>
  fixture(async (f, repo) => {
    buyer(f);
    for (let i = 0; i < 20; i++) order(f, String(i));
    const before = f.sqlite.prepare("SELECT total_changes() n").get()!.n;
    const connection = database(),
      queries: string[] = [];
    await withDatabase(
      {
        prepare: (sql) => {
          queries.push(sql);
          return connection.prepare(sql);
        },
        batch: async () => {
          throw new Error("Dashboard must not write");
        },
      },
      () => repo.load(period()),
    );
    assert.equal(queries.length, 7);
    assert.ok(queries.every((sql) => /^(SELECT|WITH)\b/i.test(sql)));
    assert.equal(f.sqlite.prepare("SELECT total_changes() n").get()!.n, before);
    assert.equal(
      f.sqlite.prepare("SELECT count(*) n FROM AuditLog").get()!.n,
      0,
    );
  }));
