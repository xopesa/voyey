import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { withDatabase, type Database } from "@stenzo/database";
import { isolatedD1 } from "./helpers/sqlite.js";
import { marketingRuntime } from "./helpers/marketing-runtime.js";
import { runtimeUser } from "./helpers/customer-operations.js";
import { png } from "../../api/tests/fixtures/images.js";
import { PromoFoundation } from "../../api/src/modules/marketing/promo-foundation.js";
import {
  evaluatePromoPolicy,
  parsePromoPolicy,
  promoKind,
} from "../../api/src/modules/marketing/promo-policy.js";
import {
  promoForCheckout,
  promoUsage,
} from "../../api/src/modules/marketing/promo-codes.js";
import { D1OrderRepository } from "../../api/src/d1/repositories.js";
import { prepareOrder } from "../../api/src/modules/checkout/domain.js";
import { D1CartRepository } from "../../api/src/d1/repositories.js";
import { LinkedCheckoutCommit } from "../../api/src/modules/checkout/group-commit.js";
import { readCheckoutGroup } from "../../api/src/modules/checkout/group-store.js";
import { LinkedCheckoutPayments } from "../../api/src/modules/checkout/linked-payments.js";
import { PreorderFinance } from "../../api/src/modules/checkout/preorder-finance.js";
import { VoyeyOwnerAuthority } from "../../api/src/modules/admin/owner.js";
import { JwtTokenService } from "../../api/src/modules/auth/token.js";
import { PromoCodeService } from "../../api/src/modules/marketing/promo-codes.js";
import { LinkedCheckoutRefunds } from "../../api/src/modules/checkout/refunds.js";
import { LinkedCheckoutCancellations } from "../../api/src/modules/checkout/cancellations.js";
import { readOrderFinance } from "../../api/src/modules/checkout/payment-state.js";
import { LifecycleService } from "../../api/src/modules/admin/lifecycle.js";
import { RefundService } from "../../api/src/modules/admin/refunds.js";
import { WEB_ADMIN_ACTOR } from "../../api/src/modules/admin/web-session.js";

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
const card = {
  cardNumber: "ISOLATED",
  cardHolder: "ISOLATED",
  instructionsRu: "ISOLATED",
  instructionsUz: "ISOLATED",
};
const proof = () => ({ data: Buffer.from(png), declaredMimeType: "image/png" });
const decision = (
  amount: number,
  bankOperationReference: string = randomUUID(),
) => ({ decision: "APPROVE", confirmedAmount: amount, bankOperationReference });
const migration = () =>
  readFileSync(
    new URL("../migrations/0026_promo_policy_foundation.sql", import.meta.url),
    "utf8",
  )
    .split(/;\r?\n/)
    .map((sql) => sql.trim())
    .filter(Boolean);
function fixture(through = "9999") {
  const f = isolatedD1(through);
  f.sqlite.exec(seed);
  const tokens = new JwtTokenService(randomBytes(32).toString("hex")),
    config = { owner: "900143" },
    owner = new VoyeyOwnerAuthority(tokens, () => config.owner);
  return {
    ...f,
    tokens,
    config,
    owner,
    payments: new LinkedCheckoutPayments(owner, true, card),
    preorder: new PreorderFinance(owner, true),
    cancellations: new LinkedCheckoutCancellations(owner, true),
    refunds: new LinkedCheckoutRefunds(owner, true),
    foundation: new PromoFoundation(owner, true),
    auth: async (id = "buyer") => "Bearer " + (await tokens.issue(id)),
  };
}
type Fixture = ReturnType<typeof fixture>;
const count = (f: Fixture, table: string) =>
  (f.sqlite.prepare(`SELECT COUNT(*) n FROM "${table}"`).get() as { n: number })
    .n;
async function group(
  modes: ("IN_STOCK" | "PREORDER")[] = ["PREORDER"],
  percent: 50 | 100 = 50,
  extraVariant = false,
  promoCode?: string,
) {
  const cart = new D1CartRepository();
  for (const saleMode of modes) {
    await cart.addItem("buyer", {
      productId: "p",
      variantId: "v",
      quantity: 1,
      heightCm: null,
      weightKg: null,
      saleMode,
    });
    if (extraVariant)
      await cart.addItem("buyer", {
        productId: "p",
        variantId: "v2",
        quantity: 2,
        heightCm: null,
        weightKg: null,
        saleMode,
      });
  }
  return new LinkedCheckoutCommit(true).create("buyer", randomUUID(), {
    recipient,
    ...(modes.includes("PREORDER") ? { preorderPercent: percent } : {}),
    ...(promoCode ? { promoCode } : {}),
  });
}
async function first(
  f: Fixture,
  percent: 50 | 100 = 50,
  extraVariant = false,
  paid = true,
) {
  const g = await group(["PREORDER"], percent, extraVariant),
    o = g.orders[0]!,
    auth = await f.auth(),
    owner = await f.auth("owner");
  const payment = await f.payments.submit(
      auth,
      o.id,
      randomUUID(),
      { declaredAmount: o.firstPaymentAmount },
      proof(),
    ),
    reviewKey = randomUUID(),
    review = decision(o.firstPaymentAmount);
  if (paid)
    await f.payments.review(owner, payment.payment.id, reviewKey, review);
  return { group: g, order: o, auth, owner, payment, reviewKey, review };
}
type PreparedFirst = Awaited<ReturnType<typeof first>>;
const arrival = (s: PreparedFirst) => ({
  arrivedAt: new Date().toISOString(),
  items: s.order.items.map((item) => ({
    itemId: item.id,
    quantity: item.quantity,
  })),
});
async function invoice(f: Fixture, percent: 50 | 100 = 50, cargo = 17) {
  const s = await first(f, percent);
  await f.preorder.arrive(s.owner, s.order.id, randomUUID(), arrival(s));
  await f.preorder.assignCargo(s.owner, s.order.id, randomUUID(), {
    amount: cargo,
  });
  const key = randomUUID(),
    snapshot = await f.preorder.issueInvoice(s.owner, s.order.id, key);
  return { ...s, snapshot, invoiceKey: key };
}
async function submittedFinal(f: Fixture, percent: 50 | 100 = 50, cargo = 17) {
  const s = await invoice(f, percent, cargo),
    due = s.snapshot.invoice!.totalDue;
  return {
    ...s,
    final: await f.payments.submitFinal(
      s.auth,
      s.order.id,
      randomUUID(),
      { declaredAmount: due },
      proof(),
    ),
  };
}

const now = Date.parse("2026-10-23T12:00:00Z");
const base = {
  code: "VOYEY-10",
  type: "PERCENT",
  value: 10,
  isActive: true,
  perUserLimit: 2,
};
const line = (
  lineId = "stock",
  productId = "p",
  categoryId = "c",
  saleMode: "IN_STOCK" | "PREORDER" = "IN_STOCK",
  unitPrice = 101,
) => ({ lineId, productId, categoryId, saleMode, unitPrice, quantity: 1 });
const context = (
  lines = [line(), line("pre", "p", "c", "PREORDER")],
  usage = { global: 0, account: 0 },
  userId = "buyer",
) => ({ userId, now, usage, lines });
const quote = (p: unknown = base, c: unknown = context()) =>
  evaluatePromoPolicy(p, c);
const valid = (p: unknown = base, c: unknown = context()) => {
  const q = quote(p, c);
  assert.equal(q.valid, true);
  if (!q.valid) throw new Error("Expected eligible quote");
  return q;
};
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
const rows = (f: Fixture, t: string) =>
  f.sqlite
    .prepare(`SELECT * FROM "${t}" ORDER BY rowid`)
    .all()
    .map((r) => ({ ...r }));
const create = async (f: Fixture, value: unknown = base) =>
  f.foundation.create(await f.auth("owner"), value);
for (const [kind, config, expected] of [
  ["IN_STOCK", { saleModes: "IN_STOCK" }, 101],
  ["PREORDER", { saleModes: "PREORDER" }, 101],
  ["UNIVERSAL", { saleModes: "BOTH" }, 202],
  [
    "PERSONAL",
    { audience: "PERSONAL", personalUserId: "buyer", saleModes: "PREORDER" },
    101,
  ],
  [
    "BLOGGER",
    { audience: "BLOGGER", campaignId: "campaign", saleModes: "IN_STOCK" },
    101,
  ],
] as const)
  test(`${kind} separates audience and sale modes`, () => {
    const p = { ...base, ...config },
      q = valid(p);
    assert.equal(promoKind(parsePromoPolicy(p)), kind);
    assert.equal(q.kind, kind);
    assert.equal(q.eligibleSubtotal, expected);
    assert.equal(q.discountAmount, Math.floor(expected / 10));
    assert.equal(q.executable, false);
    if (kind === "BLOGGER") assert.equal(q.campaignId, "campaign");
  });
for (const modes of ["IN_STOCK", "PREORDER", "BOTH"] as const)
  test(`PERSONAL/BLOGGER support independent saleModes=${modes}`, () => {
    for (const audience of ["PERSONAL", "BLOGGER"] as const) {
      const q = valid({
        ...base,
        audience,
        saleModes: modes,
        ...(audience === "PERSONAL"
          ? { personalUserId: "buyer" }
          : { campaignId: "campaign" }),
      });
      assert.equal(q.eligibleSubtotal, modes === "BOTH" ? 202 : 101);
    }
  });
test("PERSONAL only the assigned internal account; compensation must be PERSONAL", () => {
  assert.deepEqual(
    quote({ ...base, audience: "PERSONAL", personalUserId: "other" }),
    {
      valid: false,
      version: 2,
      executable: false,
      reason: "PERSONAL_MISMATCH",
    },
  );
  assert.throws(() => parsePromoPolicy({ ...base, purpose: "COMPENSATION" }), {
    statusCode: 400,
  });
  assert.equal(
    valid({
      ...base,
      purpose: "COMPENSATION",
      audience: "PERSONAL",
      personalUserId: "buyer",
    }).kind,
    "PERSONAL",
  );
  for (const input of [
    { ...base, audience: "PERSONAL" },
    { ...base, audience: "BLOGGER" },
    { ...base, personalUserId: "buyer" },
    { ...base, campaignId: "c" },
    {
      ...base,
      audience: "PERSONAL",
      personalUserId: "buyer",
      telegramId: "900141",
    },
  ])
    assert.throws(() => parsePromoPolicy(input), { statusCode: 400 });
});
test("PERCENT integer floor/cap and FIXED capped by eligible goods, never negative", () => {
  assert.equal(valid().discountAmount, 20);
  assert.equal(valid({ ...base, maxDiscount: 7 }).discountAmount, 7);
  const fixed = valid({
    ...base,
    type: "FIXED",
    value: 999,
    saleModes: "PREORDER",
  });
  assert.equal(fixed.discountAmount, 99);
  assert.equal(fixed.total, 103);
  assert.equal(
    fixed.allocationProposal.find((g) => g.key === "IN_STOCK")!.discount,
    0,
  );
  const zero = valid({ ...base, type: "FIXED", value: 202 });
  assert.equal(zero.total, 3);
  assert.equal(zero.discountAmount, 199);
  assert.equal(
    quote({ ...base, value: 1 }, context([line("a", "p", "c", "IN_STOCK", 1)]))
      .valid,
    false,
  );
});
test("minimum applies to eligible goods before discount, not whole cart", () => {
  const c = context([line(), line("large", "p2", "c2", "PREORDER", 5000)]);
  const p = { ...base, saleModes: "IN_STOCK", minOrderAmount: 102 };
  assert.equal(quote(p, c).valid, false);
  assert.equal((quote(p, c) as { reason: string }).reason, "MINIMUM");
  assert.equal(valid({ ...p, minOrderAmount: 101 }, c).discountAmount, 10);
});
for (const [name, usage, config, reason] of [
  ["global", { global: 3, account: 0 }, { usageLimit: 3 }, "LIMIT"],
  [
    "account",
    { global: 3, account: 2 },
    { usageLimit: 10, perUserLimit: 2 },
    "USER_LIMIT",
  ],
] as const)
  test(`individually configured ${name} usage limit`, () =>
    assert.equal(
      (
        quote({ ...base, ...config }, context(undefined, usage)) as {
          reason: string;
        }
      ).reason,
      reason,
    ));
test("dates are start-inclusive/end-exclusive, disabled/empty cart have no quote", () => {
  const start = new Date(now).toISOString(),
    end = new Date(now + 1).toISOString();
  assert.equal(
    valid({ ...base, startsAt: start, endsAt: end }).discountAmount,
    20,
  );
  for (const [p, reason] of [
    [{ ...base, isActive: false }, "INACTIVE"],
    [{ ...base, startsAt: end }, "NOT_STARTED"],
    [{ ...base, endsAt: start }, "EXPIRED"],
  ] as const)
    assert.equal((quote(p) as { reason: string }).reason, reason);
  assert.equal(
    (quote(base, context([])) as { reason: string }).reason,
    "EMPTY_CART",
  );
});
for (const scope of ["CATEGORIES", "PRODUCTS"] as const)
  test(`${scope} uses exact server IDs, not titles or SKU`, () => {
    const config = {
      ...base,
      scope,
      ...(scope === "CATEGORIES"
        ? { categoryIds: ["c"] }
        : { productIds: ["p"] }),
    };
    const q = valid(
      config,
      context([
        line("a"),
        line("sku2"),
        line("outside", "p2", "c2", "PREORDER", 1000),
      ]),
    );
    assert.equal(q.eligibleSubtotal, 202);
    assert.equal(q.lines[0]!.eligible, true);
    assert.equal(q.lines[1]!.eligible, true);
    assert.equal(q.lines[2]!.eligible, false);
  });
for (const saleModes of ["IN_STOCK", "PREORDER", "BOTH"] as const)
  test(`exclusion ${saleModes} overrides category and affects all Product SKUs`, () => {
    const c = context([
      line("sku1"),
      line("sku2"),
      line("pre", "p", "c", "PREORDER"),
      line("other", "p2", "c", "IN_STOCK"),
    ]);
    const q = valid(
      {
        ...base,
        scope: "CATEGORIES",
        categoryIds: ["c"],
        exclusions: [{ productId: "p", saleModes }],
      },
      c,
    );
    assert.equal(
      q.eligibleSubtotal,
      saleModes === "IN_STOCK" ? 202 : saleModes === "PREORDER" ? 303 : 101,
    );
  });
test("mixed FIXED allocation is a deterministic proposal only, preserves sum and eligible-mode bounds", () => {
  const q = valid(
    { ...base, type: "FIXED", value: 3 },
    context([
      line("a", "p", "c", "IN_STOCK", 101),
      line("b", "p2", "c", "PREORDER", 100),
    ]),
  );
  assert.equal(
    q.allocationProposal.reduce((n, g) => n + g.discount, 0),
    3,
  );
  assert.deepEqual(
    q,
    valid(
      { ...base, type: "FIXED", value: 3 },
      context([
        line("a", "p", "c", "IN_STOCK", 101),
        line("b", "p2", "c", "PREORDER", 100),
      ]),
    ),
  );
  assert.equal(
    q.allocationPolicy,
    "PROPOSAL_ELIGIBLE_SUBTOTAL_LARGEST_REMAINDER_V1",
  );
  assert.equal(q.executable, false);
});
test("CARGO/local delivery excluded structurally, integer boundary/overflow/input forgery rejected", () => {
  const q = valid(
    { ...base, value: 90 },
    context([line("max", "p", "c", "IN_STOCK", 2147483647)]),
  );
  assert.equal(q.discountAmount, 1932735282);
  assert.equal(q.total, 214748365);
  for (const c of [
    { ...context(), cargoAmount: 100 },
    { ...context(), localDelivery: 100 },
    context([line(), line()]),
    context([line("a", "p", "c", "IN_STOCK", 2147483647), line("b")]),
    context([{ ...line(), quantity: 99, unitPrice: 2147483647 }]),
    context(undefined, { global: 0, account: 1 }),
  ])
    assert.throws(() => quote(base, c), { statusCode: 400 });
  for (const p of [
    { ...base, value: -1 },
    { ...base, value: 1.5 },
    { ...base, value: 100 },
    { ...base, type: "FIXED", maxDiscount: 1 },
    { ...base, scope: "CATEGORIES" },
    { ...base, scope: "ALL", productIds: ["p"] },
    { ...base, productIds: ["p", "p"], scope: "PRODUCTS" },
    {
      ...base,
      exclusions: [
        { productId: "p", saleModes: "BOTH" },
        { productId: "p", saleModes: "IN_STOCK" },
      ],
    },
    { ...base, startsAt: "bad" },
    { ...base, usageLimit: 0 },
  ])
    assert.throws(() => quote(p), { statusCode: 400 });
});
scenario(
  "internal create uses existing identity, normalized unique namespace and owner configuration; no quota writes",
  async (f) => {
    const p = await create(f, { ...base, code: "  voyey-10  " });
    assert.equal(p.code, "VOYEY-10");
    assert.equal(p.executable, false);
    assert.equal(count(f, "PromoCode"), 1);
    assert.equal(count(f, "PromoCodePolicy"), 1);
    await assert.rejects(create(f), { statusCode: 409 });
    await assert.rejects(new PromoCodeService().save(WEB_ADMIN_ACTOR, base), {
      statusCode: 409,
    });
    assert.equal(count(f, "CheckoutPromoUse"), 0);
    assert.equal(count(f, "PromoCodeRedemption"), 0);
    await new PromoCodeService().save(WEB_ADMIN_ACTOR, {
      ...base,
      code: "LEGACY",
    });
    await assert.rejects(create(f, { ...base, code: "legacy" }), {
      statusCode: 409,
    });
    assert.equal((await new PromoCodeService().list()).length, 1);
    assert.throws(
      () =>
        f.sqlite
          .prepare("UPDATE PromoCode SET engineVersion=2 WHERE code='LEGACY'")
          .run(),
      /immutable/,
    );
  },
);
scenario(
  "PERSONAL compensation resolves actual User; BLOGGER campaign association is persisted and mode independent",
  async (f) => {
    const owner = await f.auth("owner"),
      campaign = await f.foundation.createCampaign(owner, {
        campaignKey: "blogger-fixture",
        name: "Synthetic campaign",
      });
    await assert.rejects(
      f.foundation.createCampaign(owner, {
        campaignKey: "BLOGGER-FIXTURE",
        name: "Other",
      }),
      { statusCode: 409 },
    );
    const p = await create(f, {
      ...base,
      purpose: "COMPENSATION",
      audience: "PERSONAL",
      personalUserId: "buyer",
    });
    const b = await create(f, {
      ...base,
      code: "BLOGGER",
      audience: "BLOGGER",
      campaignId: campaign.id,
      saleModes: "PREORDER",
    });
    assert.equal(
      (
        f.sqlite
          .prepare(
            "SELECT personalUserId FROM PromoCodePolicy WHERE promoCodeId=?",
          )
          .get(p.id) as { personalUserId: string }
      ).personalUserId,
      "buyer",
    );
    assert.equal(
      (
        f.sqlite
          .prepare("SELECT campaignId FROM PromoCodePolicy WHERE promoCodeId=?")
          .get(b.id) as { campaignId: string }
      ).campaignId,
      campaign.id,
    );
    await assert.rejects(
      create(f, {
        ...base,
        code: "BAD-USER",
        audience: "PERSONAL",
        personalUserId: "900141",
      }),
      { statusCode: 409 },
    );
    await assert.rejects(
      create(f, {
        ...base,
        code: "BAD-CAMP",
        audience: "BLOGGER",
        campaignId: "missing",
      }),
      { statusCode: 409 },
    );
    for (const input of [
      {
        ...base,
        code: "BAD-CAT",
        scope: "CATEGORIES",
        categoryIds: ["missing"],
      },
      { ...base, code: "BAD-PROD", scope: "PRODUCTS", productIds: ["missing"] },
    ])
      await assert.rejects(create(f, input), { statusCode: 409 });
  },
);
scenario(
  "preview reads signed account and current D1 catalog/cart, never changes cart/quota or enables checkout",
  async (f) => {
    const p = await create(f, {
      ...base,
      audience: "PERSONAL",
      personalUserId: "buyer",
    });
    await group(["IN_STOCK", "PREORDER"]); // consume one cart to exercise historical group coexistence
    const cart = new D1CartRepository();
    for (const saleMode of ["IN_STOCK", "PREORDER"] as const)
      await cart.addItem("buyer", {
        productId: "p",
        variantId: "v",
        quantity: 1,
        saleMode,
        heightCm: null,
        weightKg: null,
      });
    await cart.addItem("other", {
      productId: "p",
      variantId: "v",
      quantity: 1,
      saleMode: "IN_STOCK",
      heightCm: null,
      weightKg: null,
    });
    const before = rows(f, "CartItem"),
      revision = (
        f.sqlite.prepare("SELECT version FROM _Revision WHERE id=1").get() as {
          version: number;
        }
      ).version;
    const q = await f.foundation.preview(await f.auth(), " voyey-10 ");
    assert.equal(q.valid, true);
    assert.equal(
      (
        (await f.foundation.preview(await f.auth("other"), "VOYEY-10")) as {
          reason: string;
        }
      ).reason,
      "PERSONAL_MISMATCH",
    );
    assert.deepEqual(rows(f, "CartItem"), before);
    assert.equal(
      (
        f.sqlite.prepare("SELECT version FROM _Revision WHERE id=1").get() as {
          version: number;
        }
      ).version,
      revision,
    );
    const legacy = await promoForCheckout("buyer", "VOYEY-10", 202);
    assert.equal(legacy.quote.valid, false);
    const legacyQuote = await new PromoCodeService().validateCart(
      "buyer",
      "VOYEY-10",
    );
    assert.equal(legacyQuote.valid, false);
    const counts = count(f, "CheckoutGroup");
    await assert.rejects(
      new LinkedCheckoutCommit(true).create("buyer", randomUUID(), {
        recipient,
        preorderPercent: 50,
        promoCode: "VOYEY-10",
      }),
      { statusCode: 409 },
    );
    assert.equal(count(f, "CheckoutGroup"), counts);
    assert.deepEqual(rows(f, "CartItem"), before);
    const svc = new PromoCodeService();
    await assert.rejects(svc.save(WEB_ADMIN_ACTOR, base, p.id), {
      statusCode: 404,
    });
    await assert.rejects(svc.setActive(WEB_ADMIN_ACTOR, p.id, false), {
      statusCode: 404,
    });
    await f.foundation.setActive(await f.auth("owner"), p.id, false);
    assert.equal(
      (
        (await f.foundation.preview(await f.auth(), p.code)) as {
          reason: string;
        }
      ).reason,
      "INACTIVE",
    );
  },
);
scenario(
  "advanced promo cannot enter LEGACY checkout or either SQL quota writer",
  async (f) => {
    const p = await create(f);
    await new D1CartRepository().addItem("buyer", {
      productId: "p",
      variantId: "v",
      quantity: 1,
      saleMode: "LEGACY",
      heightCm: null,
      weightKg: null,
    });
    await assert.rejects(
      new D1OrderRepository().checkout({
        userId: "buyer",
        promoCode: p.code,
        idempotencyKey: randomUUID(),
        publicId: "STZ-FIXTURE",
        recipient,
        prepare: prepareOrder,
      }),
      { statusCode: 409 },
    );
    assert.equal(count(f, "Order"), 0);
    for (const table of ["PromoCodeRedemption", "CheckoutPromoUse"])
      assert.throws(
        () =>
          f.sqlite
            .prepare(
              table === "PromoCodeRedemption"
                ? "INSERT INTO PromoCodeRedemption(id,promoCodeId,userId,orderId,discountAmount,createdAt) VALUES('x',?,'buyer','missing',10,1)"
                : "INSERT INTO CheckoutPromoUse(id,checkoutGroupId,userId,promoCodeId,discountAmount,createdAt) VALUES('x','missing','buyer',?,10,1)",
            )
            .run(p.id),
        /lifecycle disabled/,
      );
    assert.equal(count(f, "PromoCodeRedemption"), 0);
    assert.equal(count(f, "CheckoutPromoUse"), 0);
  },
);
for (const actor of ["employee", "buyer", WEB_ADMIN_ACTOR, ""])
  scenario(
    `configuration is owner-only, actor=${actor || "anonymous"}`,
    async (f) => {
      await assert.rejects(
        f.foundation.create(actor ? await f.auth(actor) : undefined, {
          ...base,
          audience: "PERSONAL",
          personalUserId: "buyer",
          purpose: "COMPENSATION",
        }),
        { statusCode: 403 },
      );
      assert.equal(count(f, "PromoCode"), 0);
    },
  );
scenario(
  "default-off, personal auth and owner revocation during CAS fail closed",
  async (f) => {
    const auth = await f.auth("owner");
    await assert.rejects(new PromoFoundation(f.owner).create(auth, base), {
      statusCode: 503,
    });
    await assert.rejects(f.foundation.preview(undefined, "VOYEY-10"), {
      statusCode: 403,
    });
    let revoked = false;
    const wrapped: Database = {
      prepare: (sql) => f.db.prepare(sql),
      batch: async (statements) => {
        if (
          !revoked &&
          statements.some((s) =>
            (s as unknown as { sql: string }).sql.includes(
              "INSERT INTO PromoCode(",
            ),
          )
        ) {
          revoked = true;
          f.sqlite.exec(
            "UPDATE TelegramAdmin SET isActive=0 WHERE id='owner-admin'",
          );
        }
        return f.db.batch(statements);
      },
    };
    await assert.rejects(
      withDatabase(wrapped, () => f.foundation.create(auth, base)),
      { statusCode: 403 },
    );
    assert.equal(count(f, "PromoCode"), 0);
    assert.equal(count(f, "PromoCodePolicy"), 0);
  },
);
scenario(
  "scope/audit/seal failures roll back the entire policy; settings, selections and version immutable after seal",
  async (f) => {
    const owner = await f.auth("owner"),
      input = {
        ...base,
        scope: "CATEGORIES",
        categoryIds: ["c"],
        exclusions: [{ productId: "p", saleModes: "PREORDER" }],
      };
    f.sqlite.exec(
      "CREATE TRIGGER injected BEFORE INSERT ON AuditLog WHEN NEW.action='promo-policy.created' BEGIN SELECT RAISE(ABORT,'injected promo audit'); END",
    );
    await assert.rejects(f.foundation.create(owner, input), /injected/);
    assert.equal(count(f, "PromoCode"), 0);
    assert.equal(count(f, "PromoPolicyCategory"), 0);
    f.sqlite.exec("DROP TRIGGER injected");
    const p = await create(f, input);
    for (const table of [
      "PromoCodePolicy",
      "PromoPolicyCategory",
      "PromoPolicyExclusion",
    ]) {
      assert.throws(() => f.sqlite.exec(`DELETE FROM ${table}`), /immutable/);
      assert.throws(
        () => f.sqlite.exec(`UPDATE ${table} SET promoCodeId=promoCodeId`),
        /immutable/,
      );
    }
    assert.throws(
      () =>
        f.sqlite
          .prepare(
            "INSERT INTO PromoPolicyProduct(promoCodeId,productId) VALUES(?,'p')",
          )
          .run(p.id),
      /sealed/,
    );
    assert.throws(
      () => f.sqlite.exec("UPDATE PromoCode SET value=5"),
      /immutable/,
    );
    assert.throws(() => f.sqlite.exec("DELETE FROM PromoCode"), /immutable/);
    assert.deepEqual(f.sqlite.prepare("PRAGMA foreign_key_check").all(), []);
  },
);
scenario(
  "legacy + linked quota counting remains shared; disabling/editing a legacy code never rewrites paid order/refund history",
  async (f) => {
    const svc = new PromoCodeService(),
      p = await svc.save(WEB_ADMIN_ACTOR, {
        ...base,
        code: "OLD-PROMO",
        perUserLimit: 10,
      });
    const g = await group(["IN_STOCK", "PREORDER"], 50, false, p.code),
      o = g.orders.find((o) => o.saleMode === "PREORDER")!,
      auth = await f.auth(),
      owner = await f.auth("owner");
    const proofRow = await f.payments.submit(
      auth,
      o.id,
      randomUUID(),
      { declaredAmount: o.firstPaymentAmount },
      proof(),
    );
    await f.payments.review(
      owner,
      proofRow.payment.id,
      randomUUID(),
      decision(o.firstPaymentAmount),
    );
    f.sqlite.exec(
      `INSERT INTO "Order"(id,publicId,userId,idempotencyKey,fullName,phone,city,address,subtotal,total,requiredPrepayment,remainingAmount,updatedAt) VALUES('legacy','LEGACY','buyer','legacy-fixture-key','Synthetic','1234567','Fixture','Fixture',101,101,51,50,1);`,
    );
    f.sqlite
      .prepare(
        "INSERT INTO PromoCodeRedemption(id,promoCodeId,userId,orderId,discountAmount,createdAt) VALUES('legacy-use',?,'buyer','legacy',1,1)",
      )
      .run(p.id);
    assert.equal(await promoUsage(p.id), 2);
    assert.equal(await promoUsage(p.id, "buyer"), 2);
    assert.equal(await promoUsage(p.id, "other"), 0);
    const history = new Map(
      [
        "CheckoutGroup",
        "CheckoutOrder",
        "CheckoutOrderItem",
        "CheckoutPromoUse",
        "CheckoutPaymentLedger",
        "CheckoutPayment",
        "PromoCodeRedemption",
      ].map((t) => [t, rows(f, t)]),
    );
    await svc.setActive(WEB_ADMIN_ACTOR, p.id, false);
    await svc.save(
      WEB_ADMIN_ACTOR,
      {
        ...base,
        code: "OLD-PROMO",
        value: 20,
        isActive: false,
        perUserLimit: 10,
      },
      p.id,
    );
    assert.equal(
      (await promoForCheckout("buyer", p.code, 202)).quote.valid,
      false,
    );
    for (const [t, before] of history) assert.deepEqual(rows(f, t), before, t);
    const current = await readCheckoutGroup("buyer", g.id);
    assert.equal(current.discountAmount, 20);
    assert.equal(
      (await f.payments.state(auth, o.id)).goodsPaid,
      o.firstPaymentAmount,
    );
    const r = await f.refunds.request(owner, o.id, randomUUID(), {
      reason: "Synthetic refund",
    });
    assert.equal(r.refund.totalAmount, o.firstPaymentAmount);
    await f.refunds.confirm(owner, r.refund.id, randomUUID(), {
      confirmedAmount: o.firstPaymentAmount,
      bankTransferVerified: true,
      bankOperationReference: randomUUID(),
    });
    assert.equal(
      (await readOrderFinance(o.id)).goodsPaid,
      o.firstPaymentAmount,
    );
    assert.equal(await promoUsage(p.id), 2);
    const unpaid = g.orders.find((o) => o.saleMode === "IN_STOCK")!;
    await f.cancellations.cancel(owner, unpaid.id, randomUUID(), {
      reason: "Synthetic cancellation",
    });
    assert.equal(await promoUsage(p.id), 2);
    const old = await new LifecycleService().cancel("LEGACY", WEB_ADMIN_ACTOR, {
      reason: "CUSTOMER_REQUEST",
    });
    assert.equal(old.status, "CANCELLED"); // preserve LEGACY policy: releases its redemption
    assert.equal(await promoUsage(p.id), 1);
    f.sqlite.exec(
      "INSERT INTO Refund(id,orderId,amount,createdBy,createdAt,updatedAt) VALUES('legacy-refund','legacy',1,'fixture',1,1)",
    );
    assert.equal(
      (await new RefundService().complete("legacy-refund", WEB_ADMIN_ACTOR, {}))
        .status,
      "COMPLETED",
    );
  },
);
for (const rollback of [false, true])
  test(`populated 0025 migration ${rollback ? "rollback" : "upgrade"} preserves all old promo/order/payment/refund/cancellation fields and quota`, async () => {
    const f = fixture("0025");
    try {
      await f.run(async () => {
        const legacy = await new PromoCodeService().save(WEB_ADMIN_ACTOR, {
          ...base,
          code: "OLD-PROMO",
          perUserLimit: 5,
        });
        await group(["IN_STOCK", "PREORDER"], 50, false, legacy.code);
        const paid = await submittedFinal(f);
        await f.payments.review(
          paid.owner,
          paid.final.payment.id,
          randomUUID(),
          decision(67),
        );
        const r = await f.refunds.request(
          paid.owner,
          paid.order.id,
          randomUUID(),
          { reason: "Fixture refund" },
        );
        await f.refunds.confirm(paid.owner, r.refund.id, randomUUID(), {
          confirmedAmount: 118,
          bankTransferVerified: true,
          bankOperationReference: randomUUID(),
        });
        const unpaid = (await group(["IN_STOCK"])).orders[0]!;
        await f.cancellations.cancel(paid.owner, unpaid.id, randomUUID(), {
          reason: "Fixture cancellation",
        });
        const names = [
            "PromoCode",
            "PromoCodeRedemption",
            "CheckoutPromoUse",
            "CheckoutGroup",
            "CheckoutOrder",
            "CheckoutOrderItem",
            "CheckoutPayment",
            "CheckoutPaymentLedger",
            "CheckoutArrival",
            "CheckoutCargoCharge",
            "CheckoutFinalInvoice",
            "CheckoutCancellation",
            "CheckoutStockRelease",
            "CheckoutRefund",
            "CheckoutRefundAllocation",
            "CheckoutRefundLedger",
            "CheckoutRefundStockRelease",
            "MediaObject",
            "MediaChunk",
            "AuditLog",
          ],
          before = new Map(names.map((t) => [t, rows(f, t)]));
        const statements = migration().map((s) => f.db.prepare(s));
        if (rollback)
          await assert.rejects(
            f.db.batch([
              ...statements,
              f.db.prepare("SELECT * FROM missing_promo_migration_table"),
            ]),
          );
        else await f.db.batch(statements);
        for (const t of names) {
          const after = rows(f, t).map((row) => {
            const copy = { ...row };
            delete copy.engineVersion;
            return copy;
          });
          assert.deepEqual(after, before.get(t), t);
        }
        assert.deepEqual(
          f.sqlite.prepare("PRAGMA foreign_key_check").all(),
          [],
        );
        assert.deepEqual(
          (await f.payments.proof(paid.auth, paid.final.payment.id)).data,
          png,
        );
        assert.equal(await promoUsage(legacy.id), 1);
        if (!rollback) {
          assert.equal(
            (await new PromoCodeService().list())[0]!.code,
            legacy.code,
          );
          await create(f);
          assert.equal(count(f, "PromoCodePolicy"), 1);
        } else
          assert.equal(
            (
              f.sqlite
                .prepare(
                  "SELECT COUNT(*) n FROM sqlite_master WHERE name='PromoCodePolicy'",
                )
                .get() as { n: number }
            ).n,
            0,
          );
      });
    } finally {
      f.sqlite.close();
    }
  });
test("actual local D1 populated upgrade/rollback, owner preview, public/Admin paths and old checkout quarantine; no outbound", async () => {
  const f = await marketingRuntime("1", "0025");
  try {
    await f.db.exec(seed);
    const buyer = await runtimeUser(f, 900141),
      tokens = new JwtTokenService(randomBytes(32).toString("hex")),
      authority = new VoyeyOwnerAuthority(tokens, () => "900143"),
      foundation = new PromoFoundation(authority, true),
      owner = "Bearer " + (await tokens.issue("owner")),
      auth = "Bearer " + (await tokens.issue("buyer"));
    const result = await withDatabase(f.db as unknown as Database, async () => {
      const old = await new PromoCodeService().save(WEB_ADMIN_ACTOR, {
        ...base,
        code: "OLD-PROMO",
      });
      await group(["IN_STOCK", "PREORDER"], 50, false, old.code);
      const original = (await f.db.prepare("SELECT * FROM PromoCode").all())
        .results;
      await assert.rejects(
        f.db.batch([
          ...migration().map((s) => f.db.prepare(s)),
          f.db.prepare("SELECT * FROM missing_promo_upgrade"),
        ]),
      );
      assert.deepEqual(
        (await f.db.prepare("SELECT * FROM PromoCode").all()).results,
        original,
      );
      await f.db.batch(migration().map((s) => f.db.prepare(s)));
      await f.db
        .prepare(
          "CREATE TRIGGER injected BEFORE INSERT ON AuditLog WHEN NEW.action='promo-policy.created' BEGIN SELECT RAISE(ABORT,'injected D1 promo failure'); END",
        )
        .run();
      await assert.rejects(
        foundation.create(owner, { ...base, code: "NEW-PROMO" }),
        /injected/,
      );
      assert.equal(
        (await f.db
          .prepare("SELECT COUNT(*) n FROM PromoCode WHERE engineVersion=2")
          .first<{ n: number }>())!.n,
        0,
      );
      await f.db.prepare("DROP TRIGGER injected").run();
      const p = await foundation.create(owner, {
        ...base,
        code: "NEW-PROMO",
        scope: "CATEGORIES",
        categoryIds: ["c"],
        exclusions: [{ productId: "p", saleModes: "PREORDER" }],
      });
      for (const saleMode of ["IN_STOCK", "PREORDER"] as const)
        await new D1CartRepository().addItem("buyer", {
          productId: "p",
          variantId: "v",
          quantity: 1,
          saleMode,
          heightCm: null,
          weightKg: null,
        });
      const q = await foundation.preview(auth, p.code);
      assert.equal(q.valid, true);
      if (q.valid) {
        assert.equal(q.eligibleSubtotal, 101);
        assert.equal(q.discountAmount, 10);
        assert.equal(q.executable, false);
      }
      assert.equal(
        (await promoForCheckout("buyer", p.code, 202)).quote.valid,
        false,
      );
      await assert.rejects(
        new LinkedCheckoutCommit(true).create("buyer", randomUUID(), {
          recipient,
          preorderPercent: 50,
          promoCode: p.code,
        }),
        { statusCode: 409 },
      );
      assert.deepEqual(
        (await f.db.prepare("PRAGMA foreign_key_check").all()).results,
        [],
      );
      return p;
    });
    for (const path of [
      "/promo-policies",
      "/promo-policies/preview",
      "/admin/marketing/promo-policies",
      "/admin/marketing/promo-campaigns",
    ])
      for (const role of ["anonymous", "buyer", "admin"]) {
        const r = await f.call(
          path,
          "POST",
          base,
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
    const listed = await f.admin("/marketing/promo-codes");
    assert.equal(listed.status, 200);
    assert.equal(
      JSON.stringify(await listed.json()).includes("NEW-PROMO"),
      false,
    );
    assert.equal(
      (
        await f.admin(
          `/marketing/promo-codes/${result.id}/deactivate`,
          "POST",
          {},
        )
      ).status,
      404,
    );
    const oldCreate = await f.admin("/marketing/promo-codes", "POST", {
      ...base,
      saleModes: "BOTH",
      audience: "PUBLIC",
    });
    assert.equal(oldCreate.status, 400);
    assert.equal(f.outboundCalls(), 0);
  } finally {
    await f.mf.dispose();
  }
});
scenario(
  "concurrent normalized code creation commits exactly one complete policy and audit",
  async (f) => {
    const auth = await f.auth("owner"),
      r = await Promise.allSettled([
        f.foundation.create(auth, { ...base, code: "VOYEY-10" }),
        f.foundation.create(auth, { ...base, code: " voyey-10 " }),
      ]);
    assert.equal(r.filter((v) => v.status === "fulfilled").length, 1);
    assert.equal(count(f, "PromoCode"), 1);
    assert.equal(count(f, "PromoCodePolicy"), 1);
    assert.equal(
      (
        f.sqlite
          .prepare(
            "SELECT COUNT(*) n FROM AuditLog WHERE action='promo-policy.created'",
          )
          .get() as { n: number }
      ).n,
      1,
    );
  },
);
scenario(
  "owner revocation during advanced activation rolls back status change",
  async (f) => {
    const p = await create(f, { ...base, isActive: false }),
      auth = await f.auth("owner");
    let changed = false;
    const wrapped: Database = {
      prepare: (sql) => f.db.prepare(sql),
      batch: async (statements) => {
        if (
          !changed &&
          statements.some((s) =>
            (s as unknown as { sql: string }).sql.includes(
              'UPDATE "PromoCode"',
            ),
          )
        ) {
          changed = true;
          f.sqlite.exec(
            "UPDATE TelegramAdmin SET isActive=0 WHERE id='owner-admin'",
          );
        }
        return f.db.batch(statements);
      },
    };
    await assert.rejects(
      withDatabase(wrapped, () => f.foundation.setActive(auth, p.id, true)),
      { statusCode: 403 },
    );
    assert.ok(changed);
    assert.equal(
      (
        f.sqlite
          .prepare("SELECT isActive FROM PromoCode WHERE id=?")
          .get(p.id) as { isActive: number }
      ).isActive,
      0,
    );
  },
);
scenario(
  "direct SQL cannot seal incomplete scope, attach policy to legacy code, forge PERSONAL association or mutate campaign",
  async (f) => {
    const legacy = await new PromoCodeService().save(WEB_ADMIN_ACTOR, {
      ...base,
      code: "OLD-CODE",
    });
    const insertPolicy =
      "INSERT INTO PromoCodePolicy(promoCodeId,saleModes,audience,purpose,personalUserId,campaignId,scope,createdBy,createdAt) VALUES(?,'BOTH',?,?,?,?,'CATEGORIES','owner',1)";
    assert.throws(
      () =>
        f.sqlite
          .prepare(insertPolicy)
          .run(legacy.id, "PUBLIC", "STANDARD", null, null),
      /invalid advanced/,
    );
    f.sqlite.exec("BEGIN IMMEDIATE");
    try {
      f.sqlite.exec(
        "INSERT INTO PromoCode(id,code,type,value,isActive,engineVersion,createdAt,updatedAt) VALUES('sql-policy','SQL-POLICY','PERCENT',10,1,2,1,1)",
      );
      assert.throws(() =>
        f.sqlite
          .prepare(insertPolicy)
          .run("sql-policy", "PERSONAL", "STANDARD", null, null),
      );
      f.sqlite
        .prepare(insertPolicy)
        .run("sql-policy", "PUBLIC", "STANDARD", null, null);
      assert.throws(
        () =>
          f.sqlite.exec(
            "INSERT INTO PromoPolicyCategory(promoCodeId,categoryId) VALUES('sql-policy','missing')",
          ),
        /FOREIGN KEY/,
      );
      assert.throws(
        () =>
          f.sqlite.exec(
            "UPDATE PromoCodePolicy SET sealed=1 WHERE promoCodeId='sql-policy'",
          ),
        /incomplete/,
      );
    } finally {
      f.sqlite.exec("ROLLBACK");
    }
    const campaign = await f.foundation.createCampaign(await f.auth("owner"), {
      campaignKey: "FIXTURE",
      name: "Synthetic",
    });
    assert.throws(
      () =>
        f.sqlite
          .prepare("DELETE FROM PromoCampaign WHERE id=?")
          .run(campaign.id),
      /immutable/,
    );
    assert.throws(
      () =>
        f.sqlite
          .prepare("UPDATE PromoCampaign SET name='x' WHERE id=?")
          .run(campaign.id),
      /immutable/,
    );
  },
);
