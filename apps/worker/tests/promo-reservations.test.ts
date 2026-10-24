import test, { mock } from "node:test";
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
import { promoV2Usage } from "../../api/src/modules/marketing/promo-reservations.js";
import {
  readFirstWindow,
  FIRST_WINDOW_MS,
  FIRST_EXTENSION_MS,
} from "../../api/src/modules/checkout/first-window.js";
import { PromoFoundation } from "../../api/src/modules/marketing/promo-foundation.js";
import { parsePromoPolicy } from "../../api/src/modules/marketing/promo-policy.js";
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
      "../migrations/0028_promo_reservation_lifecycle.sql",
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
  const config = { owner: "900143" };
  const owner = new VoyeyOwnerAuthority(tokens, () => config.owner);
  return {
    config,
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
      mock.restoreAll();
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
  return new SaleModeCheckoutCommit(true, true).create(userId, key, {
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

scenario(
  "new selected opt-in defaults to FIRST deadline even without any promo",
  async (f) => {
    await add("IN_STOCK");
    const g = await new SaleModeCheckoutCommit(true).create(
      "buyer",
      randomUUID(),
      { saleMode: "IN_STOCK", recipient },
    );
    assert.equal(
      (await readFirstWindow(g.orders[0]!.id))!.expiresAt,
      g.createdAt + FIRST_WINDOW_MS,
    );
    assert.equal(count(f, "PromoReservation"), 0);
  },
);
function clock(start = Date.now()) {
  let now = start;
  mock.method(Date, "now", () => now);
  return {
    set: (value: number) => {
      now = value;
    },
    get: () => now,
  };
}
const reservation = (f: Fixture, orderId: string) =>
  f.sqlite
    .prepare("SELECT * FROM PromoReservationState WHERE orderId=?")
    .get(orderId)!;
async function reserved(
  f: ReturnType<typeof services>,
  mode: Mode = "IN_STOCK",
  extra: Record<string, unknown> = {},
) {
  const owner = await f.auth("owner"),
    auth = await f.auth();
  const promo = await f.foundation.create(owner, { ...base, ...extra });
  await mixed();
  const g = await create(mode, randomUUID(), { promoCode: promo.code }),
    o = g.orders[0]!;
  return { owner, auth, promo, g, o };
}
type Reserved = Awaited<ReturnType<typeof reserved>>;
const submit = (
  f: ReturnType<typeof services>,
  s: Reserved,
  key = randomUUID(),
) =>
  f.payments.submit(
    s.auth,
    s.o.id,
    key,
    { declaredAmount: s.o.firstPaymentAmount },
    proof(),
  );
const reject = (
  f: ReturnType<typeof services>,
  s: Reserved,
  paymentId: string,
  key = randomUUID(),
) =>
  f.payments.review(s.owner, paymentId, key, {
    decision: "REJECT",
    reason: "UNREADABLE",
  });
const approve = (
  f: ReturnType<typeof services>,
  s: Reserved,
  paymentId: string,
  key = randomUUID(),
) =>
  f.payments.review(s.owner, paymentId, key, {
    decision: "APPROVE",
    confirmedAmount: s.o.firstPaymentAmount,
    bankOperationReference: randomUUID(),
  });
const reason = { reason: "Synthetic unpaid cancellation" };

for (const mode of ["IN_STOCK", "PREORDER"] as const)
  scenario(
    `${mode} checkout atomically reserves v2, snapshots, FIRST window and selected stock only`,
    async (f) => {
      const s = await reserved(f, mode);
      const r = reservation(f, s.o.id);
      assert.equal(r.state, "RESERVED");
      assert.equal(r.discountAmount, 99);
      assert.equal(s.o.goodsTotal, 2);
      assert.equal(count(f, "CheckoutPromoUse"), 0);
      assert.equal(await promoV2Usage(s.promo.id), 1);
      assert.equal(await promoUsage(s.promo.id), 0);
      const window = await readFirstWindow(s.o.id);
      assert.equal(window!.expiresAt, s.g.createdAt + FIRST_WINDOW_MS);
      assert.equal(window!.attempts, 0);
      assert.equal(stock(f), mode === "IN_STOCK" ? 4 : 5);
      assert.deepEqual(
        rows(f, "CartItem").map((r) => r.saleMode),
        [mode === "IN_STOCK" ? "PREORDER" : "IN_STOCK"],
      );
      assert.equal(
        JSON.parse(r.policySnapshot as string).quote.discountAmount,
        s.o.discountAmount,
      );
      assert.deepEqual(
        rows(f, "PromoReservationEvent").map((e) => e.kind),
        ["RESERVED"],
      );
    },
  );
scenario(
  "independent tabs use different v2 codes, common quota still counts both",
  async (f) => {
    const owner = await f.auth("owner");
    const a = await f.foundation.create(owner, {
      ...base,
      code: "READY90",
      value: 90,
      saleModes: "IN_STOCK",
    });
    const b = await f.foundation.create(owner, {
      ...base,
      code: "PRE95",
      value: 95,
      saleModes: "PREORDER",
    });
    await mixed();
    const one = await create("IN_STOCK", randomUUID(), { promoCode: a.code });
    const two = await create("PREORDER", randomUUID(), { promoCode: b.code });
    assert.notEqual(one.id, two.id);
    assert.equal(one.discountAmount, 90);
    assert.equal(two.discountAmount, 95);
    assert.equal(await promoV2Usage(a.id), 1);
    assert.equal(await promoV2Usage(b.id), 1);
    assert.equal(count(f, "CartItem"), 0);
  },
);
for (const limit of ["global", "account"] as const)
  scenario(`two tabs cannot bypass ${limit} quota of one code`, async (f) => {
    const s = await reserved(f, "IN_STOCK", {
      usageLimit: limit === "global" ? 1 : 10,
      perUserLimit: limit === "account" ? 1 : 10,
    });
    await assert.rejects(
      create("PREORDER", randomUUID(), { promoCode: s.promo.code }),
      /LIMIT/,
    );
    assert.equal(count(f, "CheckoutGroup"), 1);
    assert.equal(count(f, "CartItem"), 1);
    assert.equal(await promoV2Usage(s.promo.id), 1);
  });
scenario(
  "PERSONAL checks internal User, BLOGGER retains immutable campaign association",
  async (f) => {
    const owner = await f.auth("owner"),
      personal = await f.foundation.create(owner, {
        ...base,
        audience: "PERSONAL",
        personalUserId: "buyer",
      });
    await add("IN_STOCK", "other");
    await assert.rejects(
      create("IN_STOCK", randomUUID(), { promoCode: personal.code }, "other"),
      /PERSONAL/,
    );
    await add("IN_STOCK");
    await create("IN_STOCK", randomUUID(), { promoCode: personal.code });
    const campaign = await f.foundation.createCampaign(owner, {
      campaignKey: "SYNTHETIC",
      name: "Synthetic campaign",
    });
    const blogger = await f.foundation.create(owner, {
      ...base,
      code: "BLOGGER",
      audience: "BLOGGER",
      campaignId: campaign.id,
    });
    await add("PREORDER");
    const g = await create("PREORDER", randomUUID(), {
      promoCode: blogger.code,
    });
    const snapshot = JSON.parse(
      reservation(f, g.orders[0]!.id).policySnapshot as string,
    );
    assert.equal(snapshot.config.campaignId, campaign.id);
    assert.equal(snapshot.quote.kind, "BLOGGER");
  },
);
for (const extra of [
  { saleModes: "PREORDER" },
  { exclusions: [{ productId: "p", saleModes: "IN_STOCK" }] },
  { endsAt: new Date(Date.now() - 1000).toISOString() },
  { isActive: false },
] as Record<string, unknown>[])
  scenario(
    `live eligibility rejects ${JSON.stringify(extra)} without orphan records`,
    async (f) => {
      const p = await f.foundation.create(await f.auth("owner"), {
        ...base,
        ...extra,
      });
      await mixed();
      await assert.rejects(
        create("IN_STOCK", randomUUID(), { promoCode: p.code }),
      );
      for (const table of [
        "PromoReservation",
        "CheckoutFirstWindow",
        "CheckoutGroup",
        "CheckoutOrder",
      ])
        assert.equal(count(f, table), 0, table);
      assert.equal(stock(f), 5);
      assert.equal(count(f, "CartItem"), 2);
    },
  );
scenario(
  "preview does not reserve quota and checkout revalidates after deactivation",
  async (f) => {
    const p = await f.foundation.create(await f.auth("owner"), base);
    await mixed();
    assert.equal(
      (await f.foundation.preview(await f.auth(), p.code, "IN_STOCK")).valid,
      true,
    );
    assert.equal(await promoV2Usage(p.id), 0);
    await f.foundation.setActive(await f.auth("owner"), p.id, false);
    await assert.rejects(
      create("IN_STOCK", randomUUID(), { promoCode: p.code }),
      /INACTIVE/,
    );
    assert.equal(count(f, "PromoReservation"), 0);
  },
);
scenario(
  "expired/disabled after checkout: snapshot and RESERVED survive, approved FIRST consumes once",
  async (f) => {
    const c = clock(),
      s = await reserved(f, "IN_STOCK", {
        endsAt: new Date(c.get() + 1000).toISOString(),
      });
    const original = rows(f, "PromoReservation");
    await f.foundation.setActive(s.owner, s.promo.id, false);
    c.set(c.get() + 2000);
    const p = await submit(f, s),
      key = randomUUID(),
      decision = {
        decision: "APPROVE",
        confirmedAmount: s.o.firstPaymentAmount,
        bankOperationReference: randomUUID(),
      };
    await f.payments.review(s.owner, p.payment.id, key, decision);
    assert.deepEqual(
      await f.payments.review(s.owner, p.payment.id, key, decision),
      await f.payments.review(s.owner, p.payment.id, key, decision),
    );
    assert.equal(reservation(f, s.o.id).state, "CONSUMED");
    assert.deepEqual(rows(f, "PromoReservation"), original);
    assert.equal(count(f, "CheckoutPaymentLedger"), 1);
    assert.equal(count(f, "PromoReservationEvent"), 2);
    assert.equal(await promoV2Usage(s.promo.id), 1);
    assert.equal((await readCheckoutGroup("buyer", s.g.id)).discountAmount, 99);
  },
);
scenario(
  "REJECT keeps RESERVED without ledger, duplicate submit/review do not count or extend",
  async (f) => {
    const s = await reserved(f),
      key = randomUUID(),
      p = await submit(f, s, key);
    await submit(f, s, key);
    assert.equal((await readFirstWindow(s.o.id))!.attempts, 1);
    await assert.rejects(submit(f, s), /pending/);
    const reviewKey = randomUUID();
    await reject(f, s, p.payment.id, reviewKey);
    await reject(f, s, p.payment.id, reviewKey);
    assert.equal(count(f, "CheckoutPaymentLedger"), 0);
    assert.equal(reservation(f, s.o.id).state, "RESERVED");
    assert.equal(count(f, "CheckoutFirstExtension"), 0);
  },
);
scenario(
  "invalid file/claim creates no accepted attempt; exactly three rejected FIRST attempts allowed",
  async (f) => {
    const s = await reserved(f);
    await assert.rejects(
      f.payments.submit(
        s.auth,
        s.o.id,
        randomUUID(),
        { declaredAmount: 2 },
        { data: Buffer.from("bad"), declaredMimeType: "image/png" },
      ),
    );
    await assert.rejects(
      f.payments.submit(
        s.auth,
        s.o.id,
        randomUUID(),
        { declaredAmount: 0 },
        proof(),
      ),
    );
    assert.equal((await readFirstWindow(s.o.id))!.attempts, 0);
    for (let i = 0; i < 3; i++) {
      const p = await submit(f, s);
      await reject(f, s, p.payment.id);
    }
    assert.equal((await readFirstWindow(s.o.id))!.attempts, 3);
    await assert.rejects(submit(f, s), /three/);
    assert.equal(count(f, "CheckoutPayment"), 3);
    assert.equal(count(f, "MediaObject"), 3);
    assert.equal(count(f, "CheckoutPaymentLedger"), 0);
  },
);
for (const delta of [-1, 0, 1])
  scenario(
    `FIRST submission at expiresAt ${delta}ms has strict boundary`,
    async (f) => {
      const c = clock(),
        s = await reserved(f);
      c.set(s.g.createdAt + FIRST_WINDOW_MS + delta);
      if (delta < 0)
        assert.equal((await submit(f, s)).payment.status, "SUBMITTED");
      else await assert.rejects(submit(f, s), /closed/);
      assert.equal(reservation(f, s.o.id).state, "RESERVED");
      assert.equal(await promoV2Usage(s.promo.id), 1);
    },
  );
for (const decision of ["APPROVE", "REJECT"] as const)
  scenario(
    `timely pending at deadline holds quota and allows late ${decision}`,
    async (f) => {
      const c = clock(),
        s = await reserved(f);
      c.set(s.g.createdAt + FIRST_WINDOW_MS - 1);
      const p = await submit(f, s);
      c.set(s.g.createdAt + FIRST_WINDOW_MS + 1000);
      await assert.rejects(submit(f, s), /pending/);
      await assert.rejects(
        f.cancellations.cancel(s.owner, s.o.id, randomUUID(), reason),
        /pending/,
      );
      if (decision === "APPROVE") {
        await approve(f, s, p.payment.id);
        assert.equal(reservation(f, s.o.id).state, "CONSUMED");
      } else {
        await reject(f, s, p.payment.id);
        assert.equal(reservation(f, s.o.id).state, "RESERVED");
        assert.equal(count(f, "CheckoutFirstExtension"), 1);
      }
      assert.equal(await promoV2Usage(s.promo.id), 1);
    },
  );
for (const delta of [-1, 0, 1])
  scenario(
    `one two-hour extension, submission at extended deadline ${delta}ms`,
    async (f) => {
      const c = clock(),
        s = await reserved(f),
        p = await submit(f, s);
      const late = s.g.createdAt + FIRST_WINDOW_MS;
      c.set(late);
      const key = randomUUID();
      await reject(f, s, p.payment.id, key);
      const w = await readFirstWindow(s.o.id);
      assert.equal(w!.effectiveExpiresAt, late + FIRST_EXTENSION_MS);
      assert.equal(w!.extensionGrantedAt, late);
      c.set(late + 100);
      await reject(f, s, p.payment.id, key);
      assert.equal(
        (await readFirstWindow(s.o.id))!.effectiveExpiresAt,
        w!.effectiveExpiresAt,
      );
      c.set(w!.effectiveExpiresAt + delta);
      if (delta < 0) {
        const second = await submit(f, s);
        c.set(w!.effectiveExpiresAt + 1000);
        await reject(f, s, second.payment.id);
        assert.equal(
          (await readFirstWindow(s.o.id))!.effectiveExpiresAt,
          w!.effectiveExpiresAt,
        );
        await assert.rejects(submit(f, s), /closed/);
      } else await assert.rejects(submit(f, s), /closed/);
      assert.equal(count(f, "CheckoutFirstExtension"), 1);
      assert.equal(count(f, "CheckoutPaymentLedger"), 0);
    },
  );
scenario(
  "third late rejection grants no fourth FIRST attempt even inside extension",
  async (f) => {
    const c = clock(),
      s = await reserved(f);
    for (let i = 0; i < 2; i++) {
      const p = await submit(f, s);
      await reject(f, s, p.payment.id);
    }
    const p = await submit(f, s);
    c.set(s.g.createdAt + FIRST_WINDOW_MS + 1);
    await reject(f, s, p.payment.id);
    assert.equal(count(f, "CheckoutFirstExtension"), 1);
    await assert.rejects(submit(f, s), /three/);
  },
);
scenario(
  "pending submitted in extension may be approved after extension expires",
  async (f) => {
    const c = clock(),
      s = await reserved(f),
      p = await submit(f, s);
    c.set(s.g.createdAt + FIRST_WINDOW_MS + 1);
    await reject(f, s, p.payment.id);
    const expiry = (await readFirstWindow(s.o.id))!.effectiveExpiresAt;
    c.set(expiry - 1);
    const p2 = await submit(f, s);
    c.set(expiry + FIRST_WINDOW_MS);
    await approve(f, s, p2.payment.id);
    assert.equal(reservation(f, s.o.id).state, "CONSUMED");
    assert.equal(count(f, "CheckoutFirstExtension"), 1);
  },
);
for (const mode of ["IN_STOCK", "PREORDER"] as const)
  scenario(
    `unpaid ${mode} cancel releases once, stock and promo atomic, replay safe`,
    async (f) => {
      const s = await reserved(f, mode),
        key = randomUUID(),
        before = rows(f, "CartItem");
      await f.cancellations.cancel(s.owner, s.o.id, key, reason);
      await f.cancellations.cancel(s.owner, s.o.id, key, reason);
      assert.equal(reservation(f, s.o.id).state, "RELEASED");
      assert.equal(await promoV2Usage(s.promo.id), 0);
      assert.equal(stock(f), 5);
      assert.deepEqual(rows(f, "CartItem"), before);
      assert.deepEqual(
        rows(f, "PromoReservationEvent").map((e) => e.kind),
        ["RESERVED", "RELEASED"],
      );
    },
  );
scenario(
  "expired timestamp alone holds quota, safe cancellation permits a new reservation",
  async (f) => {
    const c = clock(),
      s = await reserved(f, "IN_STOCK", { usageLimit: 1 });
    c.set(s.g.createdAt + FIRST_WINDOW_MS + 1);
    await assert.rejects(
      create("PREORDER", randomUUID(), { promoCode: s.promo.code }),
      /LIMIT/,
    );
    await f.cancellations.cancel(s.owner, s.o.id, randomUUID(), reason);
    const g = await create("PREORDER", randomUUID(), {
      promoCode: s.promo.code,
    });
    assert.equal(reservation(f, g.orders[0]!.id).state, "RESERVED");
    assert.equal(await promoV2Usage(s.promo.id), 1);
  },
);
scenario(
  "CONSUMED stays used after completed refund; no restoration or new deadline on historical orders",
  async (f) => {
    const s = await reserved(f);
    await pay(f, s.o);
    const request = await f.refunds.request(s.owner, s.o.id, randomUUID(), {
      reason: "Synthetic buyer cancellation",
    });
    await f.refunds.confirm(s.owner, request.refund.id, randomUUID(), {
      confirmedAmount: s.o.firstPaymentAmount,
      bankTransferVerified: true,
      bankOperationReference: randomUUID(),
    });
    assert.equal(reservation(f, s.o.id).state, "CONSUMED");
    assert.equal(await promoV2Usage(s.promo.id), 1);
    assert.equal(stock(f), 5);
    assert.equal(count(f, "PromoReservationEvent"), 2);
  },
);
scenario(
  "default-off, old selected path and historical mixed path remain quarantined from v2",
  async (f) => {
    const s = await reserved(f);
    await add("IN_STOCK");
    await assert.rejects(
      new SaleModeCheckoutCommit(false, true).create("buyer", randomUUID(), {
        saleMode: "IN_STOCK",
        recipient,
        promoCode: s.promo.code,
      }),
      { statusCode: 503 },
    );
    await assert.rejects(
      new SaleModeCheckoutCommit(true, false).create("buyer", randomUUID(), {
        saleMode: "IN_STOCK",
        recipient,
        promoCode: s.promo.code,
      }),
      { statusCode: 409 },
    );
    await assert.rejects(
      new LinkedCheckoutCommit(true).create("buyer", randomUUID(), {
        recipient,
        preorderPercent: 50,
        promoCode: s.promo.code,
      }),
      { statusCode: 409 },
    );
  },
);
scenario(
  "legacy v1 still90 and historical mixed groups have no new FIRST deadlines or attempts",
  async (f) => {
    assert.throws(() => parsePromo({ ...base, value: 91 }), {
      statusCode: 400,
    });
    assert.equal(parsePromoPolicy(base).value, 99);
    const p = await oldPromo({ value: 90 });
    await mixed();
    const g = await new LinkedCheckoutCommit(true).create(
      "buyer",
      randomUUID(),
      { recipient, preorderPercent: 50, promoCode: p.code },
    );
    assert.equal(g.orders.length, 2);
    assert.equal(await readFirstWindow(g.orders[0]!.id), null);
    assert.equal(await promoUsage(p.id), 1);
    assert.deepEqual(await readCheckoutGroup("buyer", g.id), g);
    for (let i = 0; i < 4; i++) {
      const s = {
        o: g.orders[0]!,
        owner: await f.auth("owner"),
        auth: await f.auth(),
      } as Reserved;
      const p = await submit(f, s);
      await reject(f, s, p.payment.id);
    }
    assert.equal(count(f, "CheckoutPayment"), 4);
    assert.equal(count(f, "PromoReservation"), 0);
  },
);
for (const timezone of ["UTC", "Asia/Tashkent", "America/Los_Angeles"])
  scenario(
    `24h/2h epoch math across midnight independent of ${timezone}`,
    async (f) => {
      const start = Date.parse("2026-10-24T23:59:59.999Z"),
        c = clock(start),
        s = await reserved(f);
      const window = await readFirstWindow(s.o.id);
      assert.equal(window!.expiresAt, start + 86400000);
      assert.equal(
        new Intl.DateTimeFormat("en", { timeZone: timezone }).format(
          new Date(start),
        ).length > 0,
        true,
      );
      c.set(window!.expiresAt - 1);
      const p = await submit(f, s);
      c.set(window!.expiresAt);
      await reject(f, s, p.payment.id);
      assert.equal(
        (await readFirstWindow(s.o.id))!.effectiveExpiresAt,
        start + 86400000 + 7200000,
      );
    },
  );

for (const sameKey of [true, false])
  scenario(
    `parallel v2 checkout same tab, same key=${sameKey}: only one reservation`,
    async (f) => {
      const p = await f.foundation.create(await f.auth("owner"), {
        ...base,
        perUserLimit: 10,
      });
      await mixed();
      const key = randomUUID();
      const r = await Promise.allSettled([
        create("IN_STOCK", key, { promoCode: p.code }),
        create("IN_STOCK", sameKey ? key : randomUUID(), { promoCode: p.code }),
      ]);
      assert.equal(
        r.filter((r) => r.status === "fulfilled").length,
        sameKey ? 2 : 1,
      );
      assert.equal(count(f, "CheckoutGroup"), 1);
      assert.equal(count(f, "PromoReservation"), 1);
      assert.equal(stock(f), 4);
      assert.equal(count(f, "CartItem"), 1);
    },
  );
for (const sameUser of [true, false])
  scenario(
    `last global v2 quota, same user=${sameUser}, only one independent checkout wins`,
    async (f) => {
      const p = await f.foundation.create(await f.auth("owner"), {
        ...base,
        usageLimit: 1,
        perUserLimit: 10,
      });
      await add("IN_STOCK");
      await add("PREORDER", sameUser ? "buyer" : "other");
      const r = await Promise.allSettled([
        create("IN_STOCK", randomUUID(), { promoCode: p.code }),
        create(
          "PREORDER",
          randomUUID(),
          { promoCode: p.code },
          sameUser ? "buyer" : "other",
        ),
      ]);
      assert.equal(r.filter((r) => r.status === "fulfilled").length, 1);
      assert.equal(await promoV2Usage(p.id), 1);
      assert.equal(count(f, "CheckoutGroup"), 1);
      assert.equal(count(f, "CartItem"), 1);
      assert.equal(count(f, "PromoReservationEvent"), 1);
    },
  );
scenario(
  "concurrent tabs share account limit despite spare global quota",
  async (f) => {
    const p = await f.foundation.create(await f.auth("owner"), {
      ...base,
      usageLimit: 10,
      perUserLimit: 1,
    });
    await mixed();
    const r = await Promise.allSettled([
      create("IN_STOCK", randomUUID(), { promoCode: p.code }),
      create("PREORDER", randomUUID(), { promoCode: p.code }),
    ]);
    assert.equal(r.filter((r) => r.status === "fulfilled").length, 1);
    assert.equal(await promoV2Usage(p.id, "buyer"), 1);
  },
);
for (const sameKey of [true, false])
  scenario(
    `concurrent FIRST submit, same key=${sameKey}, creates one claim and attempt`,
    async (f) => {
      const s = await reserved(f),
        key = randomUUID();
      const r = await Promise.allSettled([
        submit(f, s, key),
        submit(f, s, sameKey ? key : randomUUID()),
      ]);
      assert.equal(
        r.filter((r) => r.status === "fulfilled").length,
        sameKey ? 2 : 1,
      );
      assert.equal((await readFirstWindow(s.o.id))!.attempts, 1);
      assert.equal(count(f, "CheckoutPayment"), 1);
      assert.equal(count(f, "MediaObject"), 1);
      assert.equal(reservation(f, s.o.id).state, "RESERVED");
    },
  );
scenario(
  "concurrent APPROVE/REJECT chooses one immutable outcome and consumption matches money",
  async (f) => {
    const s = await reserved(f),
      p = await submit(f, s);
    const r = await Promise.allSettled([
      approve(f, s, p.payment.id),
      reject(f, s, p.payment.id),
    ]);
    assert.equal(r.filter((r) => r.status === "fulfilled").length, 1);
    const ledger = count(f, "CheckoutPaymentLedger");
    assert.equal(
      reservation(f, s.o.id).state,
      ledger ? "CONSUMED" : "RESERVED",
    );
    assert.equal(count(f, "PromoReservationEvent"), ledger ? 2 : 1);
  },
);
for (const compete of ["submit", "approve"] as const)
  scenario(
    `cancel competes with ${compete}: no released promo with pending or paid money`,
    async (f) => {
      const s = await reserved(f),
        p = compete === "approve" ? await submit(f, s) : null;
      const r = await Promise.allSettled([
        f.cancellations.cancel(s.owner, s.o.id, randomUUID(), reason),
        p ? approve(f, s, p.payment.id) : submit(f, s),
      ]);
      assert.equal(r.filter((r) => r.status === "fulfilled").length, 1);
      const cancelled = count(f, "CheckoutCancellation"),
        ledger = count(f, "CheckoutPaymentLedger");
      assert.equal(
        reservation(f, s.o.id).state,
        cancelled ? "RELEASED" : ledger ? "CONSUMED" : "RESERVED",
      );
      if (cancelled) {
        assert.equal(count(f, "CheckoutPayment"), 0);
        assert.equal(stock(f), 5);
      } else assert.equal(stock(f), 4);
    },
  );
for (const revoke of ["user", "admin", "owner-config"] as const)
  scenario(
    `owner ${revoke} revoked during ledger batch, money and consumption both denied`,
    async (f) => {
      const s = await reserved(f),
        p = await submit(f, s);
      let injected = false;
      const wrapped: Database = {
        prepare: (sql) => f.db.prepare(sql),
        batch: async (ss) => {
          if (
            !injected &&
            ss.some((s) =>
              (s as unknown as { sql: string }).sql.includes(
                "INSERT INTO CheckoutPaymentLedger(",
              ),
            )
          ) {
            injected = true;
            if (revoke === "user")
              f.sqlite.exec(
                "UPDATE User SET status='BLOCKED' WHERE id='owner'",
              );
            else if (revoke === "admin")
              f.sqlite.exec(
                "UPDATE TelegramAdmin SET isActive=0 WHERE id='owner-admin'",
              );
            else {
              f.config.owner = "900144";
              f.sqlite.exec(
                "UPDATE User SET updatedAt=updatedAt+1 WHERE id='owner'",
              );
            }
          }
          return f.db.batch(ss);
        },
      };
      await assert.rejects(
        withDatabase(wrapped, () => approve(f, s, p.payment.id)),
        { statusCode: 403 },
      );
      assert.ok(injected);
      assert.equal(count(f, "CheckoutPaymentLedger"), 0);
      assert.equal(reservation(f, s.o.id).state, "RESERVED");
      assert.equal(rows(f, "CheckoutPayment")[0]!.status, "SUBMITTED");
    },
  );
for (const actor of ["employee", "buyer", ""])
  scenario(`FIRST consume rejects actor ${actor || "anonymous"}`, async (f) => {
    const s = await reserved(f),
      p = await submit(f, s);
    await assert.rejects(
      f.payments.review(
        actor ? await f.auth(actor) : undefined,
        p.payment.id,
        randomUUID(),
        {
          decision: "APPROVE",
          confirmedAmount: s.o.firstPaymentAmount,
          bankOperationReference: randomUUID(),
        },
      ),
      { statusCode: 403 },
    );
    assert.equal(count(f, "CheckoutPaymentLedger"), 0);
    assert.equal(reservation(f, s.o.id).state, "RESERVED");
  });
for (const table of [
  "PromoReservation",
  "PromoReservationEvent",
  "CheckoutFirstWindow",
] as const)
  scenario(
    `checkout ${table} injection rolls back cart, money contract, stock and quota`,
    async (f) => {
      const p = await f.foundation.create(await f.auth("owner"), base);
      await mixed();
      const before = rows(f, "CartItem"),
        audit = count(f, "AuditLog");
      f.sqlite.exec(
        `CREATE TRIGGER injected BEFORE INSERT ON ${table} BEGIN SELECT RAISE(ABORT,'injected lifecycle failure'); END;`,
      );
      const key = randomUUID();
      await assert.rejects(
        create("IN_STOCK", key, { promoCode: p.code }),
        /injected/,
      );
      for (const t of [
        "CheckoutGroup",
        "CheckoutOrder",
        "CheckoutOrderItem",
        "PromoReservation",
        "PromoReservationEvent",
        "CheckoutFirstWindow",
      ])
        assert.equal(count(f, t), 0, t);
      assert.equal(stock(f), 5);
      assert.equal(count(f, "AuditLog"), audit);
      assert.deepEqual(rows(f, "CartItem"), before);
      f.sqlite.exec("DROP TRIGGER injected");
      await create("IN_STOCK", key, { promoCode: p.code });
      assert.equal(await promoV2Usage(p.id), 1);
    },
  );
for (const action of [
  "promo.reserved",
  "promo.consumed",
  "promo.released",
  "first-window.extended",
] as const)
  scenario(
    `audit ${action} injection rolls back its complete causal operation`,
    async (f) => {
      const c = clock();
      let s: Reserved | undefined;
      let p: Awaited<ReturnType<typeof submit>> | undefined;
      if (action !== "promo.reserved") {
        s = await reserved(f);
        if (action === "promo.consumed" || action === "first-window.extended")
          p = await submit(f, s);
      } else {
        await f.foundation.create(await f.auth("owner"), base);
        await mixed();
      }
      if (action === "first-window.extended")
        c.set(s!.g.createdAt + FIRST_WINDOW_MS + 1);
      const tables = [
        "CartItem",
        "ProductVariant",
        "CheckoutGroup",
        "CheckoutOrder",
        "CheckoutFirstWindow",
        "PromoReservation",
        "PromoReservationEvent",
        "CheckoutPayment",
        "CheckoutPaymentLedger",
        "CheckoutCancellation",
        "CheckoutStockRelease",
        "CheckoutFirstExtension",
        "AuditLog",
      ];
      const before = tables.map((t) => rows(f, t));
      f.sqlite.exec(
        `CREATE TRIGGER injected BEFORE INSERT ON AuditLog WHEN NEW.action='${action}' BEGIN SELECT RAISE(ABORT,'injected lifecycle audit'); END;`,
      );
      await assert.rejects(
        action === "promo.reserved"
          ? create("IN_STOCK", randomUUID(), { promoCode: base.code })
          : action === "promo.consumed"
            ? approve(f, s!, p!.payment.id)
            : action === "promo.released"
              ? f.cancellations.cancel(s!.owner, s!.o.id, randomUUID(), reason)
              : reject(f, s!, p!.payment.id),
        /injected/,
      );
      assert.deepEqual(
        tables.map((t) => rows(f, t)),
        before,
      );
    },
  );
for (const table of ["CheckoutPaymentLedger", "PromoReservationEvent"] as const)
  scenario(
    `FIRST approval ${table} failure leaves pending receipt and RESERVED`,
    async (f) => {
      const s = await reserved(f),
        p = await submit(f, s);
      f.sqlite.exec(
        `CREATE TRIGGER injected BEFORE INSERT ON ${table} BEGIN SELECT RAISE(ABORT,'injected consumption'); END;`,
      );
      await assert.rejects(approve(f, s, p.payment.id), /injected/);
      assert.equal(count(f, "CheckoutPaymentLedger"), 0);
      assert.equal(reservation(f, s.o.id).state, "RESERVED");
      assert.equal(rows(f, "CheckoutPayment")[0]!.status, "SUBMITTED");
    },
  );
scenario("failed private media/payment batch is not an attempt", async (f) => {
  const s = await reserved(f);
  f.sqlite.exec(
    "CREATE TRIGGER injected BEFORE INSERT ON CheckoutPayment BEGIN SELECT RAISE(ABORT,'injected claim'); END;",
  );
  const key = randomUUID();
  await assert.rejects(submit(f, s, key), /injected/);
  assert.equal((await readFirstWindow(s.o.id))!.attempts, 0);
  assert.equal(count(f, "MediaObject"), 0);
  f.sqlite.exec("DROP TRIGGER injected");
  await submit(f, s, key);
  assert.equal((await readFirstWindow(s.o.id))!.attempts, 1);
});
scenario(
  "unsafe stock prevents cancellation and promo release together",
  async (f) => {
    const s = await reserved(f);
    f.sqlite.exec("UPDATE ProductVariant SET stock=NULL WHERE id='v'");
    await assert.rejects(
      f.cancellations.cancel(s.owner, s.o.id, randomUUID(), reason),
      /safely released/,
    );
    assert.equal(count(f, "CheckoutCancellation"), 0);
    assert.equal(reservation(f, s.o.id).state, "RESERVED");
  },
);
scenario(
  "SQL cannot mutate history, consume without FIRST, release without cancellation or extend arbitrarily",
  async (f) => {
    const s = await reserved(f),
      r = reservation(f, s.o.id);
    for (const table of [
      "CheckoutFirstWindow",
      "PromoReservation",
      "PromoReservationEvent",
    ]) {
      assert.throws(
        () => f.sqlite.exec(`UPDATE ${table} SET createdAt=createdAt+1`),
        /immutable/,
      );
      assert.throws(() => f.sqlite.exec(`DELETE FROM ${table}`), /immutable/);
    }
    assert.throws(
      () =>
        f.sqlite
          .prepare(
            "INSERT INTO PromoReservationEvent(id,reservationId,kind,actorId,createdAt,paymentLedgerId) VALUES('fake',?,'CONSUMED','owner',?,'missing')",
          )
          .run(r.id as string, s.g.createdAt),
      /FIRST ledger/,
    );
    assert.throws(
      () =>
        f.sqlite
          .prepare(
            "INSERT INTO PromoReservationEvent(id,reservationId,kind,actorId,createdAt,cancellationId) VALUES('fake',?,'RELEASED','owner',?,'missing')",
          )
          .run(r.id as string, s.g.createdAt),
      /unpaid cancellation/,
    );
    assert.throws(
      () =>
        f.sqlite
          .prepare(
            "INSERT INTO CheckoutFirstExtension(orderId,paymentId,createdBy,decisionAt,expiresAt) VALUES(?,'missing','owner',?,?)",
          )
          .run(
            s.o.id,
            s.g.createdAt + FIRST_WINDOW_MS,
            s.g.createdAt + FIRST_WINDOW_MS + FIRST_EXTENSION_MS,
          ),
      /extension requires/,
    );
  },
);
scenario(
  "FIRST and FINAL counts independent: late FINAL still works after four rejected FINAL attempts",
  async (f) => {
    const c = clock(),
      s = await reserved(f, "PREORDER");
    for (let i = 0; i < 2; i++) {
      const p = await submit(f, s);
      await reject(f, s, p.payment.id);
    }
    const first = await submit(f, s);
    await approve(f, s, first.payment.id);
    c.set(s.g.createdAt + FIRST_WINDOW_MS * 3);
    await f.preorder.arrive(s.owner, s.o.id, randomUUID(), {
      arrivedAt: new Date(c.get()).toISOString(),
      items: s.o.items.map((i) => ({ itemId: i.id, quantity: i.quantity })),
    });
    await f.preorder.assignCargo(s.owner, s.o.id, randomUUID(), { amount: 17 });
    const invoice = await f.preorder.issueInvoice(
      s.owner,
      s.o.id,
      randomUUID(),
    );
    assert.equal(invoice.invoice!.totalDue, 18);
    for (let i = 0; i < 4; i++) {
      const p = await f.payments.submitFinal(
        s.auth,
        s.o.id,
        randomUUID(),
        { declaredAmount: 18 },
        proof(),
      );
      await reject(f, s, p.payment.id);
    }
    const final = await f.payments.submitFinal(
      s.auth,
      s.o.id,
      randomUUID(),
      { declaredAmount: 18 },
      proof(),
    );
    await f.payments.review(s.owner, final.payment.id, randomUUID(), {
      decision: "APPROVE",
      confirmedAmount: 18,
      bankOperationReference: randomUUID(),
    });
    assert.equal((await readFirstWindow(s.o.id))!.attempts, 3);
    assert.equal(count(f, "PromoReservationEvent"), 2);
    assert.equal(reservation(f, s.o.id).state, "CONSUMED");
    const after = (await readCheckoutGroup("buyer", s.g.id)).orders[0]!;
    assert.equal(after.cargoPaid, 17);
    assert.equal(after.unpaidGoods, 0);
  },
);

scenario(
  "v2 replay after expiry and changed cart does not reserve or consume again",
  async (f) => {
    const c = clock(),
      p = await f.foundation.create(await f.auth("owner"), base);
    await mixed();
    const key = randomUUID(),
      g = await create("IN_STOCK", key, { promoCode: p.code });
    await add("IN_STOCK");
    c.set(g.createdAt + FIRST_WINDOW_MS + 1);
    await f.foundation.setActive(await f.auth("owner"), p.id, false);
    const before = rows(f, "CartItem");
    assert.deepEqual(await create("IN_STOCK", key, { promoCode: p.code }), g);
    assert.equal(count(f, "PromoReservation"), 1);
    assert.deepEqual(rows(f, "CartItem"), before);
    assert.equal(stock(f), 4);
    await assert.rejects(create("PREORDER", key, { promoCode: p.code }), {
      statusCode: 409,
    });
  },
);
for (const change of ["price", "disabled", "scope"] as const)
  scenario(
    `v2 checkout CAS revalidates ${change} and snapshots only the final accepted state`,
    async (f) => {
      const owner = await f.auth("owner"),
        p = await f.foundation.create(owner, {
          ...base,
          scope: "CATEGORIES",
          categoryIds: ["c"],
        });
      await mixed();
      let injected = false;
      const wrapped: Database = {
        prepare: (sql) => f.db.prepare(sql),
        batch: async (ss) => {
          if (
            !injected &&
            ss.some((s) =>
              (s as unknown as { sql: string }).sql.includes(
                "INSERT INTO PromoReservation(",
              ),
            )
          ) {
            injected = true;
            if (change === "price")
              f.sqlite.exec("UPDATE Product SET price=205 WHERE id='p'");
            else if (change === "disabled")
              await f.run(() => f.foundation.setActive(owner, p.id, false));
            else
              f.sqlite.exec(
                "INSERT INTO Category(id,nameRu,nameUz,slug,requiresBuyerMeasurements,updatedAt) VALUES('other','Other','Other','other',0,1); UPDATE Product SET categoryId='other' WHERE id='p'",
              );
          }
          return f.db.batch(ss);
        },
      };
      const operation = () =>
        withDatabase(wrapped, () =>
          create("IN_STOCK", randomUUID(), { promoCode: p.code }),
        );
      if (change === "price") {
        const g = await operation();
        assert.equal(g.goodsSubtotal, 205);
        assert.equal(g.discountAmount, 202);
        assert.equal(g.goodsTotal, 3);
      } else {
        await assert.rejects(operation());
        assert.equal(count(f, "PromoReservation"), 0);
        assert.equal(count(f, "CheckoutGroup"), 0);
        assert.equal(stock(f), 5);
        assert.equal(count(f, "CartItem"), 2);
      }
    },
  );
scenario(
  "PREORDER FIRST100 with promo keeps FINAL0 legal without another payment/consumption",
  async (f) => {
    const p = await f.foundation.create(await f.auth("owner"), base);
    await add("PREORDER");
    const g = await create("PREORDER", randomUUID(), {
        promoCode: p.code,
        preorderPercent: 100,
      }),
      o = g.orders[0]!,
      { owner } = await pay(f, o);
    await f.preorder.arrive(owner, o.id, randomUUID(), {
      arrivedAt: new Date().toISOString(),
      items: o.items.map((i) => ({ itemId: i.id, quantity: i.quantity })),
    });
    await f.preorder.assignCargo(owner, o.id, randomUUID(), { amount: 0 });
    const invoice = await f.preorder.issueInvoice(owner, o.id, randomUUID());
    assert.equal(invoice.invoice!.totalDue, 0);
    assert.equal(count(f, "CheckoutPaymentLedger"), 1);
    assert.equal(count(f, "PromoReservationEvent"), 2);
    assert.equal(reservation(f, o.id).state, "CONSUMED");
  },
);

async function historicalData(f: ReturnType<typeof services>) {
  const p = await oldPromo({ perUserLimit: 10, usageLimit: 10 });
  await add("LEGACY");
  await new D1OrderRepository().checkout({
    userId: "buyer",
    publicId: "STZ-SYNTHETIC",
    idempotencyKey: randomUUID(),
    recipient,
    promoCode: p.code,
    prepare: prepareOrder,
  });
  await mixed();
  const group = await new LinkedCheckoutCommit(true).create(
    "buyer",
    randomUUID(),
    { recipient, preorderPercent: 100, promoCode: p.code },
  );
  const ready = group.orders.find((o) => o.saleMode === "IN_STOCK")!,
    pre = group.orders.find((o) => o.saleMode === "PREORDER")!;
  const { owner } = await pay(f, ready);
  await pay(f, pre);
  const refund = await f.refunds.request(owner, ready.id, randomUUID(), {
    reason: "Synthetic historical refund",
  });
  await f.refunds.confirm(owner, refund.refund.id, randomUUID(), {
    confirmedAmount: ready.firstPaymentAmount,
    bankTransferVerified: true,
    bankOperationReference: randomUUID(),
  });
  await f.foundation.create(owner, { ...base, code: "EXISTING99" });
  return readCheckoutGroup("buyer", group.id);
}
test("0028 populated SQLite upgrade/rollback preserves every old table row, FK, legacy quota and financial snapshot", async () => {
  const f = fixture("0027");
  try {
    await f.run(async () => {
      const old = await historicalData(f);
      const tables = f.sqlite
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT GLOB '_cf_*' AND name<>'_Revision' ORDER BY name",
        )
        .all()
        .map((r) => r.name as string);
      const before = tables.map((t) => rows(f, t));
      f.sqlite.exec("BEGIN IMMEDIATE");
      try {
        f.sqlite.exec(migration());
        f.sqlite.exec("SELECT * FROM injected_upgrade_failure");
        assert.fail("must fail");
      } catch {
        f.sqlite.exec("ROLLBACK");
      }
      assert.deepEqual(
        tables.map((t) => rows(f, t)),
        before,
      );
      assert.equal(
        f.sqlite
          .prepare(
            "SELECT name FROM sqlite_master WHERE name='PromoReservation'",
          )
          .get(),
        undefined,
      );
      f.sqlite.exec("BEGIN IMMEDIATE");
      f.sqlite.exec(migration());
      f.sqlite.exec("COMMIT");
      assert.deepEqual(
        tables.map((t) => rows(f, t)),
        before,
      );
      assert.deepEqual(await readCheckoutGroup("buyer", old.id), old);
      assert.equal(count(f, "PromoReservation"), 0);
      assert.deepEqual(f.sqlite.prepare("PRAGMA foreign_key_check").all(), []);
      assert.equal(
        f.sqlite.prepare("PRAGMA integrity_check").get()!.integrity_check,
        "ok",
      );
      await add("PREORDER");
      await create("PREORDER", randomUUID(), { promoCode: "EXISTING99" });
      assert.equal(count(f, "PromoReservation"), 1);
    });
  } finally {
    f.sqlite.close();
  }
});
test("0028 actual isolated Miniflare D1 populated migration/rollback, competing quota, FIRST consumption/cancel release, no routes/cron/outbound", async () => {
  const f = await marketingRuntime("0", "0027");
  try {
    await f.db.exec(seed);
    const svc = services(),
      buyer = await runtimeUser(f, 900141);
    await withDatabase(f.db as unknown as Database, async () => {
      const old = await historicalData(svc);
      const tables = (
        await f.db
          .prepare(
            "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT GLOB '_cf_*' AND name<>'_Revision' ORDER BY name",
          )
          .all<{ name: string }>()
      ).results.map((r) => r.name);
      const read = async (t: string) =>
        (await f.db.prepare(`SELECT * FROM "${t}" ORDER BY rowid`).all())
          .results;
      const before = await Promise.all(tables.map(read));
      await assert.rejects(
        f.db.batch([
          ...statements().map((sql) => f.db.prepare(sql)),
          f.db.prepare("SELECT * FROM injected_upgrade_failure"),
        ]),
      );
      assert.deepEqual(await Promise.all(tables.map(read)), before);
      await f.db.batch(statements().map((sql) => f.db.prepare(sql)));
      assert.deepEqual(await Promise.all(tables.map(read)), before);
      assert.deepEqual(await readCheckoutGroup("buyer", old.id), old);
      const owner = await svc.auth("owner"),
        promo = await svc.foundation.create(owner, {
          ...base,
          code: "ONEQUOTA",
          usageLimit: 1,
          perUserLimit: 10,
        });
      await mixed();
      const outcomes = await Promise.allSettled([
        create("IN_STOCK", randomUUID(), { promoCode: promo.code }),
        create("PREORDER", randomUUID(), { promoCode: promo.code }),
      ]);
      assert.equal(outcomes.filter((o) => o.status === "fulfilled").length, 1);
      const winner = outcomes.find(
        (o) => o.status === "fulfilled",
      ) as PromiseFulfilledResult<Awaited<ReturnType<typeof create>>>;
      await pay(svc, winner.value.orders[0]!);
      assert.equal(await promoV2Usage(promo.id), 1);
      assert.equal(
        (await f.db
          .prepare(
            "SELECT state FROM PromoReservationState WHERE promoCodeId=?",
          )
          .bind(promo.id)
          .first<{ state: string }>())!.state,
        "CONSUMED",
      );
      const cancelPromo = await svc.foundation.create(owner, {
        ...base,
        code: "CANCEL",
      });
      const mode =
        winner.value.orders[0]!.saleMode === "IN_STOCK"
          ? "PREORDER"
          : "IN_STOCK";
      const cancelled = await create(mode, randomUUID(), {
        promoCode: cancelPromo.code,
      });
      await svc.cancellations.cancel(
        owner,
        cancelled.orders[0]!.id,
        randomUUID(),
        reason,
      );
      assert.equal(await promoV2Usage(cancelPromo.id), 0);
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
      "/promo-reservations",
      "/promo-reservations/release",
      "/admin/promo-reservations",
      "/checkout/expiry",
    ])
      for (const role of ["anonymous", "buyer", "admin"]) {
        const r = await f.call(
          path,
          "POST",
          {},
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
          [403, 404, 503].includes(r.status),
          `${path} ${role}: ${r.status}`,
        );
      }
    assert.equal(f.outboundCalls(), 0);
  } finally {
    await f.mf.dispose();
  }
});
