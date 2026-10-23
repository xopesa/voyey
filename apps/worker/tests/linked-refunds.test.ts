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
    new URL("../migrations/0025_linked_checkout_refunds.sql", import.meta.url),
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

const reason = { reason: "Synthetic full refund" };
const outgoing = (
  confirmedAmount: number,
  bankOperationReference: string = randomUUID(),
) => ({ confirmedAmount, bankOperationReference, bankTransferVerified: true });
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
async function paidStock(f: Fixture, extra = false, promo?: string) {
  const g = await group(["IN_STOCK"], 50, extra, promo),
    order = g.orders[0]!,
    auth = await f.auth(),
    owner = await f.auth("owner");
  const payment = await f.payments.submit(
    auth,
    order.id,
    randomUUID(),
    { declaredAmount: order.firstPaymentAmount },
    proof(),
  );
  const reviewKey = randomUUID(),
    review = decision(order.firstPaymentAmount);
  await f.payments.review(owner, payment.payment.id, reviewKey, review);
  return { group: g, order, auth, owner, payment, reviewKey, review };
}
async function request(
  f: Fixture,
  id: string,
  key: string = randomUUID(),
  value: unknown = reason,
) {
  return f.refunds.request(await f.auth("owner"), id, key, value);
}
async function confirm(
  f: Fixture,
  id: string,
  amount: number,
  key: string = randomUUID(),
  value: unknown = outgoing(amount),
) {
  return f.refunds.confirm(await f.auth("owner"), id, key, value);
}
const arrivalOf = (o: Awaited<ReturnType<typeof group>>["orders"][number]) => ({
  arrivedAt: new Date().toISOString(),
  items: o.items.map((i) => ({ itemId: i.id, quantity: i.quantity })),
});

scenario(
  "full IN_STOCK: REQUESTED freezes money, COMPLETED refunds goods and releases saved reservations exactly once",
  async (f) => {
    const s = await paidStock(f, true),
      original = rows(f, "CheckoutPaymentLedger"),
      contracts = rows(f, "CheckoutOrder"),
      items = rows(f, "CheckoutOrderItem");
    const r = await request(f, s.order.id);
    assert.equal(r.refund.status, "REQUESTED");
    assert.equal(r.refund.totalAmount, 303);
    assert.equal(r.finance.goodsPaid, 303);
    assert.equal(r.finance.refundedTotal, 0);
    assert.equal(r.finance.netReceivedTotal, 303);
    assert.equal(r.finance.orderState, "REFUND_REQUESTED");
    assert.equal(r.finance.paymentAllowed, 0);
    assert.equal(stock(f), 4);
    assert.equal(stock(f, "v2"), 3);
    const key = randomUUID(),
      data = outgoing(303),
      done = await confirm(f, r.refund.id, 303, key, data);
    assert.equal(done.refund.status, "COMPLETED");
    assert.equal(done.finance.orderState, "CANCELLED_REFUNDED");
    assert.equal(done.finance.goodsPaid, 303);
    assert.equal(done.finance.goodsRefunded, 303);
    assert.equal(done.finance.cargoRefunded, 0);
    assert.equal(done.finance.netReceivedTotal, 0);
    assert.equal(done.finance.stockReconciliationState, "RELEASED");
    assert.equal(done.finance.financiallySettled, 0);
    assert.equal(done.finance.fulfillmentAllowed, 0);
    assert.equal(stock(f), 5);
    assert.equal(stock(f, "v2"), 5);
    assert.equal(count(f, "CheckoutRefundStockRelease"), 2);
    assert.equal(count(f, "CheckoutRefundLedger"), 1);
    assert.deepEqual(await confirm(f, r.refund.id, 303, key, data), done);
    assert.equal(stock(f), 5);
    assert.equal(count(f, "CheckoutRefundStockRelease"), 2);
    assert.deepEqual(rows(f, "CheckoutPaymentLedger"), original);
    assert.deepEqual(rows(f, "CheckoutOrder"), contracts);
    assert.deepEqual(rows(f, "CheckoutOrderItem"), items);
    assert.equal(
      (await readCheckoutGroup("buyer", s.group.id)).orders[0]!.orderState,
      "CANCELLED_REFUNDED",
    );
    assert.deepEqual(
      (await f.payments.proof(s.auth, s.payment.payment.id)).data,
      png,
    );
  },
);
for (const percent of [50, 100] as const)
  scenario(
    `PREORDER FIRST ${percent}% returns only received goods, never debt or stock`,
    async (f) => {
      const s = await first(f, percent),
        received = percent === 50 ? 51 : 101;
      const r = await request(f, s.order.id);
      assert.equal(r.refund.goodsAmount, received);
      assert.equal(r.refund.cargoAmount, 0);
      assert.equal(r.refund.totalAmount, received);
      const done = await confirm(f, r.refund.id, received);
      assert.equal(done.finance.goodsPaid, received);
      assert.equal(done.finance.goodsRefunded, received);
      assert.equal(done.finance.netGoodsReceived, 0);
      assert.equal(done.finance.unpaidGoods, 101 - received);
      assert.equal(done.finance.stockReconciliationState, "NOT_APPLICABLE");
      assert.equal(stock(f), 5);
      assert.equal(count(f, "CheckoutRefundStockRelease"), 0);
    },
  );
for (const percent of [50, 100] as const)
  scenario(
    `PREORDER ${percent}% FINAL: refund exact received GOODS 101 + CARGO 17, original allocations immutable`,
    async (f) => {
      const s = await submittedFinal(f, percent);
      await f.payments.review(
        s.owner,
        s.final.payment.id,
        randomUUID(),
        decision(s.final.payment.expectedAmount),
      );
      const oldLedger = rows(f, "CheckoutPaymentLedger"),
        a = rows(f, "CheckoutArrival"),
        c = rows(f, "CheckoutCargoCharge"),
        i = rows(f, "CheckoutFinalInvoice");
      const r = await request(f, s.order.id);
      assert.equal(r.allocations.length, 2);
      assert.equal(r.refund.goodsAmount, 101);
      assert.equal(r.refund.cargoAmount, 17);
      assert.equal(r.refund.totalAmount, 118);
      const done = await confirm(f, r.refund.id, 118);
      assert.equal(done.finance.receivedTotal, 118);
      assert.equal(done.finance.goodsRefunded, 101);
      assert.equal(done.finance.cargoRefunded, 17);
      assert.equal(done.finance.refundedTotal, 118);
      assert.equal(done.finance.netReceivedTotal, 0);
      assert.equal(done.finance.netCargoReceived, 0);
      assert.equal(done.finance.cargoAmount, 17);
      assert.equal(done.finance.paymentAllowed, 0);
      assert.deepEqual(rows(f, "CheckoutPaymentLedger"), oldLedger);
      assert.deepEqual(rows(f, "CheckoutArrival"), a);
      assert.deepEqual(rows(f, "CheckoutCargoCharge"), c);
      assert.deepEqual(rows(f, "CheckoutFinalInvoice"), i);
      assert.equal(stock(f), 5);
    },
  );
scenario(
  "unpaid, rejected-only, pending FIRST and cancelled unpaid orders cannot refund",
  async (f) => {
    const unpaid = (await group()).orders[0]!;
    await assert.rejects(request(f, unpaid.id), /No valid confirmed/);
    const pending = await first(f, 50, false, false);
    await assert.rejects(request(f, pending.order.id), /pending review/);
    await f.payments.review(
      pending.owner,
      pending.payment.payment.id,
      randomUUID(),
      { decision: "REJECT", reason: "NOT_RECEIVED" },
    );
    await assert.rejects(request(f, pending.order.id), /No valid confirmed/);
    await f.cancellations.cancel(
      await f.auth("owner"),
      unpaid.id,
      randomUUID(),
      reason,
    );
    await assert.rejects(request(f, unpaid.id), /cancelled/);
    assert.equal(count(f, "CheckoutRefund"), 0);
    assert.equal(count(f, "CheckoutRefundLedger"), 0);
  },
);
scenario(
  "pending FINAL denies refund until legitimate rejection; rejection allows only received FIRST",
  async (f) => {
    const s = await submittedFinal(f);
    await assert.rejects(request(f, s.order.id), /pending review/);
    assert.equal(count(f, "CheckoutRefund"), 0);
    await f.payments.review(s.owner, s.final.payment.id, randomUUID(), {
      decision: "REJECT",
      reason: "NOT_RECEIVED",
    });
    const r = await request(f, s.order.id);
    assert.equal(r.refund.totalAmount, 51);
    assert.equal(r.refund.cargoAmount, 0);
    const done = await confirm(f, r.refund.id, 51);
    assert.equal(done.finance.unpaidGoods, 50);
    assert.equal(done.finance.unpaidCargo, 17);
    assert.equal(done.finance.refundedTotal, 51);
    assert.equal(done.finance.paymentAllowed, 0);
  },
);
scenario(
  "no partial/over refunds, missing transfer verification or client allocations",
  async (f) => {
    const s = await paidStock(f),
      r = await request(f, s.order.id);
    for (const a of [100, 102])
      await assert.rejects(confirm(f, r.refund.id, a), /exactly/);
    for (const value of [
      outgoing(0),
      { ...outgoing(101), bankTransferVerified: false },
      { confirmedAmount: 101, bankOperationReference: randomUUID() },
      { ...outgoing(101), goodsAmount: 101 },
      { ...outgoing(101), bankOperationReference: " .:_- .:_- " },
    ])
      await assert.rejects(confirm(f, r.refund.id, 101, randomUUID(), value), {
        statusCode: 400,
      });
    await assert.rejects(
      request(f, s.order.id, randomUUID(), { ...reason, totalAmount: 1 }),
      { statusCode: 400 },
    );
    assert.equal(count(f, "CheckoutRefundLedger"), 0);
  },
);
scenario(
  "request replay freezes original amounts; incompatible reason/key/cross-order reuse denied",
  async (f) => {
    const a = await paidStock(f),
      b = await first(f),
      key = randomUUID(),
      r = await request(f, a.order.id, key);
    f.sqlite.exec("UPDATE Product SET price=999 WHERE id='p'");
    assert.deepEqual(await request(f, a.order.id, key), r);
    await assert.rejects(
      request(f, a.order.id, key, { reason: "Different reason" }),
      { statusCode: 409 },
    );
    await assert.rejects(request(f, a.order.id), { statusCode: 409 });
    await assert.rejects(request(f, b.order.id, key), { statusCode: 409 });
    assert.equal(count(f, "CheckoutRefund"), 1);
    assert.equal(count(f, "CheckoutRefundAllocation"), 1);
  },
);
for (const same of [true, false])
  scenario(
    `concurrent refund requests sameKey=${same}: exactly one request/allocation set`,
    async (f) => {
      const s = await first(f),
        key = randomUUID();
      const r = await Promise.allSettled([
        request(f, s.order.id, key),
        request(f, s.order.id, same ? key : randomUUID()),
      ]);
      assert.equal(
        r.filter((x) => x.status === "fulfilled").length,
        same ? 2 : 1,
      );
      assert.equal(count(f, "CheckoutRefund"), 1);
      assert.equal(count(f, "CheckoutRefundAllocation"), 1);
      assert.equal(count(f, "CheckoutRefundLedger"), 0);
    },
  );
for (const same of [true, false])
  scenario(
    `concurrent confirmations sameKey=${same}: one monetary completion and stock release`,
    async (f) => {
      const s = await paidStock(f),
        r = await request(f, s.order.id),
        key = randomUUID(),
        data = outgoing(101);
      const a = await Promise.allSettled([
        confirm(f, r.refund.id, 101, key, data),
        confirm(
          f,
          r.refund.id,
          101,
          same ? key : randomUUID(),
          same ? data : outgoing(101),
        ),
      ]);
      assert.equal(
        a.filter((x) => x.status === "fulfilled").length,
        same ? 2 : 1,
      );
      assert.equal(count(f, "CheckoutRefundLedger"), 1);
      assert.equal(count(f, "CheckoutRefundStockRelease"), 1);
      assert.equal(stock(f), 5);
    },
  );
scenario(
  "confirmation incompatible replay denied; normalized outgoing reference unique across refunds, no raw reference exposed",
  async (f) => {
    const a = await first(f),
      b = await first(f),
      ra = await request(f, a.order.id),
      rb = await request(f, b.order.id),
      key = randomUUID(),
      ref = "OUTGOING-REF-001";
    const done = await confirm(f, ra.refund.id, 51, key, outgoing(51, ref));
    assert.deepEqual(
      await confirm(f, ra.refund.id, 51, key, outgoing(51, "outgoing ref 001")),
      done,
    );
    await assert.rejects(
      confirm(f, ra.refund.id, 51, key, outgoing(51)),
      /Incompatible/,
    );
    await assert.rejects(confirm(f, ra.refund.id, 51), /Incompatible/);
    await assert.rejects(
      confirm(
        f,
        rb.refund.id,
        51,
        randomUUID(),
        outgoing(51, "outgoing_ref:001"),
      ),
      /already recorded/,
    );
    await assert.rejects(confirm(f, rb.refund.id, 51, key), /already recorded/);
    assert.equal(count(f, "CheckoutRefundLedger"), 1);
    assert.equal(JSON.stringify(done).includes(ref), false);
    assert.equal(JSON.stringify(rows(f, "AuditLog")).includes(ref), false);
    assert.equal(
      JSON.stringify(rows(f, "CheckoutRefundLedger")).includes(ref),
      false,
    );
    const d = rows(f, "CheckoutRefundLedger")[0]!;
    assert.match(d.bankOperationDigest as string, /^[0-9a-f]{64}$/);
    assert.notEqual(
      d.bankOperationDigest,
      rows(f, "CheckoutPaymentLedger")[0]!.bankOperationDigest,
    );
  },
);
for (const phase of ["FIRST", "FINAL"] as const)
  scenario(
    `refund versus ${phase} review: pending request always denied, reviewed cash never omitted`,
    async (f) => {
      const final = phase === "FINAL" ? await submittedFinal(f) : null;
      const s = final ?? (await first(f, 50, false, false));
      const p = final?.final ?? s.payment;
      const result = await Promise.allSettled([
        request(f, s.order.id),
        f.payments.review(
          s.owner,
          p.payment.id,
          randomUUID(),
          decision(p.payment.expectedAmount),
        ),
      ]);
      assert.equal(result[1]!.status, "fulfilled");
      // CAS may retry a pending denial after the legitimate approval and then capture all money.
      const r =
        result[0]!.status === "fulfilled"
          ? result[0]!.value
          : await request(f, s.order.id);
      assert.equal(r.refund.totalAmount, phase === "FIRST" ? 51 : 118);
      assert.equal(r.allocations.length, phase === "FIRST" ? 1 : 2);
      assert.equal(count(f, "CheckoutRefundLedger"), 0);
    },
  );
for (const winner of ["submit", "refund"])
  scenario(
    `forced CAS refund vs FINAL submit: ${winner} wins without partial request or orphan proof`,
    async (f) => {
      const s = await invoice(f);
      let raced = false;
      const wrapped: Database = {
        prepare: (sql) => f.db.prepare(sql),
        batch: async (statements) => {
          const text = statements
            .map((x) => (x as unknown as { sql: string }).sql)
            .join(" ");
          if (
            !raced &&
            text.includes(
              winner === "submit"
                ? "INSERT INTO CheckoutRefund("
                : "INSERT INTO CheckoutPayment(",
            )
          ) {
            raced = true;
            await f.run(() =>
              winner === "submit"
                ? f.payments.submitFinal(
                    s.auth,
                    s.order.id,
                    randomUUID(),
                    { declaredAmount: 67 },
                    proof(),
                  )
                : request(f, s.order.id),
            );
          }
          return f.db.batch(statements);
        },
      };
      await assert.rejects(
        withDatabase(wrapped, () =>
          winner === "submit"
            ? request(f, s.order.id)
            : f.payments.submitFinal(
                s.auth,
                s.order.id,
                randomUUID(),
                { declaredAmount: 67 },
                proof(),
              ),
        ),
        winner === "submit" ? /pending review/ : /locked by refund/,
      );
      assert.ok(raced);
      assert.equal(count(f, "CheckoutRefund"), winner === "refund" ? 1 : 0);
      assert.equal(count(f, "CheckoutPayment"), winner === "submit" ? 2 : 1);
      assert.equal(count(f, "MediaObject"), winner === "submit" ? 2 : 1);
    },
  );
for (const actor of ["employee", "buyer", WEB_ADMIN_ACTOR, ""])
  scenario(
    `owner-only request/confirm/read/reconcile rejects ${actor || "anonymous"}`,
    async (f) => {
      const s = await paidStock(f),
        auth = actor ? await f.auth(actor) : undefined;
      await assert.rejects(
        f.refunds.request(auth, s.order.id, randomUUID(), reason),
        { statusCode: 403 },
      );
      const r = await request(f, s.order.id);
      await assert.rejects(
        f.refunds.confirm(auth, r.refund.id, randomUUID(), outgoing(101)),
        { statusCode: 403 },
      );
      await assert.rejects(f.refunds.state(auth, r.refund.id), {
        statusCode: 403,
      });
      await assert.rejects(
        f.refunds.reconcileStock(auth, r.refund.id, randomUUID()),
        { statusCode: 403 },
      );
      assert.equal(count(f, "CheckoutRefundLedger"), 0);
      assert.equal(stock(f), 4);
    },
  );
for (const action of ["request", "confirm", "stock"] as const)
  scenario(
    `owner revocation inside ${action} batch forces fresh authority on retry`,
    async (f) => {
      const s = await paidStock(f),
        r = action !== "request" ? await request(f, s.order.id) : null;
      if (action === "stock") {
        f.sqlite.exec("UPDATE ProductVariant SET isActive=0");
        await confirm(f, r!.refund.id, 101);
        f.sqlite.exec("UPDATE ProductVariant SET isActive=1");
      }
      let revoked = false;
      const target =
        action === "request"
          ? "INSERT INTO CheckoutRefund("
          : action === "confirm"
            ? "INSERT INTO CheckoutRefundLedger("
            : "INSERT INTO CheckoutRefundStockReconciliation(";
      const wrapped: Database = {
        prepare: (sql) => f.db.prepare(sql),
        batch: async (statements) => {
          if (
            !revoked &&
            statements.some((x) =>
              (x as unknown as { sql: string }).sql.includes(target),
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
          action === "request"
            ? request(f, s.order.id)
            : action === "confirm"
              ? confirm(f, r!.refund.id, 101)
              : f.refunds.reconcileStock(s.owner, r!.refund.id, randomUUID()),
        ),
        { statusCode: 403 },
      );
      assert.ok(revoked);
      assert.equal(
        count(f, "CheckoutRefundLedger"),
        action === "stock" ? 1 : 0,
      );
      assert.equal(count(f, "CheckoutRefundStockRelease"), 0);
      assert.equal(stock(f), 4);
    },
  );
for (const stage of [
  "allocation",
  "request-audit",
  "request-seal",
  "ledger",
  "completion-audit",
] as const)
  scenario(
    `failure at ${stage} fully rolls back that financial batch; same bank reference can be recorded on retry`,
    async (f) => {
      const s = await paidStock(f),
        key = randomUUID(),
        requestStage = stage.startsWith("request") || stage === "allocation",
        r = requestStage ? null : await request(f, s.order.id);
      const before = rows(f, "AuditLog"),
        data = outgoing(101, "OUTGOING-RETRY-001");
      const sql =
        stage === "allocation"
          ? "CREATE TRIGGER injected BEFORE INSERT ON CheckoutRefundAllocation BEGIN SELECT RAISE(ABORT,'injected allocation'); END"
          : stage === "request-audit"
            ? "CREATE TRIGGER injected BEFORE INSERT ON AuditLog WHEN NEW.action='linked-refund.requested' BEGIN SELECT RAISE(ABORT,'injected audit'); END"
            : stage === "request-seal"
              ? "CREATE TRIGGER injected BEFORE UPDATE ON CheckoutRefund BEGIN SELECT RAISE(ABORT,'injected seal'); END"
              : stage === "ledger"
                ? "CREATE TRIGGER injected BEFORE INSERT ON CheckoutRefundLedger BEGIN SELECT RAISE(ABORT,'injected ledger'); END"
                : "CREATE TRIGGER injected BEFORE INSERT ON AuditLog WHEN NEW.action='linked-refund.completed' BEGIN SELECT RAISE(ABORT,'injected audit'); END";
      f.sqlite.exec(sql);
      await assert.rejects(
        requestStage
          ? request(f, s.order.id, key)
          : confirm(f, r!.refund.id, 101, key, data),
        /injected/,
      );
      assert.equal(count(f, "CheckoutRefundLedger"), 0);
      assert.equal(count(f, "CheckoutRefund"), requestStage ? 0 : 1);
      assert.equal(count(f, "CheckoutRefundStockRelease"), 0);
      assert.equal(stock(f), 4);
      assert.deepEqual(rows(f, "AuditLog"), before);
      assert.equal(
        (await readOrderFinance(s.order.id)).orderState,
        requestStage ? "PAYMENTS_BLOCKED" : "REFUND_REQUESTED",
      );
      f.sqlite.exec("DROP TRIGGER injected");
      if (requestStage) await request(f, s.order.id, key);
      else {
        const done = await confirm(f, r!.refund.id, 101, key, data);
        assert.equal(done.refund.status, "COMPLETED");
        assert.equal(done.finance.refundedTotal, 101);
        assert.equal(stock(f), 5);
      }
    },
  );
for (const failure of [
  "isActive=0",
  "stock=NULL",
  "stock=0.5",
  "stock=2147483647",
  "productId='other-product'",
])
  scenario(
    `bank refund survives unsafe SKU ${failure}; reconciliation later never refunds money again`,
    async (f) => {
      const s = await paidStock(f, true),
        r = await request(f, s.order.id),
        key = randomUUID(),
        data = outgoing(303);
      if (failure.startsWith("productId"))
        f.sqlite.exec(
          "INSERT INTO Product(id,categoryId,nameRu,nameUz,slug,price,status,updatedAt) VALUES('other-product','c','Fixture','Fixture','p2',101,'ACTIVE',1)",
        );
      f.sqlite.exec(`UPDATE ProductVariant SET ${failure} WHERE id='v2'`);
      const done = await confirm(f, r.refund.id, 303, key, data);
      assert.equal(done.refund.status, "COMPLETED");
      assert.equal(done.finance.orderState, "CANCELLED_REFUNDED");
      assert.equal(done.finance.netReceivedTotal, 0);
      assert.equal(
        done.finance.stockReconciliationState,
        "REQUIRES_RECONCILIATION",
      );
      assert.equal(stock(f), 4);
      assert.equal(count(f, "CheckoutRefundStockRelease"), 0);
      const ledger = rows(f, "CheckoutRefundLedger");
      f.sqlite.exec(
        "UPDATE ProductVariant SET isActive=1,stock=3,productId='p' WHERE id='v2'",
      );
      const retry = await f.refunds.reconcileStock(
        s.owner,
        r.refund.id,
        "refund-stock:" + r.refund.id,
      );
      assert.equal(retry.finance.stockReconciliationState, "RELEASED");
      assert.equal(stock(f), 5);
      assert.equal(stock(f, "v2"), 5);
      assert.deepEqual(rows(f, "CheckoutRefundLedger"), ledger);
      await confirm(f, r.refund.id, 303, key, data);
      assert.equal(stock(f), 5);
      assert.equal(count(f, "CheckoutRefundStockRelease"), 2);
      assert.deepEqual(rows(f, "CheckoutRefundLedger"), ledger);
    },
  );
for (const failure of ["release", "stock-audit", "stock-seal"])
  scenario(
    `stock ${failure} error cannot roll back completed bank refund; independent inventory batch rolls back fully`,
    async (f) => {
      const s = await paidStock(f, true),
        r = await request(f, s.order.id),
        key = randomUUID(),
        data = outgoing(303);
      f.sqlite.exec(
        failure === "release"
          ? "CREATE TRIGGER injected BEFORE INSERT ON CheckoutRefundStockRelease WHEN NEW.variantId='v2' BEGIN SELECT RAISE(ABORT,'injected stock'); END"
          : failure === "stock-audit"
            ? "CREATE TRIGGER injected BEFORE INSERT ON AuditLog WHEN NEW.action='linked-refund.stock-reconciled' BEGIN SELECT RAISE(ABORT,'injected stock audit'); END"
            : "CREATE TRIGGER injected BEFORE UPDATE ON CheckoutRefundStockReconciliation BEGIN SELECT RAISE(ABORT,'injected stock seal'); END",
      );
      const done = await confirm(f, r.refund.id, 303, key, data);
      assert.equal(done.refund.status, "COMPLETED");
      assert.equal(done.finance.refundedTotal, 303);
      assert.equal(
        done.finance.stockReconciliationState,
        "REQUIRES_RECONCILIATION",
      );
      assert.equal(stock(f), 4);
      assert.equal(stock(f, "v2"), 3);
      assert.equal(count(f, "CheckoutRefundStockRelease"), 0);
      assert.equal(count(f, "CheckoutRefundStockReconciliation"), 0);
      f.sqlite.exec("DROP TRIGGER injected");
      const retry = await confirm(f, r.refund.id, 303, key, data);
      assert.equal(retry.finance.stockReconciliationState, "RELEASED");
      assert.equal(count(f, "CheckoutRefundLedger"), 1);
      assert.equal(stock(f), 5);
      assert.equal(stock(f, "v2"), 5);
    },
  );
scenario(
  "concurrent stock reconciliation uses current stock + saved reserve, releases once and leaves completed money unchanged",
  async (f) => {
    const s = await paidStock(f),
      r = await request(f, s.order.id);
    f.sqlite.exec("UPDATE ProductVariant SET isActive=0");
    await confirm(f, r.refund.id, 101);
    f.sqlite.exec("UPDATE ProductVariant SET isActive=1,stock=12");
    const ledger = rows(f, "CheckoutRefundLedger"),
      key = randomUUID();
    const a = await Promise.all([
      f.refunds.reconcileStock(s.owner, r.refund.id, key),
      f.refunds.reconcileStock(s.owner, r.refund.id, key),
    ]);
    assert.equal(a[0]!.finance.stockReconciliationState, "RELEASED");
    assert.equal(a[1]!.finance.stockReconciliationState, "RELEASED");
    assert.equal(stock(f), 13);
    assert.equal(count(f, "CheckoutRefundStockRelease"), 1);
    assert.deepEqual(rows(f, "CheckoutRefundLedger"), ledger);
    await assert.rejects(
      f.refunds.reconcileStock(s.owner, r.refund.id, randomUUID()),
      { statusCode: 409 },
    );
  },
);
scenario(
  "mixed group discounted refund preserves sibling, promo usage, category changes cannot recalculate money",
  async (f) => {
    const code = await new PromoCodeService().save("owner", {
      code: "REFUNDFIXTURE",
      type: "FIXED",
      value: 20,
      isActive: true,
      usageLimit: 1,
      perUserLimit: 1,
    });
    const g = await group(["IN_STOCK", "PREORDER"], 50, false, code.code),
      a = g.orders.find((o) => o.saleMode === "IN_STOCK")!,
      b = g.orders.find((o) => o.saleMode === "PREORDER")!,
      auth = await f.auth(),
      owner = await f.auth("owner");
    for (const o of g.orders) {
      const p = await f.payments.submit(
        auth,
        o.id,
        randomUUID(),
        { declaredAmount: o.firstPaymentAmount },
        proof(),
      );
      await f.payments.review(
        owner,
        p.payment.id,
        randomUUID(),
        decision(o.firstPaymentAmount),
      );
    }
    const sibling = await readOrderFinance(b.id),
      promo = rows(f, "CheckoutPromoUse"),
      promoConfig = rows(f, "PromoCode"),
      orders = rows(f, "CheckoutOrder"),
      payments = rows(f, "CheckoutPayment"),
      ledgers = rows(f, "CheckoutPaymentLedger");
    const expected = a.goodsTotal;
    f.sqlite.exec("UPDATE Product SET price=99999,attributes='{}'");
    const r = await request(f, a.id);
    assert.equal(r.refund.totalAmount, expected);
    await confirm(f, r.refund.id, expected);
    assert.deepEqual(await readOrderFinance(b.id), sibling);
    assert.deepEqual(rows(f, "CheckoutPromoUse"), promo);
    assert.deepEqual(rows(f, "PromoCode"), promoConfig);
    assert.deepEqual(rows(f, "CheckoutOrder"), orders);
    assert.deepEqual(rows(f, "CheckoutPayment"), payments);
    assert.deepEqual(rows(f, "CheckoutPaymentLedger"), ledgers);
    assert.equal(stock(f), 5);
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
  },
);
scenario(
  "REQUESTED and COMPLETED forbid all financial writers/replays and unpaid-cancel bypass, while preserving history reads",
  async (f) => {
    const s = await submittedFinal(f);
    await f.payments.review(s.owner, s.final.payment.id, randomUUID(), {
      decision: "REJECT",
      reason: "NOT_RECEIVED",
    });
    const r = await request(f, s.order.id);
    for (const completed of [false, true]) {
      if (completed) await confirm(f, r.refund.id, 51);
      await assert.rejects(
        f.payments.submit(
          s.auth,
          s.order.id,
          randomUUID(),
          { declaredAmount: 51 },
          proof(),
        ),
        /locked by refund/,
      );
      await assert.rejects(
        f.payments.submitFinal(
          s.auth,
          s.order.id,
          randomUUID(),
          { declaredAmount: 67 },
          proof(),
        ),
        /locked by refund/,
      );
      await assert.rejects(
        f.payments.review(s.owner, s.payment.payment.id, s.reviewKey, s.review),
        /locked by refund/,
      );
      await assert.rejects(
        f.payments.review(
          s.owner,
          s.final.payment.id,
          randomUUID(),
          decision(67),
        ),
        /locked by refund/,
      );
      await assert.rejects(
        f.payments.finalInstructions(s.auth, s.order.id),
        /locked by refund/,
      );
      await assert.rejects(
        f.preorder.arrive(
          s.owner,
          s.order.id,
          randomUUID(),
          arrivalOf(s.order),
        ),
        /locked by refund/,
      );
      await assert.rejects(
        f.preorder.assignCargo(s.owner, s.order.id, randomUUID(), {
          amount: 0,
        }),
        /locked by refund/,
      );
      await assert.rejects(
        f.preorder.issueInvoice(s.owner, s.order.id, randomUUID()),
        /locked by refund/,
      );
      await assert.rejects(
        f.cancellations.cancel(s.owner, s.order.id, randomUUID(), reason),
        { statusCode: 409 },
      );
      assert.deepEqual(
        (await f.payments.proof(s.auth, s.payment.payment.id)).data,
        png,
      );
    }
    assert.equal(count(f, "CheckoutCancellation"), 0);
    assert.equal(count(f, "CheckoutPaymentLedger"), 1);
    assert.equal((await f.payments.state(s.auth, s.order.id)).goodsPaid, 51);
  },
);
scenario(
  "default gate, invalid owner, unknown refund/order and premature stock reconciliation fail closed",
  async (f) => {
    const s = await first(f),
      auth = await f.auth("owner");
    await assert.rejects(
      new LinkedCheckoutRefunds(f.owner).request(
        auth,
        s.order.id,
        randomUUID(),
        reason,
      ),
      { statusCode: 503 },
    );
    await assert.rejects(request(f, "missing"), { statusCode: 404 });
    await assert.rejects(
      f.refunds.confirm(auth, "missing", randomUUID(), outgoing(51)),
      { statusCode: 404 },
    );
    await assert.rejects(request(f, s.order.id, "bad"), { statusCode: 400 });
    const r = await request(f, s.order.id);
    await assert.rejects(
      f.refunds.reconcileStock(auth, r.refund.id, randomUUID()),
      { statusCode: 409 },
    );
    f.config.owner = "";
    await assert.rejects(confirm(f, r.refund.id, 51), { statusCode: 503 });
    assert.equal(count(f, "CheckoutRefundLedger"), 0);
  },
);
scenario(
  "LEGACY paid cancellation/refund and new unpaid cancellation stay isolated and operational",
  async (f) => {
    f.sqlite
      .exec(`INSERT INTO "Order"(id,publicId,userId,idempotencyKey,fullName,phone,city,address,subtotal,total,requiredPrepayment,remainingAmount,updatedAt) VALUES('legacy','LEGACY','buyer','legacy-cancel-key','Synthetic','1234567','Fixture','Fixture',101,101,51,50,1);
 INSERT INTO Payment(id,orderId,type,status,expectedAmount,idempotencyKey,proofStorageKey,proofMimeType,updatedAt) VALUES('legacy-payment','legacy','PREPAYMENT','APPROVED',51,'legacy-payment-key','payment-proofs/legacy.png','image/png',1);`);
    const c = await new LifecycleService().cancel("LEGACY", WEB_ADMIN_ACTOR, {
      reason: "CUSTOMER_REQUEST",
    });
    assert.equal(c.refund!.amount, 51);
    assert.equal(
      (
        await new RefundService().complete(c.refund!.id, WEB_ADMIN_ACTOR, {
          reference: "Synthetic legacy refund",
        })
      ).status,
      "COMPLETED",
    );
    await assert.rejects(request(f, "legacy"), { statusCode: 404 });
    const unpaid = (await group(["IN_STOCK"])).orders[0]!;
    await f.cancellations.cancel(
      await f.auth("owner"),
      unpaid.id,
      randomUUID(),
      reason,
    );
    assert.equal(stock(f), 5);
    assert.equal(count(f, "CheckoutCancellation"), 1);
    assert.equal(count(f, "CheckoutRefund"), 0);
  },
);
async function rawRequest(
  f: Fixture,
  orderId: string,
  goods: number,
  cargo: number,
  snapshot?: unknown,
) {
  const state = snapshot ?? (await readOrderFinance(orderId)),
    id = randomUUID();
  f.sqlite
    .prepare(
      "INSERT INTO CheckoutRefund(id,orderId,reason,createdBy,createdAt,operationKey,requestFingerprint,goodsAmount,cargoAmount,totalAmount,financialSnapshot) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
    )
    .run(
      id,
      orderId,
      "Synthetic SQL fixture",
      "owner",
      Date.now(),
      randomUUID(),
      "a".repeat(64),
      goods,
      cargo,
      goods + cargo,
      JSON.stringify(state),
    );
  return id;
}
scenario(
  "SQL refuses unreceived/excess/partial money and forged snapshots; incomplete allocations cannot seal or complete",
  async (f) => {
    const unpaid = (await group()).orders[0]!;
    await assert.rejects(rawRequest(f, unpaid.id, 1, 0), /full confirmed/);
    const s = await paidStock(f);
    await assert.rejects(rawRequest(f, s.order.id, 102, 0), /full confirmed/);
    await assert.rejects(rawRequest(f, s.order.id, 100, 0), /full confirmed/);
    const snapshot = await readOrderFinance(s.order.id);
    await assert.rejects(
      rawRequest(f, s.order.id, 101, 0, { ...snapshot, goodsPaid: 999 }),
      /snapshot/,
    );
    const other = await first(f);
    f.sqlite.exec("BEGIN IMMEDIATE");
    try {
      const id = await rawRequest(f, s.order.id, 101, 0),
        source = rows(f, "CheckoutPaymentLedger").find(
          (l) => l.orderId === s.order.id,
        )!,
        foreign = rows(f, "CheckoutPaymentLedger").find(
          (l) => l.orderId === other.order.id,
        )!;
      assert.throws(
        () =>
          f.sqlite
            .prepare("UPDATE CheckoutRefund SET sealed=1 WHERE id=?")
            .run(id),
        /incomplete/,
      );
      for (const [ledgerId, goods] of [
        [source.id, 100],
        [foreign.id, 51],
      ] as const)
        assert.throws(
          () =>
            f.sqlite
              .prepare(
                "INSERT INTO CheckoutRefundAllocation(id,refundId,orderId,paymentLedgerId,goodsAmount,cargoAmount) VALUES(?,?,?,?,?,0)",
              )
              .run(randomUUID(), id, s.order.id, ledgerId as string, goods),
          /match original/,
        );
      assert.throws(
        () =>
          f.sqlite
            .prepare(
              "INSERT INTO CheckoutRefundLedger(id,refundId,orderId,goodsAmount,cargoAmount,totalAmount,currency,confirmedBy,confirmedAt,bankOperationDigest,operationKey,requestFingerprint,bankTransferVerified) VALUES(?,?,?,101,0,101,'UZS','owner',?,?,?, ?,1)",
            )
            .run(
              randomUUID(),
              id,
              s.order.id,
              Date.now(),
              "b".repeat(64),
              randomUUID(),
              "c".repeat(64),
            ),
        /sealed request/,
      );
    } finally {
      f.sqlite.exec("ROLLBACK");
    }
    assert.equal(count(f, "CheckoutRefund"), 0);
  },
);
scenario(
  "SQL pending guard and immutable allocation/request/ledger/completion identity protect against bypass",
  async (f) => {
    const pending = await submittedFinal(f);
    await assert.rejects(
      rawRequest(f, pending.order.id, 51, 0),
      /pending receipt/,
    );
    const s = await paidStock(f),
      r = await request(f, s.order.id),
      ledgerId = rows(f, "CheckoutPaymentLedger").find(
        (l) => l.orderId === s.order.id,
      )!.id as string;
    assert.throws(
      () =>
        f.sqlite
          .prepare(
            "INSERT INTO CheckoutRefundAllocation(id,refundId,orderId,paymentLedgerId,goodsAmount,cargoAmount) VALUES(?,?,?,?,101,0)",
          )
          .run(randomUUID(), r.refund.id, s.order.id, ledgerId),
      /match original/,
    );
    const sql =
      "INSERT INTO CheckoutRefundLedger(id,refundId,orderId,goodsAmount,cargoAmount,totalAmount,currency,confirmedBy,confirmedAt,bankOperationDigest,operationKey,requestFingerprint,bankTransferVerified) VALUES(?,?,?,?,0,?,'UZS','owner',?,?,?,?,1)";
    for (const wrong of [100, 102])
      assert.throws(
        () =>
          f.sqlite
            .prepare(sql)
            .run(
              randomUUID(),
              r.refund.id,
              s.order.id,
              wrong,
              wrong,
              Date.now(),
              "d".repeat(64),
              randomUUID(),
              "e".repeat(64),
            ),
        /sealed request/,
      );
    await confirm(f, r.refund.id, 101);
    for (const table of [
      "CheckoutRefund",
      "CheckoutRefundAllocation",
      "CheckoutRefundLedger",
      "CheckoutRefundStockReconciliation",
      "CheckoutRefundStockRelease",
    ]) {
      assert.throws(
        () => f.sqlite.exec(`UPDATE ${table} SET id=id`),
        /immutable/,
      );
      assert.throws(() => f.sqlite.exec(`DELETE FROM ${table}`), /immutable/);
    }
    assert.throws(() =>
      f.sqlite.exec("UPDATE CheckoutOrder SET state='PAYMENTS_BLOCKED'"),
    );
    assert.throws(
      () => f.sqlite.exec("DELETE FROM CheckoutPaymentLedger"),
      /immutable/,
    );
    assert.equal(count(f, "CheckoutRefundLedger"), 1);
    assert.equal(stock(f), 5);
    assert.deepEqual(f.sqlite.prepare("PRAGMA foreign_key_check").all(), []);
  },
);
scenario(
  "SQL REQUESTED/COMPLETED block new FIRST/FINAL ledger/payment, arrival, cargo, invoice, cancellation and review",
  async (f) => {
    const s = await first(f),
      r = await request(f, s.order.id);
    for (const completed of [false, true]) {
      if (completed) await confirm(f, r.refund.id, 51);
      const statements = [
        `INSERT INTO CheckoutPayment(id,orderId,source,submittedBy,attachedBy,submitKey,submitFingerprint,declaredAmount,expectedAmount,proofStorageKey,proofMimeType,proofSize,proofSha256,submittedAt) SELECT 'forged',orderId,source,submittedBy,attachedBy,'forged-submit-key',submitFingerprint,declaredAmount,expectedAmount,proofStorageKey,proofMimeType,proofSize,proofSha256,submittedAt FROM CheckoutPayment WHERE id='${s.payment.payment.id}'`,
        `INSERT INTO CheckoutPaymentLedger(id,paymentId,orderId,phase,kind,goodsAmount,bankOperationDigest,verifiedBy,verifiedAt,reviewKey,reviewFingerprint) SELECT 'forged',paymentId,orderId,phase,kind,goodsAmount,bankOperationDigest,verifiedBy,verifiedAt,reviewKey,reviewFingerprint FROM CheckoutPaymentLedger WHERE orderId='${s.order.id}'`,
        `UPDATE CheckoutPayment SET status='APPROVED' WHERE orderId='${s.order.id}'`,
        `INSERT INTO CheckoutArrival(id,orderId,arrivedAt,itemSnapshot,createdBy,createdAt,operationKey,requestFingerprint) VALUES('forged','${s.order.id}',${Date.now()},'[]','owner',${Date.now()},'forged-arrival-key','${"b".repeat(64)}')`,
        `INSERT INTO CheckoutCargoCharge(id,orderId,arrivalId,version,amount,createdBy,createdAt,operationKey,requestFingerprint) VALUES('forged','${s.order.id}','missing',1,1,'owner',${Date.now()},'forged-cargo-key','${"b".repeat(64)}')`,
        `INSERT INTO CheckoutFinalInvoice(id,orderId,arrivalId,cargoChargeId,firstLedgerId,version,currency,goodsTotal,firstGoodsPaid,goodsDue,cargoDue,totalDue,createdBy,createdAt,operationKey,requestFingerprint) VALUES('forged','${s.order.id}','a','c','l',1,'UZS',101,51,50,1,51,'owner',${Date.now()},'forged-invoice-key','${"b".repeat(64)}')`,
        `INSERT INTO CheckoutCancellation(id,orderId,reason,createdBy,createdAt,operationKey,requestFingerprint,financialSnapshot,reservationSnapshot) VALUES('forged','${s.order.id}','Fixture','owner',${Date.now()},'forged-cancel-key','${"b".repeat(64)}','{}','[]')`,
        `INSERT INTO CheckoutStockRelease(id,cancellationId,orderId,itemId,variantId,quantity,stockBefore,stockAfter,createdAt) VALUES('forged','missing','${s.order.id}','missing','v',1,5,6,${Date.now()})`,
      ];
      for (const sql of statements)
        assert.throws(() => f.sqlite.exec(sql), /locked by refund/);
    }
  },
);
scenario(
  "SQL stock release cannot precede actual refund, exceed saved reserve, cross order or duplicate either release journal",
  async (f) => {
    const s = await paidStock(f),
      r = await request(f, s.order.id);
    const reconcileSQL =
      "INSERT INTO CheckoutRefundStockReconciliation(id,refundId,orderId,refundLedgerId,createdBy,createdAt,operationKey,requestFingerprint) VALUES(?,?,?,?,'owner',?,?,?)";
    assert.throws(
      () =>
        f.sqlite
          .prepare(reconcileSQL)
          .run(
            randomUUID(),
            r.refund.id,
            s.order.id,
            "missing",
            Date.now(),
            randomUUID(),
            "a".repeat(64),
          ),
      /completed IN_STOCK/,
    );
    f.sqlite.exec("UPDATE ProductVariant SET isActive=0");
    await confirm(f, r.refund.id, 101);
    f.sqlite.exec("UPDATE ProductVariant SET isActive=1");
    const completed = rows(f, "CheckoutRefundLedger")[0]!,
      item = s.order.items[0]!;
    f.sqlite.exec("BEGIN IMMEDIATE");
    try {
      const rec = randomUUID(),
        time = Date.now();
      f.sqlite
        .prepare(reconcileSQL)
        .run(
          rec,
          r.refund.id,
          s.order.id,
          completed.id as string,
          time,
          randomUUID(),
          "a".repeat(64),
        );
      const releaseSQL =
        "INSERT INTO CheckoutRefundStockRelease(id,reconciliationId,refundId,orderId,itemId,variantId,quantity,stockBefore,stockAfter,createdAt) VALUES(?,?,?,?,?,?,?,?,?,?)";
      assert.throws(
        () =>
          f.sqlite
            .prepare(releaseSQL)
            .run(
              randomUUID(),
              rec,
              r.refund.id,
              s.order.id,
              item.id,
              "v",
              2,
              4,
              6,
              time,
            ),
        /unsafe refund stock/,
      );
      assert.throws(
        () =>
          f.sqlite
            .prepare(
              "UPDATE CheckoutRefundStockReconciliation SET sealed=1 WHERE id=?",
            )
            .run(rec),
        /incomplete/,
      );
      f.sqlite
        .prepare(releaseSQL)
        .run(
          randomUUID(),
          rec,
          r.refund.id,
          s.order.id,
          item.id,
          "v",
          1,
          4,
          5,
          time,
        );
      assert.equal(stock(f), 5);
      assert.throws(() =>
        f.sqlite
          .prepare(releaseSQL)
          .run(
            randomUUID(),
            rec,
            r.refund.id,
            s.order.id,
            item.id,
            "v",
            1,
            5,
            6,
            time,
          ),
      );
    } finally {
      f.sqlite.exec("ROLLBACK");
    }
    assert.equal(stock(f), 4);
    assert.equal(count(f, "CheckoutRefundStockRelease"), 0);
    await f.refunds.reconcileStock(s.owner, r.refund.id, randomUUID());
    assert.equal(stock(f), 5);
    assert.equal(count(f, "CheckoutRefundLedger"), 1);
  },
);
for (const rollback of [false, true])
  test(`populated 0024 ${rollback ? "rollback" : "upgrade"}: preserves FIRST/FINAL/CARGO, proofs, unpaid cancellations, stock releases and legacy history`, async () => {
    const f = fixture("0024");
    try {
      await f.run(async () => {
        const s = await submittedFinal(f);
        await f.payments.review(
          s.owner,
          s.final.payment.id,
          randomUUID(),
          decision(67),
        );
        const unpaid = (await group(["IN_STOCK"])).orders[0]!;
        await f.cancellations.cancel(s.owner, unpaid.id, randomUUID(), reason);
        const rejected = await first(f, 50, false, false);
        await f.payments.review(
          rejected.owner,
          rejected.payment.payment.id,
          randomUUID(),
          { decision: "REJECT", reason: "NOT_RECEIVED" },
        );
        await first(f, 50, false, false);
        const tables = [
            "CheckoutGroup",
            "CheckoutOrder",
            "CheckoutOrderItem",
            "CheckoutPromoUse",
            "CheckoutPayment",
            "CheckoutPaymentLedger",
            "CheckoutArrival",
            "CheckoutCargoCharge",
            "CheckoutFinalInvoice",
            "CheckoutCancellation",
            "CheckoutStockRelease",
            "MediaObject",
            "MediaChunk",
            "AuditLog",
            "Order",
            "Payment",
            "Refund",
          ],
          before = new Map(tables.map((t) => [t, rows(f, t)]));
        const statements = migration().map((sql) => f.db.prepare(sql));
        if (rollback)
          await assert.rejects(
            f.db.batch([
              ...statements,
              f.db.prepare("SELECT * FROM missing_refund_upgrade_table"),
            ]),
          );
        else await f.db.batch(statements);
        for (const t of tables) assert.deepEqual(rows(f, t), before.get(t), t);
        assert.deepEqual(
          f.sqlite.prepare("PRAGMA foreign_key_check").all(),
          [],
        );
        assert.deepEqual(
          (await f.payments.proof(s.auth, s.final.payment.id)).data,
          png,
        );
        if (!rollback) {
          assert.equal(
            (await readOrderFinance(unpaid.id)).orderState,
            "CANCELLED",
          );
          const r = await request(f, s.order.id);
          const done = await confirm(f, r.refund.id, 118);
          assert.equal(done.finance.netReceivedTotal, 0);
          assert.equal(done.refund.totalAmount, 118);
        } else
          assert.equal(
            (
              f.sqlite
                .prepare(
                  "SELECT COUNT(*) n FROM sqlite_master WHERE name='CheckoutRefund'",
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

test("actual local D1: populated 0024 migration rollback/upgrade, manual completion retry and stock audit failure; no public/Admin refund routes or outbound calls", async () => {
  const f = await marketingRuntime("1", "0024");
  try {
    await f.db.exec(seed);
    const buyer = await runtimeUser(f, 900141),
      tokens = new JwtTokenService(randomBytes(32).toString("hex")),
      authority = new VoyeyOwnerAuthority(tokens, () => "900143"),
      payments = new LinkedCheckoutPayments(authority, true, card),
      preorder = new PreorderFinance(authority, true),
      cancellations = new LinkedCheckoutCancellations(authority, true),
      refunds = new LinkedCheckoutRefunds(authority, true),
      auth = "Bearer " + (await tokens.issue("buyer")),
      owner = "Bearer " + (await tokens.issue("owner"));
    const target = await withDatabase(f.db as unknown as Database, async () => {
      const a = (await group()).orders[0]!,
        p = await payments.submit(
          auth,
          a.id,
          randomUUID(),
          { declaredAmount: 51 },
          proof(),
        );
      await payments.review(owner, p.payment.id, randomUUID(), decision(51));
      await preorder.arrive(owner, a.id, randomUUID(), arrivalOf(a));
      await preorder.assignCargo(owner, a.id, randomUUID(), { amount: 17 });
      await preorder.issueInvoice(owner, a.id, randomUUID());
      const final = await payments.submitFinal(
        auth,
        a.id,
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
      const unpaid = (await group(["IN_STOCK"])).orders[0]!;
      await cancellations.cancel(owner, unpaid.id, randomUUID(), reason);
      const names = [
          "CheckoutPaymentLedger",
          "CheckoutCancellation",
          "CheckoutStockRelease",
          "CheckoutPayment",
          "CheckoutArrival",
          "CheckoutCargoCharge",
          "CheckoutFinalInvoice",
        ],
        before = new Map<string, unknown[]>();
      for (const t of names)
        before.set(
          t,
          (await f.db.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all())
            .results,
        );
      await assert.rejects(
        f.db.batch([
          ...migration().map((sql) => f.db.prepare(sql)),
          f.db.prepare("SELECT * FROM missing_refund_d1_table"),
        ]),
      );
      for (const t of names)
        assert.deepEqual(
          (await f.db.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all())
            .results,
          before.get(t),
        );
      await f.db.batch(migration().map((sql) => f.db.prepare(sql)));
      for (const t of names)
        assert.deepEqual(
          (await f.db.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all())
            .results,
          before.get(t),
        );
      const r = await refunds.request(owner, a.id, randomUUID(), reason),
        key = randomUUID(),
        data = outgoing(118);
      await f.db
        .prepare(
          "CREATE TRIGGER injected BEFORE INSERT ON AuditLog WHEN NEW.action='linked-refund.completed' BEGIN SELECT RAISE(ABORT,'injected D1 completion audit'); END",
        )
        .run();
      await assert.rejects(
        refunds.confirm(owner, r.refund.id, key, data),
        /injected/,
      );
      assert.equal((await readOrderFinance(a.id)).refundStatus, "REQUESTED");
      assert.equal((await readOrderFinance(a.id)).refundedTotal, 0);
      await f.db.prepare("DROP TRIGGER injected").run();
      const done = await refunds.confirm(owner, r.refund.id, key, data);
      assert.equal(done.finance.netReceivedTotal, 0);
      assert.deepEqual(
        await refunds.confirm(owner, r.refund.id, key, data),
        done,
      );
      assert.deepEqual(
        (await payments.proof(auth, final.payment.id)).data,
        png,
      );
      const o = (await group(["IN_STOCK"])).orders[0]!,
        ip = await payments.submit(
          auth,
          o.id,
          randomUUID(),
          { declaredAmount: 101 },
          proof(),
        );
      await payments.review(owner, ip.payment.id, randomUUID(), decision(101));
      const ir = await refunds.request(owner, o.id, randomUUID(), reason),
        ik = randomUUID(),
        iv = outgoing(101);
      await f.db
        .prepare(
          "CREATE TRIGGER injected BEFORE INSERT ON AuditLog WHEN NEW.action='linked-refund.stock-reconciled' BEGIN SELECT RAISE(ABORT,'injected D1 stock audit'); END",
        )
        .run();
      const inventory = await refunds.confirm(owner, ir.refund.id, ik, iv);
      assert.equal(inventory.refund.status, "COMPLETED");
      assert.equal(
        inventory.finance.stockReconciliationState,
        "REQUIRES_RECONCILIATION",
      );
      assert.equal(
        (await f.db
          .prepare("SELECT stock FROM ProductVariant WHERE id='v'")
          .first<{ stock: number }>())!.stock,
        4,
      );
      await f.db.prepare("DROP TRIGGER injected").run();
      const retry = await refunds.confirm(owner, ir.refund.id, ik, iv);
      assert.equal(retry.finance.stockReconciliationState, "RELEASED");
      assert.equal(
        (await f.db
          .prepare("SELECT stock FROM ProductVariant WHERE id='v'")
          .first<{ stock: number }>())!.stock,
        5,
      );
      assert.deepEqual(
        (await f.db.prepare("PRAGMA foreign_key_check").all()).results,
        [],
      );
      return { order: o, refundId: ir.refund.id };
    });
    for (const path of [
      `/checkout/refunds/${target.refundId}/confirm`,
      `/checkout/orders/${target.order.id}/refund`,
      `/admin/checkout/orders/${target.order.id}/refund`,
      `/admin/linked-refunds/${target.refundId}/confirm`,
    ])
      for (const identity of ["anonymous", "buyer", "admin"]) {
        const result = await f.call(
          path,
          "POST",
          outgoing(101),
          identity === "admin"
            ? f.signed
            : identity === "buyer"
              ? { authorization: "Bearer " + buyer.token }
              : {},
          identity === "admin"
            ? "https://admin.preview.invalid"
            : "https://preview.invalid",
        );
        assert.ok(
          [403, 404].includes(result.status),
          `${path} ${identity}: ${result.status}`,
        );
      }
    assert.equal(
      (
        await f.admin(
          `/finance/refunds/${target.refundId}/complete`,
          "POST",
          {},
        )
      ).status,
      404,
    );
    assert.equal(
      (
        await f.admin(`/orders/${target.order.publicId}/cancel`, "POST", {
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
