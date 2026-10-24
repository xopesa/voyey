import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { withDatabase, type Database } from "@stenzo/database";
import { isolatedD1 } from "./helpers/sqlite.js";
import { marketingRuntime } from "./helpers/marketing-runtime.js";
import { runtimeUser } from "./helpers/customer-operations.js";
import { png } from "../../api/tests/fixtures/images.js";
import {
  D1CartRepository,
  D1OrderRepository,
} from "../../api/src/d1/repositories.js";
import { prepareOrder } from "../../api/src/modules/checkout/domain.js";
import { LinkedCheckoutCommit } from "../../api/src/modules/checkout/group-commit.js";
import { SaleModeCheckoutCommit } from "../../api/src/modules/checkout/sale-mode-commit.js";
import { readCheckoutGroup } from "../../api/src/modules/checkout/group-store.js";
import { LinkedCheckoutPayments } from "../../api/src/modules/checkout/linked-payments.js";
import { PreorderFinance } from "../../api/src/modules/checkout/preorder-finance.js";
import { VoyeyOwnerAuthority } from "../../api/src/modules/admin/owner.js";
import { JwtTokenService } from "../../api/src/modules/auth/token.js";
import {
  PromoCodeService,
  parsePromo,
  promoUsage,
} from "../../api/src/modules/marketing/promo-codes.js";
import { PromoFoundation } from "../../api/src/modules/marketing/promo-foundation.js";
import {
  evaluatePromoPolicy,
  parsePromoPolicy,
} from "../../api/src/modules/marketing/promo-policy.js";
import { LinkedCheckoutRefunds } from "../../api/src/modules/checkout/refunds.js";
import { LinkedCheckoutCancellations } from "../../api/src/modules/checkout/cancellations.js";
import { WEB_ADMIN_ACTOR } from "../../api/src/modules/admin/web-session.js";

type Mode = "IN_STOCK" | "PREORDER";
const seed = `INSERT INTO User(id,telegramId,updatedAt) VALUES('buyer',900141,1),('other',900142,1),('owner',900143,1),('employee',900144,1);
INSERT INTO TelegramAdmin(id,telegramId,isActive,createdBy,createdAt,updatedAt) VALUES('owner-admin','900143',1,'fixture',1,1),('staff-admin','900144',1,'fixture',1,1);
INSERT INTO Category(id,nameRu,nameUz,slug,requiresBuyerMeasurements,updatedAt) VALUES('c','Fixture','Fixture','c',0,1);
INSERT INTO Product(id,categoryId,nameRu,nameUz,slug,price,status,updatedAt) VALUES('p','c','Fixture','Fixture','p',101,'ACTIVE',1);
INSERT INTO ProductVariant(id,productId,sku,size,stock,preorderEnabled,updatedAt) VALUES('v','p','FIXTURE','',5,1,1),('v2','p','FIXTURE2','',5,1,1);`;
const recipient = {
  fullName: "Synthetic buyer",
  phone: "+998900000000",
  city: "Fixture",
  address: "Fixture street",
  apartment: null,
  comment: null,
};
const base = { code: "TEST99", type: "PERCENT", value: 99, isActive: true };
const card = {
  cardNumber: "ISOLATED",
  cardHolder: "ISOLATED",
  instructionsRu: "ISOLATED",
  instructionsUz: "ISOLATED",
};
const migration = () =>
  readFileSync(
    new URL(
      "../migrations/0027_independent_checkout_and_promo_99.sql",
      import.meta.url,
    ),
    "utf8",
  );
const statements = () =>
  migration()
    .split(/;\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
function services() {
  const tokens = new JwtTokenService(randomBytes(32).toString("hex"));
  const owner = new VoyeyOwnerAuthority(tokens, () => "900143");
  return {
    owner,
    foundation: new PromoFoundation(owner, true),
    payments: new LinkedCheckoutPayments(owner, true, card),
    preorder: new PreorderFinance(owner, true),
    cancellations: new LinkedCheckoutCancellations(owner, true),
    refunds: new LinkedCheckoutRefunds(owner, true),
    auth: async (id = "buyer") => "Bearer " + (await tokens.issue(id)),
  };
}
function fixture(through = "9999") {
  const f = isolatedD1(through);
  f.sqlite.exec(seed);
  return { ...f, ...services() };
}
type Fixture = ReturnType<typeof fixture>;
const rows = (f: Fixture, table: string) =>
  f.sqlite
    .prepare(`SELECT * FROM "${table}" ORDER BY rowid`)
    .all()
    .map((r) => ({ ...r }));
const stock = (f: Fixture) =>
  (
    f.sqlite.prepare("SELECT stock FROM ProductVariant WHERE id='v'").get() as {
      stock: number;
    }
  ).stock;
const count = (f: Fixture, table: string) => rows(f, table).length;
function scenario(name: string, fn: (f: Fixture) => Promise<void>) {
  test(name, async () => {
    const f = fixture();
    try {
      await f.run(() => fn(f));
    } finally {
      f.sqlite.close();
    }
  });
}
async function add(
  saleMode: Mode | "LEGACY",
  userId = "buyer",
  variantId = "v",
  quantity = 1,
) {
  return new D1CartRepository().addItem(userId, {
    productId: "p",
    variantId,
    quantity,
    heightCm: null,
    weightKg: null,
    saleMode,
  });
}
async function create(
  saleMode: Mode,
  key = randomUUID(),
  extra: Record<string, unknown> = {},
  userId = "buyer",
) {
  return new SaleModeCheckoutCommit(true, false).create(userId, key, {
    saleMode,
    recipient,
    ...(saleMode === "PREORDER" ? { preorderPercent: 50 } : {}),
    ...extra,
  });
}
async function mixed() {
  await add("IN_STOCK");
  await add("PREORDER");
}
async function oldPromo(extra: Record<string, unknown> = {}) {
  return new PromoCodeService().save(WEB_ADMIN_ACTOR, {
    ...base,
    code: "OLD10",
    value: 10,
    ...extra,
  });
}
function quote(
  value: Record<string, unknown> = {},
  amount = 101,
  lines?: unknown[],
) {
  return evaluatePromoPolicy(
    { ...base, ...value },
    {
      userId: "buyer",
      now: Date.now(),
      usage: { global: 0, account: 0 },
      lines: lines ?? [
        {
          lineId: "l",
          productId: "p",
          categoryId: "c",
          saleMode: "IN_STOCK",
          quantity: 1,
          unitPrice: amount,
        },
      ],
    },
  );
}
const proof = () => ({ data: Buffer.from(png), declaredMimeType: "image/png" });
async function pay(
  f: ReturnType<typeof services>,
  order: { id: string; firstPaymentAmount: number },
) {
  const auth = await f.auth(),
    owner = await f.auth("owner");
  const p = await f.payments.submit(
    auth,
    order.id,
    randomUUID(),
    { declaredAmount: order.firstPaymentAmount },
    proof(),
  );
  await f.payments.review(owner, p.payment.id, randomUUID(), {
    decision: "APPROVE",
    confirmedAmount: order.firstPaymentAmount,
    bankOperationReference: randomUUID(),
  });
  return { auth, owner, p };
}

for (const mode of ["IN_STOCK", "PREORDER"] as const)
  scenario(
    `${mode}: exactly one selected order, same SKU other tab byte-for-byte retained`,
    async (f) => {
      await mixed();
      const before = rows(f, "CartItem").filter((r) => r.saleMode !== mode);
      const g = await create(mode),
        o = g.orders[0]!;
      assert.equal(g.selectedSaleMode, mode);
      assert.equal(g.orders.length, 1);
      assert.equal(o.saleMode, mode);
      assert.equal(o.goodsTotal, 101);
      assert.equal(o.firstPaymentAmount, mode === "IN_STOCK" ? 101 : 51);
      assert.equal(o.prepaymentPercent, mode === "IN_STOCK" ? 100 : 50);
      assert.equal(
        o.financialPolicy.cargo,
        mode === "IN_STOCK" ? "NOT_APPLICABLE" : "UNKNOWN_UNTIL_ARRIVAL",
      );
      assert.equal(stock(f), mode === "IN_STOCK" ? 4 : 5);
      assert.equal(
        o.items[0]!.inventoryReservedQuantity,
        mode === "IN_STOCK" ? 1 : 0,
      );
      assert.deepEqual(rows(f, "CartItem"), before);
    },
  );

scenario("PREORDER FIRST100 and zero stock, CARGO separate", async (f) => {
  await add("PREORDER");
  f.sqlite.exec("UPDATE ProductVariant SET stock=0 WHERE id='v'");
  const g = await create("PREORDER", randomUUID(), { preorderPercent: 100 });
  assert.equal(g.orders[0]!.firstPaymentAmount, 101);
  assert.equal(g.orders[0]!.remainingAfterFirst, 0);
  assert.equal(stock(f), 0);
  assert.equal(g.orders[0]!.cargoAmount, null);
});
scenario(
  "successive tabs have independent groups, keys, promo use and obligations",
  async (f) => {
    await mixed();
    await oldPromo();
    const a = await create("IN_STOCK", randomUUID(), { promoCode: "OLD10" });
    const b = await create("PREORDER");
    assert.notEqual(a.id, b.id);
    assert.equal(count(f, "CheckoutGroup"), 2);
    assert.equal(count(f, "CartItem"), 0);
    assert.equal(a.discountAmount, 10);
    assert.equal(b.discountAmount, 0);
    assert.equal(count(f, "CheckoutPromoUse"), 1);
  },
);
scenario(
  "different codes in successive tabs are not allocated across modes",
  async (f) => {
    await mixed();
    await oldPromo();
    await oldPromo({ code: "OTHER20", value: 20 });
    const a = await create("IN_STOCK", randomUUID(), { promoCode: "OLD10" });
    const b = await create("PREORDER", randomUUID(), { promoCode: "OTHER20" });
    assert.equal(a.orders[0]!.discountAmount, 10);
    assert.equal(b.orders[0]!.discountAmount, 20);
    assert.equal(count(f, "CheckoutPromoUse"), 2);
  },
);
scenario(
  "empty selected tab fails without consuming other tab or reserving",
  async (f) => {
    await add("PREORDER");
    const before = rows(f, "CartItem");
    await assert.rejects(create("IN_STOCK"), /Selected sale-mode tab is empty/);
    assert.deepEqual(rows(f, "CartItem"), before);
    assert.equal(count(f, "CheckoutGroup"), 0);
    assert.equal(stock(f), 5);
  },
);
scenario("LEGACY rows are retained, never silently converted", async (f) => {
  await add("LEGACY", "buyer", "v2");
  await add("IN_STOCK");
  const before = rows(f, "CartItem").filter((r) => r.saleMode === "LEGACY");
  await create("IN_STOCK");
  assert.deepEqual(rows(f, "CartItem"), before);
  await assert.rejects(create("PREORDER"), /empty/);
});
scenario(
  "deactivated unselected tab does not block selected mode",
  async (f) => {
    await add("PREORDER", "buyer", "v2");
    await add("IN_STOCK");
    f.sqlite.exec("UPDATE ProductVariant SET preorderEnabled=0 WHERE id='v2'");
    await create("IN_STOCK");
    assert.equal(count(f, "CartItem"), 1);
  },
);
for (const change of [
  "UPDATE ProductVariant SET preorderEnabled=0 WHERE id='v'",
  "UPDATE ProductVariant SET isActive=0 WHERE id='v'",
  "UPDATE Product SET status='DRAFT' WHERE id='p'",
  "UPDATE Category SET isActive=0 WHERE id='c'",
  "UPDATE Category SET requiresBuyerMeasurements=1 WHERE id='c'",
])
  scenario(`live PREORDER validation rejects ${change}`, async (f) => {
    await mixed();
    f.sqlite.exec(change);
    const before = rows(f, "CartItem");
    await assert.rejects(create("PREORDER"));
    assert.deepEqual(rows(f, "CartItem"), before);
    assert.equal(count(f, "CheckoutGroup"), 0);
    assert.equal(stock(f), 5);
  });
scenario(
  "IN_STOCK cannot use null legacy stock or depleted stock",
  async (f) => {
    await mixed();
    for (const value of ["NULL", "0"]) {
      f.sqlite.exec(`UPDATE ProductVariant SET stock=${value} WHERE id='v'`);
      await assert.rejects(create("IN_STOCK"));
    }
    assert.equal(count(f, "CheckoutGroup"), 0);
    assert.equal(count(f, "CartItem"), 2);
  },
);
scenario(
  "aggregate99 limit includes other tab even for direct corrupt cart writes",
  async (f) => {
    f.sqlite.exec("UPDATE ProductVariant SET stock=200 WHERE id='v'");
    await mixed();
    f.sqlite.exec("UPDATE CartItem SET quantity=99 WHERE saleMode='PREORDER'");
    for (const mode of ["IN_STOCK", "PREORDER"] as const)
      await assert.rejects(create(mode));
    assert.equal(stock(f), 200);
    assert.equal(count(f, "CheckoutOrder"), 0);
  },
);
scenario(
  "measurements and historical attribute snapshots remain immutable",
  async (f) => {
    f.sqlite.exec(
      "UPDATE Category SET requiresBuyerMeasurements=1 WHERE id='c'",
    );
    await new D1CartRepository().addItem("buyer", {
      productId: "p",
      variantId: "v",
      quantity: 1,
      saleMode: "IN_STOCK",
      heightCm: 170,
      weightKg: 60,
    });
    const g = await create("IN_STOCK"),
      snapshot = g.orders[0]!.items[0]!.snapshot;
    assert.equal(snapshot.heightCm, 170);
    assert.equal(snapshot.weightKg, 60);
    f.sqlite.exec("UPDATE Product SET nameRu='Changed' WHERE id='p'");
    assert.deepEqual(
      (await readCheckoutGroup("buyer", g.id)).orders[0]!.items[0]!.snapshot,
      snapshot,
    );
  },
);
scenario(
  "replay never consumes a new cart, key conflicts include mode and full intent",
  async (f) => {
    await mixed();
    const key = randomUUID(),
      g = await create("IN_STOCK", key);
    await add("IN_STOCK");
    const before = rows(f, "CartItem"),
      s = stock(f);
    assert.deepEqual(await create("IN_STOCK", key), g);
    await assert.rejects(create("PREORDER", key), { statusCode: 409 });
    await assert.rejects(
      create("IN_STOCK", key, { recipient: { ...recipient, city: "Changed" } }),
      { statusCode: 409 },
    );
    await assert.rejects(create("IN_STOCK", key, { promoCode: "DIFFERENT" }), {
      statusCode: 409,
    });
    assert.deepEqual(rows(f, "CartItem"), before);
    assert.equal(stock(f), s);
    assert.equal(count(f, "CheckoutGroup"), 1);
  },
);
scenario("PREORDER percent is part of idempotent intent", async () => {
  await add("PREORDER");
  const key = randomUUID();
  await create("PREORDER", key);
  await assert.rejects(create("PREORDER", key, { preorderPercent: 100 }), {
    statusCode: 409,
  });
});
scenario(
  "historical mixed entrypoint and selected entrypoint cannot replay each other",
  async () => {
    await mixed();
    const key = randomUUID(),
      g = await new LinkedCheckoutCommit(true).create("buyer", key, {
        recipient,
        preorderPercent: 50,
      });
    assert.equal(g.orders.length, 2);
    assert.equal(g.selectedSaleMode, null);
    await assert.rejects(create("PREORDER", key), { statusCode: 409 });
    assert.deepEqual(await readCheckoutGroup("buyer", g.id), g);
  },
);
scenario(
  "selected checkout is default-off and accepts exactly one mode and promo",
  async () => {
    await assert.rejects(
      new SaleModeCheckoutCommit().create("buyer", randomUUID(), {}),
      { statusCode: 503 },
    );
    for (const v of [
      {},
      { saleMode: "BOTH" },
      { saleMode: ["IN_STOCK", "PREORDER"] },
      { saleMode: "LEGACY" },
      { saleMode: "IN_STOCK", promoCodes: ["A", "B"] },
      { saleMode: "IN_STOCK", promoCode: ["AAA", "BBB"] },
      { saleMode: "IN_STOCK", discountAmount: 100 },
    ])
      await assert.rejects(
        new SaleModeCheckoutCommit(true, false).create("buyer", randomUUID(), {
          recipient,
          ...v,
        }),
        { statusCode: 400 },
      );
  },
);
scenario(
  "financial choices cannot silently add PREORDER percent to IN_STOCK",
  async () => {
    await add("IN_STOCK");
    await assert.rejects(
      create("IN_STOCK", randomUUID(), { preorderPercent: 50 }),
      { statusCode: 400 },
    );
  },
);
scenario(
  "new zero-priced orders rejected, historical zero contract remains readable",
  async (f) => {
    await mixed();
    f.sqlite.exec("UPDATE Product SET price=0 WHERE id='p'");
    await assert.rejects(create("IN_STOCK"), /positive/);
    await assert.rejects(create("PREORDER"), /positive/);
    assert.equal(count(f, "CheckoutGroup"), 0);
    assert.equal(stock(f), 5);
    const g = await new LinkedCheckoutCommit(true).create(
      "buyer",
      randomUUID(),
      { recipient, preorderPercent: 100 },
    );
    assert.equal(g.orders.length, 2);
    assert.equal((await readCheckoutGroup("buyer", g.id)).goodsTotal, 0);
  },
);

for (const pct of [90, 91, 95, 99])
  test(`v2 accepts ${pct}%, exact integer floor`, () => {
    assert.equal(parsePromoPolicy({ ...base, value: pct }).value, pct);
    const q = quote({ value: pct }, 101);
    assert.equal(q.valid, true);
    if (q.valid) {
      assert.equal(q.discountAmount, Number((101n * BigInt(pct)) / 100n));
      assert.ok(q.total > 0);
    }
    if (pct > 90)
      assert.throws(() => parsePromo({ ...base, value: pct }), {
        statusCode: 400,
      });
  });
for (const amount of [1, 2, 10, 100, 101])
  test(`99 percent and FIXED99 cap for tiny ${amount} UZS`, () => {
    const expected = Number((BigInt(amount) * 99n) / 100n);
    for (const p of [{ value: 99 }, { type: "FIXED", value: 2147483647 }]) {
      const q = quote(p, amount);
      assert.equal(q.valid, expected > 0);
      if (q.valid) {
        assert.equal(q.discountAmount, expected);
        assert.equal(q.total, amount - expected);
        assert.ok(q.total > 0);
      } else assert.equal(q.reason, "ZERO_DISCOUNT");
    }
  });
test("v2 rejects 0,100,fractions,overflow; FIXED cannot exceed99 percent or touch CARGO", () => {
  for (const value of [0, 100, 101, -1, 1.1, 2147483648])
    assert.throws(() => parsePromoPolicy({ ...base, value }), {
      statusCode: 400,
    });
  const q = quote({ type: "FIXED", value: 1000 }, 100);
  assert.ok(q.valid);
  if (q.valid) assert.equal(q.discountAmount, 99);
  assert.throws(
    () =>
      evaluatePromoPolicy(base, {
        userId: "buyer",
        now: 1,
        usage: { global: 0, account: 0 },
        lines: [],
        cargoAmount: 10,
      }),
    { statusCode: 400 },
  );
});
test("scopes, exclusions, PERSONAL/BLOGGER and sale-mode eligibility remain effective at99 percent", () => {
  const lines = [
    {
      lineId: "a",
      productId: "p",
      categoryId: "c",
      saleMode: "IN_STOCK",
      quantity: 1,
      unitPrice: 100,
    },
    {
      lineId: "b",
      productId: "p2",
      categoryId: "c2",
      saleMode: "PREORDER",
      quantity: 1,
      unitPrice: 200,
    },
  ];
  for (const policy of [
    { scope: "CATEGORIES", categoryIds: ["c"] },
    { scope: "PRODUCTS", productIds: ["p"] },
    { saleModes: "IN_STOCK" },
    { exclusions: [{ productId: "p2", saleModes: "PREORDER" }] },
  ]) {
    const q = quote(policy, 0, lines);
    assert.ok(q.valid);
    if (q.valid) {
      assert.equal(q.discountAmount, 99);
      assert.equal(q.eligibleSubtotal, 100);
    }
  }
  const pre = quote({ saleModes: "PREORDER" }, 0, lines);
  assert.ok(pre.valid);
  if (pre.valid) assert.equal(pre.discountAmount, 198);
  const all = quote({}, 0, lines);
  assert.ok(all.valid);
  if (all.valid) assert.equal(all.discountAmount, 297);
  assert.equal(
    quote({ audience: "PERSONAL", personalUserId: "other" }).valid,
    false,
  );
  assert.equal(
    quote({
      audience: "PERSONAL",
      personalUserId: "buyer",
      purpose: "COMPENSATION",
    }).valid,
    true,
  );
  assert.equal(
    quote({ audience: "BLOGGER", campaignId: "campaign" }).valid,
    true,
  );
  assert.equal(quote({ saleModes: "PREORDER" }).valid, false);
});

scenario(
  "v2 selected previews never claim quota; v2 commit remains blocked everywhere",
  async (f) => {
    await mixed();
    const owner = await f.auth("owner"),
      auth = await f.auth();
    const p = await f.foundation.create(owner, base);
    for (const mode of ["IN_STOCK", "PREORDER"] as const) {
      const q = await f.foundation.preview(auth, p.code, mode);
      assert.ok(q.valid);
      if (q.valid) {
        assert.equal(q.subtotal, 101);
        assert.equal(q.discountAmount, 99);
        assert.equal(q.executable, false);
      }
      await assert.rejects(create(mode, randomUUID(), { promoCode: p.code }), {
        statusCode: 409,
      });
    }
    assert.equal(count(f, "CheckoutGroup"), 0);
    assert.equal(count(f, "CheckoutPromoUse"), 0);
    assert.equal(await promoUsage(p.id), 0);
    assert.equal(count(f, "CartItem"), 2);
  },
);

for (const sameKey of [false, true])
  scenario(
    `parallel same tab, same key=${sameKey}: only one reserve`,
    async (f) => {
      await mixed();
      const key = randomUUID();
      const r = await Promise.allSettled([
        create("IN_STOCK", key),
        create("IN_STOCK", sameKey ? key : randomUUID()),
      ]);
      assert.equal(
        r.filter((x) => x.status === "fulfilled").length,
        sameKey ? 2 : 1,
      );
      if (
        sameKey &&
        r[0]!.status === "fulfilled" &&
        r[1]!.status === "fulfilled"
      )
        assert.equal(r[0]!.value.id, r[1]!.value.id);
      assert.equal(count(f, "CheckoutGroup"), 1);
      assert.equal(stock(f), 4);
      assert.equal(count(f, "CartItem"), 1);
    },
  );
scenario(
  "parallel different tabs commit independently and leave no duplicate or orphan",
  async (f) => {
    await mixed();
    const g = await Promise.all([create("IN_STOCK"), create("PREORDER")]);
    assert.notEqual(g[0].id, g[1].id);
    assert.equal(count(f, "CheckoutOrder"), 2);
    assert.equal(count(f, "CartItem"), 0);
    assert.equal(stock(f), 4);
  },
);
scenario(
  "two customers competing for last stock: exactly one succeeds",
  async (f) => {
    f.sqlite.exec("UPDATE ProductVariant SET stock=1 WHERE id='v'");
    await add("IN_STOCK");
    await add("IN_STOCK", "other");
    const r = await Promise.allSettled([
      create("IN_STOCK"),
      create("IN_STOCK", randomUUID(), {}, "other"),
    ]);
    assert.equal(r.filter((x) => x.status === "fulfilled").length, 1);
    assert.equal(stock(f), 0);
    assert.equal(count(f, "CheckoutOrder"), 1);
    assert.equal(count(f, "CartItem"), 1);
  },
);
scenario(
  "last legacy promo quota shared across two selected tab commits",
  async (f) => {
    await mixed();
    const p = await oldPromo({ usageLimit: 1 });
    const r = await Promise.allSettled([
      create("IN_STOCK", randomUUID(), { promoCode: p.code }),
      create("PREORDER", randomUUID(), { promoCode: p.code }),
    ]);
    assert.equal(r.filter((x) => x.status === "fulfilled").length, 1);
    assert.equal(await promoUsage(p.id), 1);
    assert.equal(count(f, "CheckoutGroup"), 1);
    assert.equal(count(f, "CartItem"), 1);
    assert.equal(count(f, "CheckoutPromoUse"), 1);
  },
);

// Mutate immediately before the guarded batch: the losing attempt must be re-read,
// never applied with its stale catalog, cart, promo or stock snapshot.
for (const [name, sql, success] of [
  ["price", "UPDATE Product SET price=205 WHERE id='p'", true],
  [
    "quantity",
    "UPDATE CartItem SET quantity=2 WHERE saleMode='IN_STOCK'",
    true,
  ],
  ["stock", "UPDATE ProductVariant SET stock=0 WHERE id='v'", false],
  [
    "preorder",
    "UPDATE ProductVariant SET preorderEnabled=0 WHERE id='v'",
    false,
  ],
  [
    "disabled promo",
    "UPDATE PromoCode SET isActive=0 WHERE code='OLD10'",
    false,
  ],
  ["expired promo", "UPDATE PromoCode SET endsAt=1 WHERE code='OLD10'", false],
] as const)
  scenario(`CAS revalidates ${name} before selected checkout`, async (f) => {
    await mixed();
    await oldPromo();
    let injected = false;
    const mode: Mode = name === "preorder" ? "PREORDER" : "IN_STOCK";
    const wrapped: Database = {
      prepare: (sql) => f.db.prepare(sql),
      batch: async (ss) => {
        if (
          !injected &&
          ss.some((s) =>
            (s as unknown as { sql: string }).sql.includes(
              "INSERT INTO CheckoutGroup(",
            ),
          )
        ) {
          injected = true;
          f.sqlite.exec(sql);
        }
        return f.db.batch(ss);
      },
    };
    const call = () =>
      withDatabase(wrapped, () =>
        create(mode, randomUUID(), { promoCode: "OLD10" }),
      );
    if (success) {
      const g = await call();
      assert.equal(g.goodsSubtotal, name === "price" ? 205 : 202);
      assert.equal(
        g.orders[0]!.items[0]!.quantity,
        name === "quantity" ? 2 : 1,
      );
      assert.equal(stock(f), name === "quantity" ? 3 : 4);
    } else {
      await assert.rejects(call());
      assert.equal(count(f, "CheckoutGroup"), 0);
      assert.equal(count(f, "CheckoutPromoUse"), 0);
      assert.equal(count(f, "CartItem"), 2);
    }
    assert.ok(injected);
  });
scenario(
  "CAS retries full cart read without deleting a newly inserted other-mode item",
  async (f) => {
    await add("IN_STOCK");
    let injected = false;
    const wrapped: Database = {
      prepare: (sql) => f.db.prepare(sql),
      batch: async (ss) => {
        if (
          !injected &&
          ss.some((s) =>
            (s as unknown as { sql: string }).sql.includes(
              "INSERT INTO CheckoutGroup(",
            ),
          )
        ) {
          injected = true;
          await f.run(() => add("PREORDER"));
        }
        return f.db.batch(ss);
      },
    };
    await withDatabase(wrapped, () => create("IN_STOCK"));
    assert.deepEqual(
      rows(f, "CartItem").map((r) => r.saleMode),
      ["PREORDER"],
    );
    assert.equal(stock(f), 4);
  },
);
for (const [table, event, when] of [
  ["CheckoutOrder", "INSERT", "1"],
  ["ProductVariant", "UPDATE", "NEW.stock<OLD.stock"],
  ["CheckoutPromoUse", "INSERT", "1"],
  ["CartItem", "DELETE", "1"],
  ["AuditLog", "INSERT", "NEW.action='checkout-group.create'"],
  ["CheckoutGroup", "UPDATE", "NEW.sealed=1"],
] as const)
  scenario(
    `batch rollback on ${table} ${event}: no partial order, reserve, promo or deletion`,
    async (f) => {
      await mixed();
      await oldPromo();
      const before = rows(f, "CartItem"),
        audit = count(f, "AuditLog");
      f.sqlite.exec(
        `CREATE TRIGGER injected BEFORE ${event} ON ${table} WHEN ${when} BEGIN SELECT RAISE(ABORT,'injected selected checkout failure'); END;`,
      );
      const key = randomUUID();
      await assert.rejects(
        create("IN_STOCK", key, { promoCode: "OLD10" }),
        /injected/,
      );
      for (const t of [
        "CheckoutGroup",
        "CheckoutOrder",
        "CheckoutOrderItem",
        "CheckoutPromoUse",
      ])
        assert.equal(count(f, t), 0, t);
      assert.deepEqual(rows(f, "CartItem"), before);
      assert.equal(stock(f), 5);
      assert.equal(count(f, "AuditLog"), audit);
      f.sqlite.exec("DROP TRIGGER injected");
      await create("IN_STOCK", key, { promoCode: "OLD10" });
      assert.equal(stock(f), 4);
    },
  );

for (const percent of [50, 100] as const)
  scenario(
    `selected PREORDER FIRST${percent}, CARGO, FINAL${percent === 100 ? "0" : " remainder"} and immutable history`,
    async (f) => {
      await mixed();
      const g = await create("PREORDER", randomUUID(), {
          preorderPercent: percent,
        }),
        o = g.orders[0]!;
      const { auth, owner } = await pay(f, o);
      await f.preorder.arrive(owner, o.id, randomUUID(), {
        arrivedAt: new Date().toISOString(),
        items: o.items.map((i) => ({ itemId: i.id, quantity: i.quantity })),
      });
      const cargo = percent === 100 ? 0 : 17;
      await f.preorder.assignCargo(owner, o.id, randomUUID(), {
        amount: cargo,
      });
      const invoice = await f.preorder.issueInvoice(owner, o.id, randomUUID());
      assert.equal(invoice.invoice!.totalDue, percent === 100 ? 0 : 67);
      if (percent === 50) {
        const p = await f.payments.submitFinal(
          auth,
          o.id,
          randomUUID(),
          { declaredAmount: 67 },
          proof(),
        );
        await f.payments.review(owner, p.payment.id, randomUUID(), {
          decision: "APPROVE",
          confirmedAmount: 67,
          bankOperationReference: randomUUID(),
        });
      }
      const after = (await readCheckoutGroup("buyer", g.id)).orders[0]!;
      assert.equal(after.goodsPaid, 101);
      assert.equal(after.cargoPaid, cargo);
      assert.equal(after.unpaidGoods, 0);
      assert.deepEqual(after.financialPolicy, o.financialPolicy);
      assert.deepEqual(after.items, o.items);
      assert.equal(stock(f), 5);
      assert.equal(count(f, "CartItem"), 1);
      assert.equal(count(f, "CheckoutPaymentLedger"), percent === 100 ? 1 : 2);
    },
  );
for (const mode of ["IN_STOCK", "PREORDER"] as const)
  scenario(
    `selected ${mode}: unpaid cancel replays once, retains other tab and promo history`,
    async (f) => {
      await mixed();
      const promo = await oldPromo();
      const g = await create(mode, randomUUID(), { promoCode: promo.code }),
        o = g.orders[0]!;
      const other = rows(f, "CartItem"),
        owner = await f.auth("owner"),
        key = randomUUID(),
        value = { reason: "Synthetic cancellation" };
      const c = await f.cancellations.cancel(owner, o.id, key, value);
      assert.deepEqual(
        await f.cancellations.cancel(owner, o.id, key, value),
        c,
      );
      assert.equal(stock(f), 5);
      assert.deepEqual(rows(f, "CartItem"), other);
      assert.equal(await promoUsage(promo.id), 1);
      assert.equal(
        (await readCheckoutGroup("buyer", g.id)).orders[0]!.orderState,
        "CANCELLED",
      );
    },
  );
scenario(
  "selected paid IN_STOCK: owner-only refund, actual money ledger, stock released once",
  async (f) => {
    await mixed();
    const g = await create("IN_STOCK"),
      o = g.orders[0]!,
      { auth, owner, p } = await pay(f, o),
      reason = { reason: "Synthetic refund" };
    await assert.rejects(f.refunds.request(auth, o.id, randomUUID(), reason), {
      statusCode: 403,
    });
    const request = await f.refunds.request(owner, o.id, randomUUID(), reason);
    assert.equal(request.refund.status, "REQUESTED");
    const key = randomUUID(),
      transfer = {
        confirmedAmount: 101,
        bankOperationReference: randomUUID(),
        bankTransferVerified: true,
      };
    const done = await f.refunds.confirm(
      owner,
      request.refund.id,
      key,
      transfer,
    );
    assert.equal(done.refund.status, "COMPLETED");
    assert.deepEqual(
      await f.refunds.confirm(owner, request.refund.id, key, transfer),
      done,
    );
    assert.equal(stock(f), 5);
    assert.equal(count(f, "CartItem"), 1);
    assert.equal(count(f, "CheckoutRefundLedger"), 1);
    const after = (await readCheckoutGroup("buyer", g.id)).orders[0]!;
    assert.equal(after.orderState, "CANCELLED_REFUNDED");
    assert.equal(after.netGoodsReceived, 0);
    assert.deepEqual(after.items, o.items);
    assert.equal(count(f, "CheckoutPaymentLedger"), 1);
    await assert.rejects(
      f.payments.review(owner, p.payment.id, randomUUID(), {
        decision: "APPROVE",
        confirmedAmount: 101,
        bankOperationReference: randomUUID(),
      }),
      { statusCode: 409 },
    );
  },
);

// Preserve populated parent rows, both kinds of quota children, v2 policy scope and
// historical mixed money/snapshots. No FK disabling or destructive renaming.
async function upgradeData(f: ReturnType<typeof services>) {
  const p = await oldPromo({ usageLimit: 10, perUserLimit: 10 });
  await add("LEGACY");
  const legacy = await new D1OrderRepository().checkout({
    userId: "buyer",
    publicId: "STZ-SYNTHETIC-LEGACY",
    idempotencyKey: randomUUID(),
    recipient,
    promoCode: p.code,
    prepare: prepareOrder,
  });
  await mixed();
  const mixedGroup = await new LinkedCheckoutCommit(true).create(
    "buyer",
    randomUUID(),
    { recipient, preorderPercent: 100, promoCode: p.code },
  );
  const ready = mixedGroup.orders.find((o) => o.saleMode === "IN_STOCK")!;
  const pre = mixedGroup.orders.find((o) => o.saleMode === "PREORDER")!;
  const { owner } = await pay(f, pre);
  await f.preorder.arrive(owner, pre.id, randomUUID(), {
    arrivedAt: new Date().toISOString(),
    items: pre.items.map((i) => ({ itemId: i.id, quantity: i.quantity })),
  });
  await f.preorder.assignCargo(owner, pre.id, randomUUID(), { amount: 0 });
  await f.preorder.issueInvoice(owner, pre.id, randomUUID());
  await pay(f, ready);
  const refund = await f.refunds.request(owner, ready.id, randomUUID(), {
    reason: "Synthetic historical refund",
  });
  await f.refunds.confirm(owner, refund.refund.id, randomUUID(), {
    confirmedAmount: ready.firstPaymentAmount,
    bankOperationReference: randomUUID(),
    bankTransferVerified: true,
  });
  await add("IN_STOCK");
  const unpaid = await new LinkedCheckoutCommit(true).create(
    "buyer",
    randomUUID(),
    { recipient },
  );
  await f.cancellations.cancel(owner, unpaid.orders[0]!.id, randomUUID(), {
    reason: "Synthetic historical cancellation",
  });
  const historical = await readCheckoutGroup("buyer", mixedGroup.id);
  const policy = await f.foundation.create(await f.auth("owner"), {
    ...base,
    code: "BEFORE-UPGRADE",
    value: 90,
    scope: "CATEGORIES",
    categoryIds: ["c"],
    exclusions: [{ productId: "p", saleModes: "PREORDER" }],
  });
  return { legacy, historical, policy, p };
}
test("0027 populated SQLite upgrade preserves all FKs, quota/history, parent triggers and rollback", async () => {
  const f = fixture("0026");
  try {
    await f.run(async () => {
      const d = await upgradeData(f);
      const tables = [
        "PromoCode",
        "PromoCodeRedemption",
        "CheckoutPromoUse",
        "PromoCodePolicy",
        "PromoPolicyCategory",
        "PromoPolicyExclusion",
        "Order",
        "CheckoutOrder",
        "CheckoutOrderItem",
        "CheckoutPayment",
        "CheckoutPaymentLedger",
        "CheckoutFinalInvoice",
        "CheckoutRefund",
        "CheckoutRefundLedger",
        "CheckoutCancellation",
      ];
      const before = tables.map((t) => rows(f, t));
      const triggers = f.sqlite
        .prepare(
          "SELECT name,sql FROM sqlite_master WHERE type='trigger' AND tbl_name='PromoCode' ORDER BY name",
        )
        .all();
      f.sqlite.exec("BEGIN IMMEDIATE");
      try {
        f.sqlite.exec(migration());
        f.sqlite.exec("SELECT * FROM injected_missing_upgrade");
        assert.fail("injection must fail");
      } catch {
        f.sqlite.exec("ROLLBACK");
      }
      assert.deepEqual(
        tables.map((t) => rows(f, t)),
        before,
      );
      assert.equal(
        f.sqlite
          .prepare("PRAGMA table_info(CheckoutGroup)")
          .all()
          .some((r) => r.name === "selectedSaleMode"),
        false,
      );
      f.sqlite.exec("BEGIN IMMEDIATE");
      f.sqlite.exec(migration());
      f.sqlite.exec("COMMIT");
      assert.deepEqual(
        tables.map((t) => rows(f, t)),
        before,
      );
      assert.deepEqual(
        f.sqlite
          .prepare(
            "SELECT name,sql FROM sqlite_master WHERE type='trigger' AND tbl_name='PromoCode' ORDER BY name",
          )
          .all(),
        triggers,
      );
      const after = await readCheckoutGroup("buyer", d.historical.id),
        { selectedSaleMode, ...oldContract } = after;
      assert.equal(selectedSaleMode, null);
      assert.deepEqual(oldContract, d.historical);
      assert.equal(await promoUsage(d.p.id), 2);
      assert.deepEqual(f.sqlite.prepare("PRAGMA foreign_key_check").all(), []);
      assert.equal(
        f.sqlite.prepare("PRAGMA integrity_check").get()!.integrity_check,
        "ok",
      );
      assert.equal(
        f.sqlite.prepare("PRAGMA foreign_keys").get()!.foreign_keys,
        1,
      );
      const revision = () =>
        f.sqlite.prepare("SELECT version FROM _Revision WHERE id=1").get()!
          .version as number;
      const r = revision();
      await oldPromo({ code: "AFTER", value: 90 });
      assert.ok(revision() > r);
      await assert.rejects(oldPromo({ code: "BAD91", value: 91 }), {
        statusCode: 400,
      });
      await f.foundation.create(await f.auth("owner"), base);
      for (const [version, value] of [
        [1, 91],
        [2, 100],
      ])
        assert.throws(
          () =>
            f.sqlite
              .prepare(
                "INSERT INTO PromoCode(id,code,type,value,engineVersion,createdAt,updatedAt) VALUES(?,?,'PERCENT',?,?,1,1)",
              )
              .run(randomUUID(), "SQL" + value, value, version),
          /CHECK/,
        );
      assert.throws(
        () =>
          f.sqlite
            .prepare("UPDATE PromoCode SET engineVersion=2 WHERE id=?")
            .run(d.p.id),
        /immutable/,
      );
      assert.throws(
        () =>
          f.sqlite.prepare("DELETE FROM PromoCode WHERE id=?").run(d.policy.id),
        /immutable/,
      );
    });
  } finally {
    f.sqlite.close();
  }
});

scenario(
  "SQL contract rejects wrong mode, second order, zero prices and selection downgrade",
  async (f) => {
    await add("IN_STOCK");
    const g = await create("IN_STOCK");
    const insert = (table: string, row: Record<string, unknown>) =>
      f.sqlite
        .prepare(
          `INSERT INTO "${table}"(${Object.keys(row)
            .map((k) => `"${k}"`)
            .join(",")}) VALUES(${Object.keys(row)
            .map(() => "?")
            .join(",")})`,
        )
        .run(...(Object.values(row) as never[]));
    const original = rows(f, "CheckoutGroup")[0]!;
    assert.throws(
      () =>
        insert("CheckoutGroup", {
          ...original,
          id: randomUUID(),
          idempotencyKey: randomUUID(),
          sealed: 0,
          goodsSubtotal: 0,
          goodsTotal: 0,
        }),
      /positive/,
    );
    const id = randomUUID();
    insert("CheckoutGroup", {
      ...original,
      id,
      idempotencyKey: randomUUID(),
      sealed: 0,
    });
    assert.throws(
      () =>
        f.sqlite
          .prepare("UPDATE CheckoutGroup SET selectedSaleMode=NULL WHERE id=?")
          .run(id),
      /immutable|seal/,
    );
    const o = rows(f, "CheckoutOrder")[0]!;
    const wrong = {
      ...o,
      id: randomUUID(),
      publicId: randomUUID(),
      checkoutGroupId: id,
      saleMode: "PREORDER",
      financialPolicy: JSON.stringify({
        ...g.orders[0]!.financialPolicy,
        version: 1,
        saleMode: "PREORDER",
      }),
    };
    assert.throws(() => insert("CheckoutOrder", wrong), /selected-mode/);
    const orderId = randomUUID();
    insert("CheckoutOrder", {
      ...o,
      id: orderId,
      publicId: randomUUID(),
      checkoutGroupId: id,
    });
    assert.throws(() => insert("CheckoutOrder", wrong), /selected-mode/);
    const item = rows(f, "CheckoutOrderItem")[0]!;
    assert.throws(
      () =>
        insert("CheckoutOrderItem", {
          ...item,
          id: randomUUID(),
          orderId,
          unitPrice: 0,
          lineTotal: 0,
          snapshot: JSON.stringify({
            ...g.orders[0]!.items[0]!.snapshot,
            unitPrice: 0,
            lineTotal: 0,
          }),
        }),
      /positive/,
    );
    // This deliberately unsealed synthetic group never represents a committed checkout.
    assert.throws(
      () =>
        f.sqlite
          .prepare("UPDATE CheckoutGroup SET sealed=1 WHERE id=?")
          .run(id),
      /incomplete/,
    );
  },
);
for (const mode of ["IN_STOCK", "PREORDER"] as const)
  scenario(
    `minimum 1 UZS ${mode} creates FIRST1 without fake zero receipt`,
    async (f) => {
      f.sqlite.exec("UPDATE Product SET price=1 WHERE id='p'");
      await add(mode);
      const g = await create(mode),
        o = g.orders[0]!;
      assert.equal(o.goodsTotal, 1);
      assert.equal(o.firstPaymentAmount, 1);
      assert.equal(count(f, "CheckoutPaymentLedger"), 0);
      await assert.rejects(
        f.payments.submit(
          await f.auth(),
          o.id,
          randomUUID(),
          { declaredAmount: 0 },
          proof(),
        ),
        { statusCode: 400 },
      );
    },
  );

test("0027 actual Miniflare populated upgrade, atomic rollback, selected checkout and no public routes/outbound", async () => {
  const f = await marketingRuntime("1", "0026");
  try {
    await f.db.exec(seed);
    const s = services(),
      buyer = await runtimeUser(f, 900141);
    await withDatabase(f.db as unknown as Database, async () => {
      const d = await upgradeData(s);
      const read = async (table: string) =>
        (await f.db.prepare(`SELECT * FROM "${table}" ORDER BY rowid`).all())
          .results;
      const tables = [
        "PromoCode",
        "PromoCodeRedemption",
        "CheckoutPromoUse",
        "PromoCodePolicy",
        "PromoPolicyCategory",
        "CheckoutOrder",
        "CheckoutOrderItem",
        "CheckoutPayment",
        "CheckoutPaymentLedger",
        "CheckoutFinalInvoice",
        "CheckoutRefund",
        "CheckoutRefundLedger",
        "CheckoutCancellation",
      ];
      const before = await Promise.all(tables.map(read));
      await assert.rejects(
        f.db.batch([
          ...statements().map((sql) => f.db.prepare(sql)),
          f.db.prepare("SELECT * FROM injected_missing_upgrade"),
        ]),
      );
      assert.deepEqual(await Promise.all(tables.map(read)), before);
      await f.db.batch(statements().map((sql) => f.db.prepare(sql)));
      assert.deepEqual(await Promise.all(tables.map(read)), before);
      const { selectedSaleMode, ...historical } = await readCheckoutGroup(
        "buyer",
        d.historical.id,
      );
      assert.equal(selectedSaleMode, null);
      assert.deepEqual(historical, d.historical);
      await s.foundation.create(await s.auth("owner"), base);
      await mixed();
      const g = await create("IN_STOCK");
      assert.equal(g.orders.length, 1);
      assert.deepEqual(
        (await read("CartItem")).map((i) => i.saleMode),
        ["PREORDER"],
      );
      const { owner } = await pay(s, g.orders[0]!);
      assert.ok(owner);
      assert.deepEqual(
        (await f.db.prepare("PRAGMA foreign_key_check").all()).results,
        [],
      );
      assert.equal(
        (await f.db
          .prepare("PRAGMA quick_check")
          .first<{ quick_check: string }>())!.quick_check,
        "ok",
      );
    });
    for (const path of [
      "/checkout/sale-mode",
      "/checkout-groups",
      "/checkout/selected",
      "/admin/checkout/sale-mode",
    ])
      for (const role of ["anonymous", "buyer", "admin"]) {
        const r = await f.call(
          path,
          "POST",
          { saleMode: "IN_STOCK", recipient },
          role === "admin"
            ? f.signed
            : role === "buyer"
              ? { authorization: "Bearer " + buyer.token }
              : {},
          role === "admin"
            ? "https://admin.preview.invalid"
            : "https://preview.invalid",
        );
        assert.ok(
          [403, 404].includes(r.status),
          `${path} ${role}: ${r.status}`,
        );
      }
    assert.equal(f.outboundCalls(), 0);
  } finally {
    await f.mf.dispose();
  }
});
