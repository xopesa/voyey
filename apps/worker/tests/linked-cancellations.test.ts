import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { withDatabase, type Database } from "@stenzo/database";
import { isolatedD1 } from "./helpers/sqlite.js";
import { marketingRuntime } from "./helpers/marketing-runtime.js";
import { runtimeUser } from "./helpers/customer-operations.js";
import { png } from "../../api/tests/fixtures/images.js";
import { D1CartRepository } from "../../api/src/d1/repositories.js";
import { LinkedCheckoutCommit } from "../../api/src/modules/checkout/group-commit.js";
import { readCheckoutGroup } from "../../api/src/modules/checkout/group-store.js";
import { LinkedCheckoutPayments } from "../../api/src/modules/checkout/linked-payments.js";
import { PreorderFinance } from "../../api/src/modules/checkout/preorder-finance.js";
import { VoyeyOwnerAuthority } from "../../api/src/modules/admin/owner.js";
import { JwtTokenService } from "../../api/src/modules/auth/token.js";
import { PromoCodeService } from "../../api/src/modules/marketing/promo-codes.js";
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
    new URL(
      "../migrations/0024_linked_checkout_cancellations.sql",
      import.meta.url,
    ),
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

const reason = { reason: "Owner cancellation: synthetic fixture" };
const stock = (f: Fixture, id = "v") =>
  (
    f.sqlite.prepare("SELECT stock FROM ProductVariant WHERE id=?").get(id) as {
      stock: number | null;
    }
  ).stock;
const rows = (f: Fixture, table: string) =>
  f.sqlite
    .prepare(`SELECT * FROM "${table}" ORDER BY rowid`)
    .all()
    .map((r) => ({ ...r }));
function scenario(name: string, operation: (f: Fixture) => Promise<void>) {
  test(name, async () => {
    const f = fixture();
    try {
      await f.run(() => operation(f));
    } finally {
      f.sqlite.close();
    }
  });
}
async function cancel(
  f: Fixture,
  orderId: string,
  key: string = randomUUID(),
  value: unknown = reason,
) {
  return f.cancellations.cancel(await f.auth("owner"), orderId, key, value);
}
const orderArrival = (
  o: Awaited<ReturnType<typeof group>>["orders"][number],
) => ({
  arrivedAt: new Date().toISOString(),
  items: o.items.map((i) => ({ itemId: i.id, quantity: i.quantity })),
});

scenario(
  "unpaid IN_STOCK releases exactly the recorded reservations and exposes terminal projection, preserving contracts",
  async (f) => {
    const g = await group(["IN_STOCK"], 50, true),
      o = g.orders[0]!;
    const before = rows(f, "CheckoutOrder"),
      items = rows(f, "CheckoutOrderItem");
    assert.equal(stock(f), 4);
    assert.equal(stock(f, "v2"), 3);
    const c = await cancel(f, o.id);
    assert.equal(stock(f), 5);
    assert.equal(stock(f, "v2"), 5);
    assert.equal(count(f, "CheckoutStockRelease"), 2);
    assert.equal(c.financialSnapshot.goodsPaid, 0);
    assert.equal(c.financialSnapshot.goodsTotal, 303);
    assert.equal(
      c.reservationSnapshot.reduce(
        (n, i) => n + i.inventoryReservedQuantity,
        0,
      ),
      3,
    );
    assert.equal(c.createdBy, "owner");
    assert.equal(c.reason, reason.reason);
    assert.equal(c.sealed, 1);
    const state = await readOrderFinance(o.id);
    assert.equal(state.orderState, "CANCELLED");
    assert.equal(state.cancellationId, c.id);
    assert.equal(state.paymentAllowed, 0);
    assert.equal(state.fulfillmentAllowed, 0);
    assert.equal(state.finalPaymentEnabled, 0);
    assert.equal(state.cargoEnabled, 0);
    assert.equal(
      (await readCheckoutGroup("buyer", g.id)).orders[0]!.orderState,
      "CANCELLED",
    );
    assert.deepEqual(rows(f, "CheckoutOrder"), before);
    assert.deepEqual(rows(f, "CheckoutOrderItem"), items);
    assert.equal(
      (
        f.sqlite
          .prepare(
            "SELECT COUNT(*) n FROM AuditLog WHERE action='linked-order.stock-released'",
          )
          .get() as { n: number }
      ).n,
      2,
    );
    assert.deepEqual(f.sqlite.prepare("PRAGMA foreign_key_check").all(), []);
  },
);
scenario(
  "unpaid PREORDER stock=0: no inventory release, even after arrival and cargo",
  async (f) => {
    f.sqlite.exec("UPDATE ProductVariant SET stock=0");
    const g = await group(),
      o = g.orders[0]!,
      owner = await f.auth("owner");
    await f.preorder.arrive(owner, o.id, randomUUID(), orderArrival(o));
    await f.preorder.assignCargo(owner, o.id, randomUUID(), { amount: 17 });
    const oldArrival = rows(f, "CheckoutArrival"),
      oldCargo = rows(f, "CheckoutCargoCharge");
    const c = await cancel(f, o.id);
    assert.equal(c.financialSnapshot.cargoAmount, 17);
    assert.ok(c.financialSnapshot.arrivalId);
    assert.equal(stock(f), 0);
    assert.equal(count(f, "CheckoutStockRelease"), 0);
    assert.deepEqual(rows(f, "CheckoutArrival"), oldArrival);
    assert.deepEqual(rows(f, "CheckoutCargoCharge"), oldCargo);
    assert.equal((await readOrderFinance(o.id)).cargoEnabled, 0);
  },
);
scenario(
  "same cancellation key and intent replay returns same record, never a second stock release",
  async (f) => {
    const g = await group(["IN_STOCK"]),
      id = g.orders[0]!.id,
      key = randomUUID();
    const c = await cancel(f, id, key),
      releases = rows(f, "CheckoutStockRelease");
    assert.deepEqual(await cancel(f, id, key), c);
    assert.deepEqual(rows(f, "CheckoutStockRelease"), releases);
    assert.equal(stock(f), 5);
    assert.equal(count(f, "CheckoutCancellation"), 1);
  },
);
scenario(
  "incompatible cancellation key, reason and cross-order key reuse are denied",
  async (f) => {
    const a = (await group(["IN_STOCK"])).orders[0]!,
      b = (await group()).orders[0]!,
      key = randomUUID();
    await cancel(f, a.id, key);
    await assert.rejects(cancel(f, a.id, key, { reason: "Different intent" }), {
      statusCode: 409,
    });
    await assert.rejects(cancel(f, a.id, randomUUID()), { statusCode: 409 });
    await assert.rejects(cancel(f, b.id, key), { statusCode: 409 });
    assert.equal(count(f, "CheckoutCancellation"), 1);
  },
);
for (const same of [true, false])
  scenario(
    `two concurrent cancellations, same key=${same}, release once`,
    async (f) => {
      const id = (await group(["IN_STOCK"])).orders[0]!.id,
        key = randomUUID();
      const outcomes = await Promise.allSettled([
        cancel(f, id, key),
        cancel(f, id, same ? key : randomUUID()),
      ]);
      assert.equal(
        outcomes.filter((r) => r.status === "fulfilled").length,
        same ? 2 : 1,
      );
      assert.equal(count(f, "CheckoutCancellation"), 1);
      assert.equal(count(f, "CheckoutStockRelease"), 1);
      assert.equal(stock(f), 5);
    },
  );
for (const target of ["release", "audit", "seal"])
  scenario(
    `${target} failure rolls back cancellation, stock, events, audit and projection`,
    async (f) => {
      const o = (await group(["IN_STOCK"], 50, true)).orders[0]!,
        before = rows(f, "AuditLog");
      f.sqlite.exec(
        target === "release"
          ? "CREATE TRIGGER injected BEFORE INSERT ON CheckoutStockRelease WHEN NEW.variantId='v2' BEGIN SELECT RAISE(ABORT,'injected release failure'); END"
          : target === "audit"
            ? "CREATE TRIGGER injected BEFORE INSERT ON AuditLog WHEN NEW.action='linked-order.cancelled' BEGIN SELECT RAISE(ABORT,'injected audit failure'); END"
            : "CREATE TRIGGER injected BEFORE UPDATE ON CheckoutCancellation BEGIN SELECT RAISE(ABORT,'injected seal failure'); END",
      );
      const key = randomUUID();
      await assert.rejects(cancel(f, o.id, key), /injected/);
      assert.equal(stock(f), 4);
      assert.equal(stock(f, "v2"), 3);
      assert.equal(count(f, "CheckoutCancellation"), 0);
      assert.equal(count(f, "CheckoutStockRelease"), 0);
      assert.deepEqual(rows(f, "AuditLog"), before);
      assert.equal(
        (await readOrderFinance(o.id)).orderState,
        "PAYMENTS_BLOCKED",
      );
      f.sqlite.exec("DROP TRIGGER injected");
      await cancel(f, o.id, key);
      assert.equal(stock(f), 5);
      assert.equal(stock(f, "v2"), 5);
    },
  );
for (const change of [
  "stock=NULL",
  "isActive=0",
  "stock=2147483647",
  "productId='other-product'",
])
  scenario(`unsafe current SKU ${change} denies entire release`, async (f) => {
    const o = (await group(["IN_STOCK"], 50, true)).orders[0]!;
    if (change.startsWith("productId"))
      f.sqlite.exec(
        "INSERT INTO Product(id,categoryId,nameRu,nameUz,slug,price,status,updatedAt) VALUES('other-product','c','Fixture2','Fixture2','p2',101,'ACTIVE',1)",
      );
    f.sqlite.exec(`UPDATE ProductVariant SET ${change} WHERE id='v2'`);
    await assert.rejects(cancel(f, o.id), { statusCode: 409 });
    assert.equal(count(f, "CheckoutCancellation"), 0);
    assert.equal(count(f, "CheckoutStockRelease"), 0);
    assert.equal(stock(f), 4);
  });
scenario(
  "confirmed FIRST cannot cancel and preserves payment, ledger, proofs and inventory",
  async (f) => {
    const s = await first(f),
      payments = rows(f, "CheckoutPayment"),
      ledger = rows(f, "CheckoutPaymentLedger");
    await assert.rejects(cancel(f, s.order.id), /refund process/);
    assert.deepEqual(rows(f, "CheckoutPayment"), payments);
    assert.deepEqual(rows(f, "CheckoutPaymentLedger"), ledger);
    assert.equal(count(f, "CheckoutCancellation"), 0);
    assert.deepEqual(
      (await f.payments.proof(s.auth, s.payment.payment.id)).data,
      png,
    );
  },
);
scenario(
  "confirmed FINAL cannot cancel, immutable GOODS/CARGO allocations remain",
  async (f) => {
    const s = await submittedFinal(f);
    await f.payments.review(
      s.owner,
      s.final.payment.id,
      randomUUID(),
      decision(67),
    );
    const ledger = rows(f, "CheckoutPaymentLedger");
    await assert.rejects(cancel(f, s.order.id), /refund process/);
    assert.deepEqual(rows(f, "CheckoutPaymentLedger"), ledger);
    assert.equal(count(f, "CheckoutCancellation"), 0);
  },
);
scenario(
  "SUBMITTED receipt blocks cancellation without any partial side effects",
  async (f) => {
    const s = await first(f, 50, false, false),
      before = rows(f, "AuditLog");
    await assert.rejects(cancel(f, s.order.id), /pending review/);
    assert.equal(count(f, "CheckoutCancellation"), 0);
    assert.equal(count(f, "CheckoutStockRelease"), 0);
    assert.deepEqual(rows(f, "AuditLog"), before);
  },
);
scenario(
  "REJECTED receipt allows cancellation, history/proof reads remain; all payment writer replays denied",
  async (f) => {
    const s = await first(f, 50, false, false),
      reviewKey = randomUUID(),
      rejection = { decision: "REJECT", reason: "NOT_RECEIVED" };
    await f.payments.review(
      s.owner,
      s.payment.payment.id,
      reviewKey,
      rejection,
    );
    const before = rows(f, "CheckoutPayment");
    await cancel(f, s.order.id);
    assert.deepEqual(rows(f, "CheckoutPayment"), before);
    assert.deepEqual(
      (await f.payments.proof(s.auth, s.payment.payment.id)).data,
      png,
    );
    await assert.rejects(
      f.payments.review(s.owner, s.payment.payment.id, reviewKey, rejection),
      /cancelled/,
    );
    await assert.rejects(
      f.payments.review(
        s.owner,
        s.payment.payment.id,
        randomUUID(),
        decision(51),
      ),
      /cancelled/,
    );
    await assert.rejects(
      f.payments.submit(
        s.auth,
        s.order.id,
        randomUUID(),
        { declaredAmount: 51 },
        proof(),
      ),
      /cancelled/,
    );
    await assert.rejects(
      f.payments.submitFinal(
        s.auth,
        s.order.id,
        randomUUID(),
        { declaredAmount: 1 },
        proof(),
      ),
      /cancelled/,
    );
    await assert.rejects(
      f.payments.instructions(s.auth, s.order.id),
      /cancelled/,
    );
    await assert.rejects(
      f.payments.finalInstructions(s.auth, s.order.id),
      /cancelled/,
    );
    assert.equal(
      (await f.payments.state(s.auth, s.order.id)).orderState,
      "CANCELLED",
    );
    assert.equal(
      (await f.payments.reviewState(s.owner, s.payment.payment.id)).finance
        .orderState,
      "CANCELLED",
    );
    assert.equal(count(f, "CheckoutPaymentLedger"), 0);
  },
);
scenario(
  "cancel vs approve: pending or confirmed cash always wins over unsafe cancellation",
  async (f) => {
    const s = await first(f, 50, false, false);
    const r = await Promise.allSettled([
      cancel(f, s.order.id),
      f.payments.review(
        s.owner,
        s.payment.payment.id,
        randomUUID(),
        decision(51),
      ),
    ]);
    assert.equal(r[0]!.status, "rejected");
    assert.equal(r[1]!.status, "fulfilled");
    assert.equal(count(f, "CheckoutCancellation"), 0);
    assert.equal(count(f, "CheckoutPaymentLedger"), 1);
  },
);
for (const winner of ["submit", "cancel"])
  scenario(
    `CAS cancel vs submit forced ${winner} wins, no orphan proof/reserve`,
    async (f) => {
      const o = (await group(["IN_STOCK"])).orders[0]!,
        auth = await f.auth(),
        owner = await f.auth("owner");
      let raced = false;
      const wrapped: Database = {
        prepare: (sql) => f.db.prepare(sql),
        batch: async (statements) => {
          const sql = statements
            .map((s) => (s as unknown as { sql: string }).sql)
            .join(" ");
          if (
            !raced &&
            sql.includes(
              winner === "submit"
                ? "INSERT INTO CheckoutCancellation"
                : "INSERT INTO CheckoutPayment(",
            )
          ) {
            raced = true;
            await f.run(() =>
              winner === "submit"
                ? f.payments.submit(
                    auth,
                    o.id,
                    randomUUID(),
                    { declaredAmount: 101 },
                    proof(),
                  )
                : f.cancellations.cancel(owner, o.id, randomUUID(), reason),
            );
          }
          return f.db.batch(statements);
        },
      };
      await assert.rejects(
        withDatabase(wrapped, () =>
          winner === "submit"
            ? f.cancellations.cancel(owner, o.id, randomUUID(), reason)
            : f.payments.submit(
                auth,
                o.id,
                randomUUID(),
                { declaredAmount: 101 },
                proof(),
              ),
        ),
        winner === "submit" ? /pending review/ : /cancelled/,
      );
      assert.ok(raced);
      assert.equal(
        count(f, "CheckoutCancellation"),
        winner === "cancel" ? 1 : 0,
      );
      assert.equal(count(f, "CheckoutPayment"), winner === "submit" ? 1 : 0);
      assert.equal(count(f, "MediaObject"), winner === "submit" ? 1 : 0);
      assert.equal(stock(f), winner === "cancel" ? 5 : 4);
      assert.equal(count(f, "CheckoutPaymentLedger"), 0);
    },
  );
scenario(
  "post-cancel arrival, CARGO, invoice and their idempotent replays are terminally denied",
  async (f) => {
    const o = (await group()).orders[0]!,
      owner = await f.auth("owner"),
      aKey = randomUUID(),
      a = orderArrival(o),
      cKey = randomUUID();
    await f.preorder.arrive(owner, o.id, aKey, a);
    await f.preorder.assignCargo(owner, o.id, cKey, { amount: 17 });
    await cancel(f, o.id);
    const before = rows(f, "CheckoutArrival"),
      cargo = rows(f, "CheckoutCargoCharge");
    await assert.rejects(f.preorder.arrive(owner, o.id, aKey, a), /cancelled/);
    await assert.rejects(
      f.preorder.arrive(owner, o.id, randomUUID(), a),
      /cancelled/,
    );
    await assert.rejects(
      f.preorder.assignCargo(owner, o.id, cKey, { amount: 17 }),
      /cancelled/,
    );
    await assert.rejects(
      f.preorder.issueInvoice(owner, o.id, randomUUID()),
      /cancelled/,
    );
    assert.deepEqual(rows(f, "CheckoutArrival"), before);
    assert.deepEqual(rows(f, "CheckoutCargoCharge"), cargo);
    assert.equal(count(f, "CheckoutFinalInvoice"), 0);
  },
);
scenario(
  "mixed siblings independent: one child paid and active, other unpaid cancelled; promo usage/allocations retained",
  async (f) => {
    const code = await new PromoCodeService().save("owner", {
      code: "MIXEDFIXTURE",
      type: "FIXED",
      value: 20,
      usageLimit: 1,
      perUserLimit: 1,
      isActive: true,
    });
    const g = await group(["IN_STOCK", "PREORDER"], 50, false, code.code),
      inStock = g.orders.find((o) => o.saleMode === "IN_STOCK")!,
      pre = g.orders.find((o) => o.saleMode === "PREORDER")!;
    const p = await f.payments.submit(
      await f.auth(),
      pre.id,
      randomUUID(),
      { declaredAmount: pre.firstPaymentAmount },
      proof(),
    );
    await f.payments.review(
      await f.auth("owner"),
      p.payment.id,
      randomUUID(),
      decision(pre.firstPaymentAmount),
    );
    const sibling = await readOrderFinance(pre.id),
      promo = rows(f, "CheckoutPromoUse"),
      contracts = rows(f, "CheckoutOrder");
    await cancel(f, inStock.id);
    assert.equal(stock(f), 5);
    assert.deepEqual(await readOrderFinance(pre.id), sibling);
    assert.deepEqual(rows(f, "CheckoutPromoUse"), promo);
    assert.deepEqual(rows(f, "CheckoutOrder"), contracts);
    const next = await group(["IN_STOCK"]);
    assert.ok(next.id);
    await new D1CartRepository().addItem("buyer", {
      productId: "p",
      variantId: "v",
      quantity: 1,
      saleMode: "IN_STOCK",
      heightCm: null,
      weightKg: null,
    });
    await assert.rejects(
      new LinkedCheckoutCommit(true).create("buyer", randomUUID(), {
        recipient,
        promoCode: code.code,
      }),
      { statusCode: 409 },
    );
    assert.equal(count(f, "CheckoutPromoUse"), 1);
  },
);
for (const identity of ["employee", "buyer", WEB_ADMIN_ACTOR, ""])
  scenario(
    `only owner can cancel; actor=${identity || "anonymous"}`,
    async (f) => {
      const o = (await group(["IN_STOCK"])).orders[0]!;
      await assert.rejects(
        f.cancellations.cancel(
          identity ? await f.auth(identity) : undefined,
          o.id,
          randomUUID(),
          reason,
        ),
        { statusCode: 403 },
      );
      assert.equal(count(f, "CheckoutCancellation"), 0);
      assert.equal(stock(f), 4);
      assert.equal(
        (
          f.sqlite
            .prepare(
              "SELECT COUNT(*) n FROM AuditLog WHERE action='owner.denied'",
            )
            .get() as { n: number }
        ).n,
        1,
      );
    },
  );
scenario(
  "owner revoked during cancellation batch: CAS retry rechecks authority and denies",
  async (f) => {
    const o = (await group(["IN_STOCK"])).orders[0]!,
      auth = await f.auth("owner");
    let revoked = false;
    const wrapped: Database = {
      prepare: (sql) => f.db.prepare(sql),
      batch: async (statements) => {
        if (
          !revoked &&
          statements.some((s) =>
            (s as unknown as { sql: string }).sql.includes(
              "INSERT INTO CheckoutCancellation",
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
      withDatabase(wrapped, () =>
        f.cancellations.cancel(auth, o.id, randomUUID(), reason),
      ),
      { statusCode: 403 },
    );
    assert.ok(revoked);
    assert.equal(stock(f), 4);
    assert.equal(count(f, "CheckoutCancellation"), 0);
    assert.equal(count(f, "CheckoutStockRelease"), 0);
  },
);
scenario(
  "malformed requests, missing owner configuration, missing order and default gate fail closed",
  async (f) => {
    const o = (await group()).orders[0]!,
      auth = await f.auth("owner");
    await assert.rejects(
      new LinkedCheckoutCancellations(f.owner).cancel(
        auth,
        o.id,
        randomUUID(),
        reason,
      ),
      { statusCode: 503 },
    );
    for (const value of [
      { reason: "" },
      { reason: "x", actorId: "owner" },
      { reason: "x", amount: 1 },
    ])
      await assert.rejects(cancel(f, o.id, randomUUID(), value), {
        statusCode: 400,
      });
    await assert.rejects(cancel(f, o.id, "short"), { statusCode: 400 });
    await assert.rejects(cancel(f, "missing"), { statusCode: 404 });
    f.config.owner = "";
    await assert.rejects(cancel(f, o.id), { statusCode: 503 });
    assert.equal(count(f, "CheckoutCancellation"), 0);
  },
);
scenario(
  "SQL rejects post-cancel money/arrival/cargo/invoice inserts, review updates and immutable history changes",
  async (f) => {
    const s = await first(f, 50, false, false);
    await f.payments.review(s.owner, s.payment.payment.id, randomUUID(), {
      decision: "REJECT",
      reason: "NOT_RECEIVED",
    });
    const c = await cancel(f, s.order.id);
    const attempts = [
      `INSERT INTO CheckoutPayment(id,orderId,source,submittedBy,attachedBy,submitKey,submitFingerprint,declaredAmount,expectedAmount,proofStorageKey,proofMimeType,proofSize,proofSha256,submittedAt) SELECT 'forged',orderId,source,submittedBy,attachedBy,'another-submit-key',submitFingerprint,declaredAmount,expectedAmount,proofStorageKey,proofMimeType,proofSize,proofSha256,submittedAt FROM CheckoutPayment`,
      `INSERT INTO CheckoutPaymentLedger(id,paymentId,orderId,phase,kind,goodsAmount,bankOperationDigest,verifiedBy,verifiedAt,reviewKey,reviewFingerprint) VALUES('l','${s.payment.payment.id}','${s.order.id}','FIRST','MANUAL_CARD_TRANSFER',51,'${"a".repeat(64)}','owner',${Date.now()},'review-key-forged','${"b".repeat(64)}')`,
      `INSERT INTO CheckoutArrival(id,orderId,arrivedAt,itemSnapshot,createdBy,createdAt,operationKey,requestFingerprint) VALUES('a','${s.order.id}',${Date.now()},'[]','owner',${Date.now()},'arrival-key-forged','${"b".repeat(64)}')`,
      `INSERT INTO CheckoutCargoCharge(id,orderId,arrivalId,version,amount,createdBy,createdAt,operationKey,requestFingerprint) VALUES('c','${s.order.id}','missing',1,1,'owner',${Date.now()},'cargo-key-forged','${"b".repeat(64)}')`,
      `INSERT INTO CheckoutFinalInvoice(id,orderId,arrivalId,cargoChargeId,firstLedgerId,version,currency,goodsTotal,firstGoodsPaid,goodsDue,cargoDue,totalDue,createdBy,createdAt,operationKey,requestFingerprint) VALUES('i','${s.order.id}','a','c','l',1,'UZS',101,51,50,1,51,'owner',${Date.now()},'invoice-key-forged','${"b".repeat(64)}')`,
      `UPDATE CheckoutPayment SET status='APPROVED' WHERE id='${s.payment.payment.id}'`,
    ];
    for (const sql of attempts)
      assert.throws(() => f.sqlite.exec(sql), /cancelled/);
    for (const table of [
      "CheckoutCancellation",
      "CheckoutOrder",
      "CheckoutOrderItem",
      "CheckoutPayment",
    ])
      assert.throws(() => f.sqlite.exec(`DELETE FROM ${table}`));
    assert.throws(
      () =>
        f.sqlite.exec(
          `UPDATE CheckoutCancellation SET sealed=0 WHERE id='${c.id}'`,
        ),
      /immutable/,
    );
    assert.throws(
      () =>
        f.sqlite.exec(
          `UPDATE CheckoutCancellation SET reason='changed' WHERE id='${c.id}'`,
        ),
      /immutable/,
    );
    assert.equal(count(f, "CheckoutPaymentLedger"), 0);
  },
);
scenario(
  "SQL release cannot exceed reservation, duplicate release or release PREORDER; history immutable",
  async (f) => {
    const o = (await group(["IN_STOCK"])).orders[0]!,
      c = await cancel(f, o.id),
      r = rows(f, "CheckoutStockRelease")[0]!;
    assert.throws(
      () => f.sqlite.exec("UPDATE CheckoutStockRelease SET quantity=2"),
      /immutable/,
    );
    assert.throws(
      () => f.sqlite.exec("DELETE FROM CheckoutStockRelease"),
      /immutable/,
    );
    assert.throws(
      () =>
        f.sqlite
          .prepare(
            "INSERT INTO CheckoutStockRelease(id,cancellationId,orderId,itemId,variantId,quantity,stockBefore,stockAfter,createdAt) VALUES(?,?,?,?,?,?,?,?,?)",
          )
          .run(
            randomUUID(),
            c.id,
            o.id,
            r.itemId as string,
            "v",
            2,
            5,
            7,
            c.createdAt,
          ),
      /unsafe/,
    );
    assert.equal(stock(f), 5);
    assert.equal(count(f, "CheckoutStockRelease"), 1);
  },
);
scenario(
  "legacy cancellation and money refund remain in old tables, shared admin rights unchanged",
  async (f) => {
    f.sqlite
      .exec(`INSERT INTO "Order"(id,publicId,userId,idempotencyKey,fullName,phone,city,address,subtotal,total,requiredPrepayment,remainingAmount,updatedAt) VALUES('legacy','LEGACY','buyer','legacy-cancel-key','Synthetic','1234567','Fixture','Fixture',101,101,51,50,1);
 INSERT INTO OrderItem(id,orderId,productId,variantId,quantity,unitPrice,lineTotal,inventoryReservedQuantity,productNameRu,productNameUz,productSlug,sku,size,createdAt) VALUES('legacy-item','legacy','p','v',1,101,101,1,'Fixture','Fixture','p','FIXTURE','',1);
 UPDATE ProductVariant SET stock=4 WHERE id='v';
 INSERT INTO Payment(id,orderId,type,status,expectedAmount,idempotencyKey,proofStorageKey,proofMimeType,updatedAt) VALUES('legacy-payment','legacy','PREPAYMENT','APPROVED',51,'legacy-payment-key','payment-proofs/legacy.png','image/png',1);`);
    const state = await new LifecycleService().cancel(
      "LEGACY",
      WEB_ADMIN_ACTOR,
      { reason: "CUSTOMER_REQUEST" },
    );
    assert.equal(state.status, "CANCELLED");
    assert.equal(stock(f), 5);
    assert.equal(state.refund!.amount, 51);
    const refund = await new RefundService().complete(
      state.refund!.id,
      WEB_ADMIN_ACTOR,
      { reference: "Synthetic refund" },
    );
    assert.equal(refund.status, "COMPLETED");
    assert.equal(count(f, "CheckoutCancellation"), 0);
    assert.equal(count(f, "CheckoutPaymentLedger"), 0);
  },
);
for (const rollback of [false, true])
  test(`populated 0023 migration ${rollback ? "rollback" : "upgrade"} preserves FIRST/FINAL/rejected/pending, proofs and all historical rows`, async () => {
    const f = fixture("0023");
    try {
      await f.run(async () => {
        const s = await submittedFinal(f);
        await f.payments.review(
          s.owner,
          s.final.payment.id,
          randomUUID(),
          decision(67),
        );
        const rejected = await first(f, 50, false, false);
        await f.payments.review(
          rejected.owner,
          rejected.payment.payment.id,
          randomUUID(),
          { decision: "REJECT", reason: "NOT_RECEIVED" },
        );
        await first(f, 50, false, false);
        const names = [
            "CheckoutGroup",
            "CheckoutOrder",
            "CheckoutOrderItem",
            "CheckoutPromoUse",
            "CheckoutPayment",
            "CheckoutPaymentLedger",
            "CheckoutArrival",
            "CheckoutCargoCharge",
            "CheckoutFinalInvoice",
            "MediaObject",
            "MediaChunk",
            "Order",
            "Payment",
            "Refund",
            "AuditLog",
          ],
          before = new Map(names.map((t) => [t, rows(f, t)]));
        const statements = migration().map((sql) => f.db.prepare(sql));
        if (rollback)
          await assert.rejects(
            f.db.batch([
              ...statements,
              f.db.prepare("SELECT * FROM missing_migration_table"),
            ]),
          );
        else await f.db.batch(statements);
        for (const t of names) assert.deepEqual(rows(f, t), before.get(t), t);
        assert.deepEqual(
          f.sqlite.prepare("PRAGMA foreign_key_check").all(),
          [],
        );
        assert.deepEqual(
          (await f.payments.proof(s.auth, s.final.payment.id)).data,
          png,
        );
        if (!rollback) {
          await cancel(f, rejected.order.id);
          await assert.rejects(cancel(f, s.order.id), /refund process/);
          assert.equal((await readOrderFinance(s.order.id)).goodsPaid, 101);
        } else
          assert.equal(
            (
              f.sqlite
                .prepare(
                  "SELECT COUNT(*) n FROM sqlite_master WHERE name='CheckoutCancellation'",
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

test("real local D1 populated migration + cancellation rollback/CAS path, no new public or Admin routes and no outbound access", async () => {
  const f = await marketingRuntime("1", "0023");
  try {
    await f.db.exec(seed);
    const buyer = await runtimeUser(f, 900141),
      tokens = new JwtTokenService(randomBytes(32).toString("hex")),
      authority = new VoyeyOwnerAuthority(tokens, () => "900143"),
      payments = new LinkedCheckoutPayments(authority, true, card),
      preorder = new PreorderFinance(authority, true),
      cancellations = new LinkedCheckoutCancellations(authority, true),
      auth = "Bearer " + (await tokens.issue("buyer")),
      owner = "Bearer " + (await tokens.issue("owner"));
    const target = await withDatabase(f.db as unknown as Database, async () => {
      const paid = (await group()).orders[0]!,
        p = await payments.submit(
          auth,
          paid.id,
          randomUUID(),
          { declaredAmount: 51 },
          proof(),
        );
      await payments.review(owner, p.payment.id, randomUUID(), decision(51));
      await preorder.arrive(owner, paid.id, randomUUID(), orderArrival(paid));
      await preorder.assignCargo(owner, paid.id, randomUUID(), { amount: 17 });
      await preorder.issueInvoice(owner, paid.id, randomUUID());
      const final = await payments.submitFinal(
        auth,
        paid.id,
        randomUUID(),
        { declaredAmount: 67 },
        proof(),
      );
      await payments.review(
        owner,
        final.payment.id,
        randomUUID(),
        decision(67),
      );
      const before = (
        await f.db
          .prepare("SELECT * FROM CheckoutPaymentLedger ORDER BY phase")
          .all()
      ).results;
      await assert.rejects(
        f.db.batch([
          ...migration().map((sql) => f.db.prepare(sql)),
          f.db.prepare("SELECT * FROM missing_24_table"),
        ]),
      );
      assert.deepEqual(
        (
          await f.db
            .prepare("SELECT * FROM CheckoutPaymentLedger ORDER BY phase")
            .all()
        ).results,
        before,
      );
      await f.db.batch(migration().map((sql) => f.db.prepare(sql)));
      await assert.rejects(
        cancellations.cancel(owner, paid.id, randomUUID(), reason),
        /refund process/,
      );
      const o = (await group(["IN_STOCK"])).orders[0]!,
        key = randomUUID();
      await f.db
        .prepare(
          "CREATE TRIGGER fail_audit BEFORE INSERT ON AuditLog WHEN NEW.action='linked-order.cancelled' BEGIN SELECT RAISE(ABORT,'injected real D1 audit failure'); END",
        )
        .run();
      await assert.rejects(
        cancellations.cancel(owner, o.id, key, reason),
        /injected/,
      );
      assert.equal(
        (await f.db
          .prepare("SELECT stock FROM ProductVariant WHERE id='v'")
          .first<{ stock: number }>())!.stock,
        4,
      );
      assert.equal(
        (await f.db
          .prepare("SELECT COUNT(*) n FROM CheckoutCancellation")
          .first<{ n: number }>())!.n,
        0,
      );
      await f.db.prepare("DROP TRIGGER fail_audit").run();
      const c = await cancellations.cancel(owner, o.id, key, reason);
      assert.deepEqual(await cancellations.cancel(owner, o.id, key, reason), c);
      assert.equal(
        (await f.db
          .prepare("SELECT stock FROM ProductVariant WHERE id='v'")
          .first<{ stock: number }>())!.stock,
        5,
      );
      assert.equal((await readOrderFinance(o.id)).orderState, "CANCELLED");
      assert.deepEqual(
        (await f.db.prepare("PRAGMA foreign_key_check").all()).results,
        [],
      );
      return o;
    });
    for (const path of [
      `/checkout/orders/${target.id}/cancel`,
      `/checkout/cancel`,
      `/admin/checkout/orders/${target.id}/cancel`,
      `/admin/linked-orders/${target.id}/cancel`,
    ])
      for (const mode of ["anonymous", "buyer", "admin"]) {
        const r = await f.call(
          path,
          "POST",
          reason,
          mode === "admin"
            ? f.signed
            : mode === "buyer"
              ? { authorization: "Bearer " + buyer.token }
              : {},
          mode === "admin"
            ? "https://admin.preview.invalid"
            : "https://preview.invalid",
        );
        assert.ok(
          [403, 404].includes(r.status),
          `${path} ${mode}: ${r.status}`,
        );
      }
    assert.equal(
      (
        await f.admin(`/orders/${target.publicId}/cancel`, "POST", {
          reason: "CUSTOMER_REQUEST",
        })
      ).status,
      404,
    );
    assert.equal(f.outboundCalls(), 0);
  } finally {
    await f.mf.dispose();
  }
});
scenario(
  "changed stock is incremented only by saved reservation, never reset to an old inventory snapshot",
  async (f) => {
    const o = (await group(["IN_STOCK"])).orders[0]!;
    f.sqlite.exec("UPDATE ProductVariant SET stock=12 WHERE id='v'");
    const c = await cancel(f, o.id);
    assert.equal(stock(f), 13);
    assert.equal(c.reservationSnapshot[0]!.inventoryReservedQuantity, 1);
    const r = rows(f, "CheckoutStockRelease")[0]!;
    assert.equal(r.stockBefore, 12);
    assert.equal(r.stockAfter, 13);
  },
);
scenario(
  "both unpaid mixed children can cancel independently and preserve the shared promo quota permanently",
  async (f) => {
    const promo = await new PromoCodeService().save("owner", {
      code: "KEEPQUOTA",
      type: "FIXED",
      value: 20,
      usageLimit: 1,
      perUserLimit: 1,
      isActive: true,
    });
    const g = await group(["IN_STOCK", "PREORDER"], 50, false, promo.code),
      before = rows(f, "CheckoutPromoUse");
    await Promise.all(g.orders.map((o) => cancel(f, o.id)));
    assert.equal(count(f, "CheckoutCancellation"), 2);
    assert.equal(count(f, "CheckoutStockRelease"), 1);
    assert.equal(stock(f), 5);
    assert.deepEqual(rows(f, "CheckoutPromoUse"), before);
    assert.throws(() =>
      f.sqlite.exec("UPDATE CheckoutPromoUse SET releasedAt=1"),
    );
    assert.throws(() => f.sqlite.exec("DELETE FROM CheckoutPromoUse"));
  },
);
scenario(
  "pending sibling receipt does not block cancellation of a different child",
  async (f) => {
    const g = await group(["IN_STOCK", "PREORDER"]),
      a = g.orders.find((o) => o.saleMode === "IN_STOCK")!,
      b = g.orders.find((o) => o.saleMode === "PREORDER")!;
    const p = await f.payments.submit(
      await f.auth(),
      b.id,
      randomUUID(),
      { declaredAmount: 51 },
      proof(),
    );
    const before = await readOrderFinance(b.id);
    await cancel(f, a.id);
    assert.deepEqual(await readOrderFinance(b.id), before);
    assert.equal(count(f, "CheckoutPayment"), 1);
    await f.payments.review(
      await f.auth("owner"),
      p.payment.id,
      randomUUID(),
      decision(51),
    );
    assert.equal((await readOrderFinance(b.id)).goodsPaid, 51);
  },
);
scenario(
  "200 character legacy-compatible operation keys accepted; zero-price order cancellation is not paid fulfillment",
  async (f) => {
    f.sqlite.exec("UPDATE Product SET price=0");
    const o = (await group(["IN_STOCK"])).orders[0]!;
    const c = await cancel(f, o.id, "K".repeat(200));
    assert.equal(c.operationKey.length, 200);
    assert.equal(stock(f), 5);
    assert.equal((await readOrderFinance(o.id)).financiallySettled, 0);
    assert.equal((await readOrderFinance(o.id)).fulfillmentAllowed, 0);
  },
);
async function rawCancellation(
  f: Fixture,
  orderId: string,
  mutate?: (s: Awaited<ReturnType<typeof readOrderFinance>>) => void,
) {
  const state = await readOrderFinance(orderId);
  mutate?.(state);
  const items = f.sqlite
    .prepare(
      "SELECT id,productId,variantId,quantity,inventoryReservedQuantity FROM CheckoutOrderItem WHERE orderId=? ORDER BY id",
    )
    .all(orderId);
  const id = randomUUID();
  f.sqlite
    .prepare(
      "INSERT INTO CheckoutCancellation(id,orderId,reason,createdBy,createdAt,operationKey,requestFingerprint,financialSnapshot,reservationSnapshot) VALUES(?,?,?,?,?,?,?,?,?)",
    )
    .run(
      id,
      orderId,
      "Synthetic SQL fixture",
      "owner",
      Date.now(),
      randomUUID(),
      "a".repeat(64),
      JSON.stringify(state),
      JSON.stringify(items),
    );
  return id;
}
scenario(
  "SQL rejects cancellation of pending or paid orders without relying on the service writer",
  async (f) => {
    const pending = await first(f, 50, false, false);
    await assert.rejects(rawCancellation(f, pending.order.id), /conflicts/);
    await f.payments.review(
      pending.owner,
      pending.payment.payment.id,
      randomUUID(),
      decision(51),
    );
    await assert.rejects(rawCancellation(f, pending.order.id), /conflicts/);
    assert.equal(count(f, "CheckoutCancellation"), 0);
  },
);
scenario(
  "SQL rejects forged financial snapshots and cannot seal incomplete release/audit",
  async (f) => {
    const o = (await group(["IN_STOCK"])).orders[0]!;
    await assert.rejects(
      rawCancellation(f, o.id, (s) => {
        s.goodsTotal = 1;
      }),
      /financial snapshot/,
    );
    f.sqlite.exec("BEGIN IMMEDIATE");
    try {
      const id = await rawCancellation(f, o.id);
      assert.throws(
        () =>
          f.sqlite
            .prepare("UPDATE CheckoutCancellation SET sealed=1 WHERE id=?")
            .run(id),
        /incomplete/,
      );
      const i = o.items[0]!;
      assert.throws(
        () =>
          f.sqlite
            .prepare(
              "INSERT INTO CheckoutStockRelease(id,cancellationId,orderId,itemId,variantId,quantity,stockBefore,stockAfter,createdAt) SELECT ?,?,?,?,?,?,stock,stock+?,CheckoutCancellation.createdAt FROM CheckoutCancellation JOIN ProductVariant ON ProductVariant.id=? WHERE CheckoutCancellation.id=?",
            )
            .run(randomUUID(), id, o.id, i.id, "v", 2, 2, "v", id),
        /unsafe reservation release/,
      );
      assert.equal(stock(f), 4);
    } finally {
      f.sqlite.exec("ROLLBACK");
    }
    assert.equal(count(f, "CheckoutCancellation"), 0);
    assert.equal(stock(f), 4);
  },
);
scenario(
  "SQL cannot create inventory release for a PREORDER cancellation",
  async (f) => {
    const o = (await group()).orders[0]!;
    f.sqlite.exec("BEGIN IMMEDIATE");
    try {
      const id = await rawCancellation(f, o.id),
        i = o.items[0]!;
      assert.throws(
        () =>
          f.sqlite
            .prepare(
              "INSERT INTO CheckoutStockRelease(id,cancellationId,orderId,itemId,variantId,quantity,stockBefore,stockAfter,createdAt) SELECT ?,?,?,?,?,1,5,6,createdAt FROM CheckoutCancellation WHERE id=?",
            )
            .run(randomUUID(), id, o.id, i.id, "v", id),
        /unsafe/,
      );
      assert.equal(stock(f), 5);
    } finally {
      f.sqlite.exec("ROLLBACK");
    }
  },
);
