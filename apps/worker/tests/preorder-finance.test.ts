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
      "../migrations/0023_linked_checkout_final_payment.sql",
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

for (const [percent, cargo, goods, final] of [
  [50, 17, 50, 67],
  [100, 17, 0, 17],
  [50, 0, 50, 50],
] as const)
  test(`PREORDER ${percent}% cargo=${cargo}: final=${final}, exact GOODS/CARGO, FIRST remains unchanged`, async () => {
    const f = fixture();
    try {
      await f.run(async () => {
        const s = await submittedFinal(f, percent, cargo);
        assert.equal(s.snapshot.invoice!.goodsDue, goods);
        assert.equal(s.snapshot.invoice!.cargoDue, cargo);
        assert.equal(s.snapshot.invoice!.totalDue, final);
        assert.equal(s.final.finance.finalDue, final);
        assert.equal(s.final.finance.finalPaymentState, "PENDING_REVIEW");
        assert.equal(s.final.finance.firstPaymentState, "CONFIRMED");
        const firstLedger = f.sqlite
          .prepare("SELECT * FROM CheckoutPaymentLedger WHERE phase='FIRST'")
          .get();
        assert.equal(
          (await f.payments.finalInstructions(s.auth, s.order.id)).amount,
          final,
        );
        const key = randomUUID(),
          value = decision(final),
          result = await f.payments.review(
            s.owner,
            s.final.payment.id,
            key,
            value,
          );
        assert.equal(result.finance.goodsPaid, 101);
        assert.equal(result.finance.cargoPaid, cargo);
        assert.equal(result.finance.unpaidGoods, 0);
        assert.equal(result.finance.unpaidCargo, 0);
        assert.equal(result.finance.finalDue, 0);
        assert.equal(result.finance.financiallySettled, 1);
        assert.equal(result.finance.fulfillmentAllowed, 0);
        assert.equal(result.finance.orderState, "PAYMENTS_BLOCKED");
        const ledger = f.sqlite
          .prepare("SELECT * FROM CheckoutPaymentLedger WHERE phase='FINAL'")
          .get() as {
          goodsAmount: number;
          cargoAmount: number;
          invoiceId: string;
        };
        assert.equal(ledger.goodsAmount, goods);
        assert.equal(ledger.cargoAmount, cargo);
        assert.equal(ledger.invoiceId, s.snapshot.invoice!.id);
        assert.equal(
          ledger.goodsAmount + ledger.cargoAmount,
          result.payment.confirmedAmount,
        );
        assert.deepEqual(
          f.sqlite
            .prepare("SELECT * FROM CheckoutPaymentLedger WHERE phase='FIRST'")
            .get(),
          firstLedger,
        );
        assert.deepEqual(
          await f.payments.review(s.owner, s.final.payment.id, key, value),
          result,
        );
        assert.equal(count(f, "CheckoutPaymentLedger"), 2);
        assert.equal(
          (await readCheckoutGroup("buyer", s.group.id)).orders[0]!.goodsPaid,
          101,
        );
        await assert.rejects(
          f.payments.submitFinal(
            s.auth,
            s.order.id,
            randomUUID(),
            { declaredAmount: final },
            proof(),
          ),
          /positive issued/,
        );
        await assert.rejects(
          f.payments.submit(
            s.auth,
            s.order.id,
            randomUUID(),
            { declaredAmount: 101 },
            proof(),
          ),
          /already confirmed/,
        );
        assert.equal(
          (
            f.sqlite
              .prepare("SELECT stock FROM ProductVariant WHERE id='v'")
              .get() as { stock: number }
          ).stock,
          5,
        );
        assert.deepEqual(
          f.sqlite.prepare("PRAGMA foreign_key_check").all(),
          [],
        );
      });
    } finally {
      f.sqlite.close();
    }
  });

test("PREORDER 100% cargo null differs from zero; zero invoice settles without fictitious receipt or ledger", async () => {
  const f = fixture();
  try {
    await f.run(async () => {
      const s = await first(f, 100);
      const before = await f.payments.state(s.auth, s.order.id);
      assert.equal(before.cargoAmount, null);
      assert.equal(before.unpaidCargo, null);
      assert.equal(before.finalDue, null);
      assert.equal(before.financiallySettled, 0);
      await f.preorder.arrive(s.owner, s.order.id, randomUUID(), arrival(s));
      assert.equal(
        (await f.payments.state(s.auth, s.order.id)).cargoAmount,
        null,
      );
      await assert.rejects(
        f.preorder.issueInvoice(s.owner, s.order.id, randomUUID()),
        /known cargo/,
      );
      const assigned = await f.preorder.assignCargo(
        s.owner,
        s.order.id,
        randomUUID(),
        { amount: 0 },
      );
      assert.equal(assigned.finance.cargoAmount, 0);
      assert.equal(assigned.finance.finalDue, null);
      const issued = await f.preorder.issueInvoice(
        s.owner,
        s.order.id,
        randomUUID(),
      );
      assert.equal(issued.invoice!.totalDue, 0);
      assert.equal(issued.finance.finalDue, 0);
      assert.equal(issued.finance.finalPaymentState, "SETTLED_ZERO");
      assert.equal(issued.finance.financiallySettled, 1);
      assert.equal(issued.finance.fulfillmentAllowed, 0);
      await assert.rejects(
        f.payments.submitFinal(
          s.auth,
          s.order.id,
          randomUUID(),
          { declaredAmount: 1 },
          proof(),
        ),
        /positive issued/,
      );
      await assert.rejects(
        f.payments.finalInstructions(s.auth, s.order.id),
        /positive issued/,
      );
      assert.equal(count(f, "CheckoutPayment"), 1);
      assert.equal(count(f, "CheckoutPaymentLedger"), 1);
      assert.equal(count(f, "MediaObject"), 1);
    });
  } finally {
    f.sqlite.close();
  }
});

test("invoice requires full arrival, known cargo AND confirmed FIRST; early final receipts create no files", async () => {
  const f = fixture();
  try {
    await f.run(async () => {
      const s = await first(f, 50, false, false),
        media = count(f, "MediaObject");
      await assert.rejects(
        f.preorder.assignCargo(s.owner, s.order.id, randomUUID(), {
          amount: 17,
        }),
        /confirmed full arrival/,
      );
      await assert.rejects(
        f.preorder.issueInvoice(s.owner, s.order.id, randomUUID()),
        /arrival/,
      );
      await assert.rejects(
        f.payments.submitFinal(
          s.auth,
          s.order.id,
          randomUUID(),
          { declaredAmount: 67 },
          proof(),
        ),
        /positive issued/,
      );
      await f.preorder.arrive(s.owner, s.order.id, randomUUID(), arrival(s));
      await assert.rejects(
        f.preorder.issueInvoice(s.owner, s.order.id, randomUUID()),
        /known cargo/,
      );
      await f.preorder.assignCargo(s.owner, s.order.id, randomUUID(), {
        amount: 17,
      });
      await assert.rejects(
        f.preorder.issueInvoice(s.owner, s.order.id, randomUUID()),
        /confirmed FIRST/,
      );
      assert.equal(count(f, "CheckoutFinalInvoice"), 0);
      assert.equal(count(f, "MediaObject"), media);
      await f.payments.review(
        s.owner,
        s.payment.payment.id,
        s.reviewKey,
        s.review,
      );
      assert.equal(
        (await f.preorder.issueInvoice(s.owner, s.order.id, randomUUID()))
          .invoice!.totalDue,
        67,
      );
    });
  } finally {
    f.sqlite.close();
  }
});

test("partial, duplicate or wrong SKU quantities cannot declare full arrival, including direct SQL", async () => {
  const f = fixture();
  try {
    await f.run(async () => {
      const s = await first(f, 50, true),
        body = arrival(s);
      for (const items of [
        body.items.slice(0, 1),
        [body.items[0]!, body.items[0]!],
        body.items.map((i) => ({ ...i, quantity: 1 })),
        body.items.map((i) => ({ ...i, itemId: randomUUID() })),
      ])
        await assert.rejects(
          f.preorder.arrive(s.owner, s.order.id, randomUUID(), {
            ...body,
            items,
          }),
          /all preorder items/,
        );
      await assert.rejects(
        f.preorder.arrive(s.owner, s.order.id, randomUUID(), {
          ...body,
          allItemsReceived: true,
        }),
        { statusCode: 400 },
      );
      await assert.rejects(
        f.preorder.arrive(s.owner, s.order.id, randomUUID(), {
          ...body,
          arrivedAt: new Date(Date.now() + 60000).toISOString(),
        }),
        /valid actual arrival/,
      );
      const firstItem = s.order.items[0]!;
      assert.throws(
        () =>
          f.sqlite
            .prepare(
              "INSERT INTO CheckoutArrival(id,orderId,arrivedAt,itemSnapshot,createdBy,createdAt,operationKey,requestFingerprint) VALUES(?,?,?,?,?,?,?,?)",
            )
            .run(
              randomUUID(),
              s.order.id,
              Date.now(),
              JSON.stringify([
                {
                  itemId: firstItem.id,
                  variantId: firstItem.variantId,
                  quantity: firstItem.quantity,
                },
              ]),
              "owner",
              Date.now(),
              randomUUID(),
              "a".repeat(64),
            ),
        /all preorder items/,
      );
      assert.equal(count(f, "CheckoutArrival"), 0);
      assert.equal(
        (await f.preorder.arrive(s.owner, s.order.id, randomUUID(), body))
          .arrival!.orderId,
        s.order.id,
      );
      assert.equal(count(f, "CheckoutArrival"), 1);
    });
  } finally {
    f.sqlite.close();
  }
});

test("arrival/cargo/invoice replay are immutable; new keys cannot create another version or debt", async () => {
  const f = fixture();
  try {
    await f.run(async () => {
      const s = await first(f),
        body = arrival(s),
        arrivalKey = randomUUID(),
        cargoKey = randomUUID(),
        invoiceKey = randomUUID();
      const a = await f.preorder.arrive(s.owner, s.order.id, arrivalKey, body);
      assert.deepEqual(
        await f.preorder.arrive(s.owner, s.order.id, arrivalKey, body),
        a,
      );
      await assert.rejects(
        f.preorder.arrive(s.owner, s.order.id, randomUUID(), body),
        /Immutable operation/,
      );
      const c = await f.preorder.assignCargo(s.owner, s.order.id, cargoKey, {
        amount: 17,
      });
      assert.deepEqual(
        await f.preorder.assignCargo(s.owner, s.order.id, cargoKey, {
          amount: 17,
        }),
        c,
      );
      for (const [key, amount] of [
        [randomUUID(), 17],
        [cargoKey, 18],
        [randomUUID(), 18],
      ] as const)
        await assert.rejects(
          f.preorder.assignCargo(s.owner, s.order.id, key, { amount }),
          /Immutable operation/,
        );
      const i = await f.preorder.issueInvoice(s.owner, s.order.id, invoiceKey);
      assert.deepEqual(
        await f.preorder.issueInvoice(s.owner, s.order.id, invoiceKey),
        i,
      );
      await assert.rejects(
        f.preorder.issueInvoice(s.owner, s.order.id, randomUUID()),
        /Immutable operation/,
      );
      const final = await f.payments.submitFinal(
        s.auth,
        s.order.id,
        randomUUID(),
        { declaredAmount: 67 },
        proof(),
      );
      await f.payments.review(
        s.owner,
        final.payment.id,
        randomUUID(),
        decision(67),
      );
      assert.deepEqual(
        (await f.preorder.issueInvoice(s.owner, s.order.id, invoiceKey))
          .invoice,
        i.invoice,
      );
      await assert.rejects(
        f.preorder.assignCargo(s.owner, s.order.id, randomUUID(), {
          amount: 18,
        }),
        /Immutable operation/,
      );
      for (const table of [
        "CheckoutArrival",
        "CheckoutCargoCharge",
        "CheckoutFinalInvoice",
      ])
        assert.equal(count(f, table), 1);
      assert.equal(count(f, "CheckoutPaymentLedger"), 2);
    });
  } finally {
    f.sqlite.close();
  }
});

test("concurrent arrival/cargo/invoice operations cannot create a second financial version", async () => {
  const f = fixture();
  try {
    await f.run(async () => {
      const s = await first(f),
        body = arrival(s),
        arrivalKey = randomUUID();
      const arrivals = await Promise.all([
        f.preorder.arrive(s.owner, s.order.id, arrivalKey, body),
        f.preorder.arrive(s.owner, s.order.id, arrivalKey, body),
      ]);
      assert.equal(arrivals[0]!.arrival!.id, arrivals[1]!.arrival!.id);
      const charges = await Promise.allSettled([
        f.preorder.assignCargo(s.owner, s.order.id, randomUUID(), {
          amount: 17,
        }),
        f.preorder.assignCargo(s.owner, s.order.id, randomUUID(), {
          amount: 18,
        }),
      ]);
      assert.equal(charges.filter((r) => r.status === "fulfilled").length, 1);
      const key = randomUUID(),
        invoices = await Promise.all([
          f.preorder.issueInvoice(s.owner, s.order.id, key),
          f.preorder.issueInvoice(s.owner, s.order.id, key),
        ]);
      assert.equal(invoices[0]!.invoice!.id, invoices[1]!.invoice!.id);
      assert.equal(
        invoices[0]!.invoice!.totalDue,
        50 + invoices[0]!.cargo!.amount,
      );
      for (const table of [
        "CheckoutArrival",
        "CheckoutCargoCharge",
        "CheckoutFinalInvoice",
      ])
        assert.equal(count(f, table), 1);
      assert.equal(count(f, "CheckoutPaymentLedger"), 1);
    });
  } finally {
    f.sqlite.close();
  }
});

test("final invoice uses immutable prices/discount, does not affect IN_STOCK sibling or redeem promo again", async () => {
  const f = fixture();
  try {
    await f.run(async () => {
      await new PromoCodeService().save(WEB_ADMIN_ACTOR, {
        code: "FINAL3",
        type: "FIXED",
        value: 3,
        isActive: true,
      });
      const g = await group(["IN_STOCK", "PREORDER"], 50, false, "FINAL3"),
        o = g.orders.find((o) => o.saleMode === "PREORDER")!,
        auth = await f.auth(),
        owner = await f.auth("owner");
      const p = await f.payments.submit(
        auth,
        o.id,
        randomUUID(),
        { declaredAmount: 50 },
        proof(),
      );
      await f.payments.review(owner, p.payment.id, randomUUID(), decision(50));
      await f.preorder.arrive(owner, o.id, randomUUID(), {
        arrivedAt: new Date().toISOString(),
        items: o.items.map((i) => ({ itemId: i.id, quantity: i.quantity })),
      });
      await f.preorder.assignCargo(owner, o.id, randomUUID(), { amount: 17 });
      f.sqlite.exec(
        "UPDATE Product SET price=9999 WHERE id='p'; UPDATE PromoCode SET value=50 WHERE code='FINAL3'",
      );
      const i = await f.preorder.issueInvoice(owner, o.id, randomUUID());
      assert.equal(i.invoice!.goodsTotal, 100);
      assert.equal(i.invoice!.goodsDue, 50);
      assert.equal(i.invoice!.totalDue, 67);
      const pay = await f.payments.submitFinal(
        auth,
        o.id,
        randomUUID(),
        { declaredAmount: 67 },
        proof(),
      );
      await f.payments.review(
        owner,
        pay.payment.id,
        randomUUID(),
        decision(67),
      );
      const after = await readCheckoutGroup("buyer", g.id);
      assert.equal(after.discountAmount, 3);
      assert.deepEqual(
        after.orders.map((o) => o.discountAmount),
        [2, 1],
      );
      assert.equal(count(f, "CheckoutPromoUse"), 1);
      assert.equal(after.orders[0]!.goodsPaid, 0);
      assert.equal(after.orders[0]!.cargoAmount, null);
      assert.equal(after.orders[1]!.goodsPaid, 100);
      assert.equal(after.orders[1]!.cargoPaid, 17);
      assert.equal(
        (
          f.sqlite
            .prepare("SELECT stock FROM ProductVariant WHERE id='v'")
            .get() as { stock: number }
        ).stock,
        4,
      );
    });
  } finally {
    f.sqlite.close();
  }
});

test("final rejection/retry and submission replay never add money or duplicate first payment", async () => {
  const f = fixture();
  try {
    await f.run(async () => {
      const s = await submittedFinal(f),
        key = randomUUID();
      await f.payments.review(s.owner, s.final.payment.id, key, {
        decision: "REJECT",
        reason: "NOT_RECEIVED",
      });
      assert.equal(
        (await f.payments.state(s.auth, s.order.id)).finalPaymentState,
        "REJECTED",
      );
      assert.equal(count(f, "CheckoutPaymentLedger"), 1);
      const submissionKey = randomUUID(),
        second = await f.payments.submitFinal(
          s.auth,
          s.order.id,
          submissionKey,
          { declaredAmount: 67 },
          proof(),
        );
      assert.deepEqual(
        await f.payments.submitFinal(
          s.auth,
          s.order.id,
          submissionKey,
          { declaredAmount: 67 },
          proof(),
        ),
        second,
      );
      await assert.rejects(
        f.payments.submit(
          s.auth,
          s.order.id,
          submissionKey,
          { declaredAmount: 67 },
          proof(),
        ),
        /key reuse/,
      );
      const approved = await f.payments.review(
        s.owner,
        second.payment.id,
        randomUUID(),
        decision(67),
      );
      assert.equal(approved.finance.goodsPaid, 101);
      assert.equal(approved.finance.cargoPaid, 17);
      assert.equal(count(f, "CheckoutPaymentLedger"), 2);
      const replay = await f.payments.submitFinal(
        s.auth,
        s.order.id,
        submissionKey,
        { declaredAmount: 67 },
        proof(),
      );
      assert.equal(replay.payment.id, second.payment.id);
      assert.equal(replay.payment.status, "APPROVED");
      assert.equal(count(f, "MediaObject"), 3);
    });
  } finally {
    f.sqlite.close();
  }
});

test("bank operation from FIRST cannot be reused in FINAL, nor can FINAL credit two orders", async () => {
  const f = fixture();
  try {
    await f.run(async () => {
      const s = await submittedFinal(f);
      await assert.rejects(
        f.payments.review(
          s.owner,
          s.final.payment.id,
          randomUUID(),
          decision(
            67,
            s.review.bankOperationReference.replaceAll("-", "").toLowerCase(),
          ),
        ),
        /already credited/,
      );
      const bank = randomUUID();
      await f.payments.review(
        s.owner,
        s.final.payment.id,
        randomUUID(),
        decision(67, bank),
      );
      const other = await submittedFinal(f);
      await assert.rejects(
        f.payments.review(
          other.owner,
          other.final.payment.id,
          randomUUID(),
          decision(67, bank),
        ),
        /already credited/,
      );
      assert.equal(count(f, "CheckoutPaymentLedger"), 3);
      assert.equal(
        (await f.payments.state(other.auth, other.order.id)).finalDue,
        67,
      );
    });
  } finally {
    f.sqlite.close();
  }
});

test("concurrent final confirmation/replay and competing final bank credits have one economic result", async () => {
  const f = fixture();
  try {
    await f.run(async () => {
      const s = await submittedFinal(f),
        key = randomUUID(),
        value = decision(67);
      const responses = await Promise.all([
        f.payments.review(s.owner, s.final.payment.id, key, value),
        f.payments.review(s.owner, s.final.payment.id, key, value),
      ]);
      assert.deepEqual(responses[0], responses[1]);
      assert.equal(count(f, "CheckoutPaymentLedger"), 2);
      const a = await submittedFinal(f),
        b = await submittedFinal(f),
        bank = randomUUID();
      const results = await Promise.allSettled([
        f.payments.review(
          a.owner,
          a.final.payment.id,
          randomUUID(),
          decision(67, bank),
        ),
        f.payments.review(
          b.owner,
          b.final.payment.id,
          randomUUID(),
          decision(67, bank),
        ),
      ]);
      assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
      assert.equal(count(f, "CheckoutPaymentLedger"), 5);
      const balances = await Promise.all([
        f.payments.state(a.auth, a.order.id),
        f.payments.state(b.auth, b.order.id),
      ]);
      assert.equal(
        balances.reduce((sum, s) => sum + s.finalDue!, 0),
        67,
      );
    });
  } finally {
    f.sqlite.close();
  }
});

test("amount/type/overflow and client allocation validation; boundary total remains exact", async () => {
  const f = fixture();
  try {
    await f.run(async () => {
      const s = await first(f);
      await f.preorder.arrive(s.owner, s.order.id, randomUUID(), arrival(s));
      for (const amount of [
        -1,
        1.5,
        2147483648,
        2147483647,
        "17",
        NaN,
        Infinity,
      ])
        await assert.rejects(
          f.preorder.assignCargo(s.owner, s.order.id, randomUUID(), { amount }),
        );
      await assert.rejects(
        f.preorder.assignCargo(s.owner, s.order.id, randomUUID(), {
          amount: 17,
          increment: true,
        }),
        { statusCode: 400 },
      );
      await assert.rejects(
        f.preorder.issueInvoice(s.owner, s.order.id, randomUUID(), {
          goodsDue: 1,
        }),
        { statusCode: 400 },
      );
      await f.preorder.assignCargo(s.owner, s.order.id, randomUUID(), {
        amount: 2147483546,
      });
      const i = await f.preorder.issueInvoice(
        s.owner,
        s.order.id,
        randomUUID(),
      );
      assert.equal(i.invoice!.totalDue, 2147483596);
      const p = await f.payments.submitFinal(
        s.auth,
        s.order.id,
        randomUUID(),
        { declaredAmount: i.invoice!.totalDue },
        proof(),
      );
      for (const value of [
        decision(i.invoice!.totalDue + 1),
        decision(i.invoice!.totalDue - 1),
        {
          ...decision(i.invoice!.totalDue),
          goodsAmount: 50,
          cargoAmount: 2147483546,
        },
      ])
        await assert.rejects(
          f.payments.review(s.owner, p.payment.id, randomUUID(), value),
        );
      const paid = await f.payments.review(
        s.owner,
        p.payment.id,
        randomUUID(),
        decision(i.invoice!.totalDue),
      );
      assert.equal(paid.finance.goodsPaid + paid.finance.cargoPaid, 2147483647);
      assert.equal(paid.finance.finalDue, 0);
    });
  } finally {
    f.sqlite.close();
  }
});

test("default-off, ordinary Admin/staff/missing owner and IN_STOCK cannot bypass new finance", async () => {
  const f = fixture();
  try {
    await f.run(async () => {
      const s = await first(f),
        body = arrival(s),
        disabled = new PreorderFinance(f.owner);
      await assert.rejects(
        disabled.arrive(s.owner, s.order.id, randomUUID(), body),
        { statusCode: 503 },
      );
      for (const auth of [
        await f.auth("employee"),
        s.auth,
        undefined,
        WEB_ADMIN_ACTOR,
      ]) {
        await assert.rejects(
          f.preorder.arrive(auth, s.order.id, randomUUID(), body),
          { statusCode: 403 },
        );
        await assert.rejects(
          f.preorder.assignCargo(auth, s.order.id, randomUUID(), {
            amount: 17,
          }),
          { statusCode: 403 },
        );
        await assert.rejects(
          f.preorder.issueInvoice(auth, s.order.id, randomUUID()),
          { statusCode: 403 },
        );
      }
      f.config.owner = "";
      await assert.rejects(
        f.preorder.arrive(s.owner, s.order.id, randomUUID(), body),
        { statusCode: 503 },
      );
      f.config.owner = "900143";
      const stock = (await group(["IN_STOCK"])).orders[0]!;
      for (const operation of [
        () =>
          f.preorder.arrive(s.owner, stock.id, randomUUID(), {
            arrivedAt: new Date().toISOString(),
            items: stock.items.map((i) => ({
              itemId: i.id,
              quantity: i.quantity,
            })),
          }),
        () =>
          f.preorder.assignCargo(s.owner, stock.id, randomUUID(), {
            amount: 0,
          }),
        () => f.preorder.issueInvoice(s.owner, stock.id, randomUUID()),
        () =>
          f.payments.submitFinal(
            s.auth,
            stock.id,
            randomUUID(),
            { declaredAmount: 1 },
            proof(),
          ),
      ])
        await assert.rejects(operation(), { statusCode: 409 });
      assert.equal(count(f, "CheckoutArrival"), 0);
      assert.equal(count(f, "CheckoutFinalInvoice"), 0);
    });
  } finally {
    f.sqlite.close();
  }
});

for (const stage of ["arrival", "cargo", "invoice", "final"] as const)
  test(`owner revoked between authorization and commit: ${stage}`, async () => {
    const f = fixture();
    try {
      await f.run(async () => {
        const s = await first(f),
          body = arrival(s);
        if (stage !== "arrival")
          await f.preorder.arrive(s.owner, s.order.id, randomUUID(), body);
        if (stage === "invoice" || stage === "final")
          await f.preorder.assignCargo(s.owner, s.order.id, randomUUID(), {
            amount: 17,
          });
        if (stage === "final")
          await f.preorder.issueInvoice(s.owner, s.order.id, randomUUID());
        const p =
          stage === "final"
            ? await f.payments.submitFinal(
                s.auth,
                s.order.id,
                randomUUID(),
                { declaredAmount: 67 },
                proof(),
              )
            : null;
        const table = {
          arrival: "CheckoutArrival",
          cargo: "CheckoutCargoCharge",
          invoice: "CheckoutFinalInvoice",
          final: "CheckoutPaymentLedger",
        }[stage];
        let revoked = false;
        const wrapped: Database = {
          prepare: (sql) => f.db.prepare(sql),
          batch: async (statements) => {
            if (
              !revoked &&
              statements.some((statement) =>
                (statement as unknown as { sql: string }).sql.includes(
                  "INSERT INTO " + table,
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
        const action =
          stage === "arrival"
            ? () => f.preorder.arrive(s.owner, s.order.id, randomUUID(), body)
            : stage === "cargo"
              ? () =>
                  f.preorder.assignCargo(s.owner, s.order.id, randomUUID(), {
                    amount: 17,
                  })
              : stage === "invoice"
                ? () =>
                    f.preorder.issueInvoice(s.owner, s.order.id, randomUUID())
                : () =>
                    f.payments.review(
                      s.owner,
                      p!.payment.id,
                      randomUUID(),
                      decision(67),
                    );
        await assert.rejects(
          withDatabase(wrapped, async () => {
            await action();
          }),
          {
            statusCode: 403,
          },
        );
        assert.ok(revoked);
        assert.equal(count(f, table), stage === "final" ? 1 : 0);
        assert.equal(
          (await f.payments.state(s.auth, s.order.id)).goodsPaid,
          51,
        );
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
      });
    } finally {
      f.sqlite.close();
    }
  });

for (const [stage, table, action] of [
  ["arrival", "CheckoutArrival", "preorder.arrived"],
  ["cargo", "CheckoutCargoCharge", "preorder.cargo-assigned"],
  ["invoice", "CheckoutFinalInvoice", "preorder.final-invoiced"],
  ["final", "CheckoutPaymentLedger", "linked-payment.approved"],
] as const)
  for (const failure of ["row", "audit"] as const)
    test(`atomic rollback and retry at ${stage} ${failure}`, async () => {
      const f = fixture();
      try {
        await f.run(async () => {
          const s = await first(f),
            body = arrival(s),
            key = randomUUID();
          if (stage !== "arrival")
            await f.preorder.arrive(s.owner, s.order.id, randomUUID(), body);
          if (stage === "invoice" || stage === "final")
            await f.preorder.assignCargo(s.owner, s.order.id, randomUUID(), {
              amount: 17,
            });
          if (stage === "final")
            await f.preorder.issueInvoice(s.owner, s.order.id, randomUUID());
          const p =
              stage === "final"
                ? await f.payments.submitFinal(
                    s.auth,
                    s.order.id,
                    randomUUID(),
                    { declaredAmount: 67 },
                    proof(),
                  )
                : null,
            before = count(f, "AuditLog"),
            value = decision(67);
          f.sqlite.exec(
            failure === "row"
              ? `CREATE TRIGGER injected_c2 BEFORE INSERT ON ${table} BEGIN SELECT RAISE(ABORT,'injected operation failure'); END`
              : `CREATE TRIGGER injected_c2 BEFORE INSERT ON AuditLog WHEN NEW.action='${action}' BEGIN SELECT RAISE(ABORT,'injected audit failure'); END`,
          );
          const operation =
            stage === "arrival"
              ? () => f.preorder.arrive(s.owner, s.order.id, key, body)
              : stage === "cargo"
                ? () =>
                    f.preorder.assignCargo(s.owner, s.order.id, key, {
                      amount: 17,
                    })
                : stage === "invoice"
                  ? () => f.preorder.issueInvoice(s.owner, s.order.id, key)
                  : () => f.payments.review(s.owner, p!.payment.id, key, value);
          await assert.rejects(operation(), /injected/);
          assert.equal(count(f, table), stage === "final" ? 1 : 0);
          assert.equal(count(f, "AuditLog"), before);
          assert.equal(
            (await f.payments.state(s.auth, s.order.id)).goodsPaid,
            51,
          );
          f.sqlite.exec("DROP TRIGGER injected_c2");
          await operation();
          assert.equal(count(f, table), stage === "final" ? 2 : 1);
        });
      } finally {
        f.sqlite.close();
      }
    });

test("final proof atomicity, private ownership and SQL allocation/immutability constraints", async () => {
  const f = fixture();
  try {
    await f.run(async () => {
      const s = await invoice(f),
        key = randomUUID();
      f.sqlite.exec(
        "CREATE TRIGGER fail_final_proof BEFORE INSERT ON CheckoutPayment WHEN NEW.phase='FINAL' BEGIN SELECT RAISE(ABORT,'injected final proof failure'); END",
      );
      await assert.rejects(
        f.payments.submitFinal(
          s.auth,
          s.order.id,
          key,
          { declaredAmount: 67 },
          proof(),
        ),
        /injected/,
      );
      assert.equal(count(f, "MediaObject"), 1);
      assert.equal(count(f, "CheckoutPayment"), 1);
      f.sqlite.exec("DROP TRIGGER fail_final_proof");
      await assert.rejects(
        f.payments.submitFinal(
          await f.auth("other"),
          s.order.id,
          key,
          { declaredAmount: 67 },
          proof(),
        ),
        { statusCode: 404 },
      );
      const p = await f.payments.submitFinal(
        s.auth,
        s.order.id,
        key,
        { declaredAmount: 67 },
        proof(),
      );
      await assert.rejects(
        f.payments.proof(await f.auth("other"), p.payment.id),
        { statusCode: 403 },
      );
      assert.deepEqual(
        (await f.payments.proof(s.owner, p.payment.id)).data,
        png,
      );
      for (const [goods, cargo] of [
        [49, 18],
        [51, 16],
        [50, 18],
        [67, 0],
      ]) {
        assert.throws(() =>
          f.sqlite
            .prepare(
              "INSERT INTO CheckoutPaymentLedger(id,paymentId,orderId,phase,kind,goodsAmount,cargoAmount,bankOperationDigest,verifiedBy,verifiedAt,reviewKey,reviewFingerprint,invoiceId) VALUES(?,?,?,'FINAL','MANUAL_CARD_TRANSFER',?,?,?,'owner',?,?,?,?)",
            )
            .run(
              randomUUID(),
              p.payment.id,
              s.order.id,
              goods,
              cargo,
              randomBytes(32).toString("hex"),
              Date.now(),
              randomUUID(),
              "a".repeat(64),
              s.snapshot.invoice!.id,
            ),
        );
      }
      for (const table of [
        "CheckoutArrival",
        "CheckoutCargoCharge",
        "CheckoutFinalInvoice",
      ]) {
        assert.throws(() => f.sqlite.exec(`DELETE FROM ${table}`), /immutable/);
        assert.throws(
          () => f.sqlite.exec(`UPDATE ${table} SET createdAt=1`),
          /immutable/,
        );
      }
      assert.throws(
        () => f.sqlite.exec("UPDATE CheckoutOrder SET cargoAmount=17"),
        /blocked/,
      );
      assert.throws(
        () => f.sqlite.exec("DELETE FROM CheckoutOrderItem"),
        /immutable/,
      );
      assert.equal(count(f, "CheckoutPaymentLedger"), 1);
      assert.equal(count(f, "Refund"), 0);
    });
  } finally {
    f.sqlite.close();
  }
});

for (const rollback of [false, true])
  test(`populated 0022 migration ${rollback ? "rollback" : "upgrade"}: FIRST decisions, bank IDs, proofs and replay remain intact`, async () => {
    const f = fixture("0022");
    try {
      await f.run(async () => {
        const paid = await first(f),
          pending = await first(f, 100, false, false),
          rejected = await first(f, 50, false, false);
        await f.payments.review(
          rejected.owner,
          rejected.payment.payment.id,
          randomUUID(),
          { decision: "REJECT", reason: "NOT_RECEIVED" },
        );
        f.sqlite
          .exec(`INSERT INTO "Order"(id,publicId,userId,idempotencyKey,fullName,phone,city,address,subtotal,total,requiredPrepayment,remainingAmount,updatedAt) VALUES('legacy','LEGACY','buyer','legacy-migration-key','Synthetic','1234567','Fixture','Fixture',101,101,51,50,1);
INSERT INTO Payment(id,orderId,type,expectedAmount,idempotencyKey,proofStorageKey,proofMimeType,updatedAt) VALUES('legacy-payment','legacy','PREPAYMENT',51,'legacy-payment-key','payment-proofs/legacy.png','image/png',1)`);
        const names = [
            "CheckoutPayment",
            "CheckoutPaymentLedger",
            "CheckoutOrder",
            "CheckoutOrderItem",
            "MediaObject",
            "MediaChunk",
            "Order",
            "Payment",
          ],
          before = new Map(
            names.map((table) => [
              table,
              f.sqlite
                .prepare(
                  `SELECT * FROM "${table}" ORDER BY ${table === "MediaObject" ? "key" : table === "MediaChunk" ? "objectKey,ordinal" : "id"}`,
                )
                .all()
                .map((row) => ({ ...row })),
            ]),
          );
        const statements = migration().map((sql) => f.db.prepare(sql));
        if (rollback) {
          await assert.rejects(
            f.db.batch([
              ...statements,
              f.db.prepare(
                "SELECT * FROM deliberately_missing_migration_table",
              ),
            ]),
          );
        } else await f.db.batch(statements);
        for (const name of names) {
          const after = f.sqlite
            .prepare(
              `SELECT * FROM "${name}" ORDER BY ${name === "MediaObject" ? "key" : name === "MediaChunk" ? "objectKey,ordinal" : "id"}`,
            )
            .all()
            .map((row) => {
              const copy = { ...row };
              delete copy.invoiceId;
              return copy;
            });
          assert.deepEqual(after, before.get(name));
        }
        assert.deepEqual(
          f.sqlite.prepare("PRAGMA foreign_key_check").all(),
          [],
        );
        assert.equal(
          (
            f.sqlite
              .prepare(
                "SELECT COUNT(*) n FROM sqlite_master WHERE name LIKE '_C2%'",
              )
              .get() as { n: number }
          ).n,
          0,
        );
        if (!rollback) {
          const replay = await f.payments.review(
            paid.owner,
            paid.payment.payment.id,
            paid.reviewKey,
            paid.review,
          );
          assert.equal(replay.finance.goodsPaid, 51);
          assert.equal(count(f, "CheckoutPaymentLedger"), 1);
          assert.deepEqual(
            (await f.payments.proof(paid.auth, pending.payment.payment.id))
              .data,
            png,
          );
          const s = await f.preorder.arrive(
            paid.owner,
            paid.order.id,
            randomUUID(),
            arrival(paid),
          );
          assert.equal(s.finance.arrivalId, s.arrival!.id);
        } else
          assert.equal(
            (
              f.sqlite
                .prepare(
                  "SELECT COUNT(*) n FROM sqlite_master WHERE name='CheckoutFinalInvoice'",
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

test("actual D1 populated migration, full final process, rollback, private proof and closed public/Admin routes", async () => {
  const f = await marketingRuntime("1", "0022");
  try {
    await f.db.exec(seed);
    const buyer = await runtimeUser(f, 900141),
      tokens = new JwtTokenService(randomBytes(32).toString("hex")),
      authority = new VoyeyOwnerAuthority(tokens, () => "900143"),
      payments = new LinkedCheckoutPayments(authority, true, card),
      preorder = new PreorderFinance(authority, true),
      auth = "Bearer " + (await tokens.issue("buyer")),
      owner = "Bearer " + (await tokens.issue("owner"));
    const result = await withDatabase(f.db as unknown as Database, async () => {
      const g = await group(),
        o = g.orders[0]!,
        first = await payments.submit(
          auth,
          o.id,
          randomUUID(),
          { declaredAmount: 51 },
          proof(),
        );
      await payments.review(
        owner,
        first.payment.id,
        randomUUID(),
        decision(51),
      );
      const stored = await f.db
        .prepare("SELECT * FROM CheckoutPaymentLedger")
        .all();
      await assert.rejects(
        f.db.batch([
          ...migration().map((sql) => f.db.prepare(sql)),
          f.db.prepare("SELECT * FROM missing_c2_migration"),
        ]),
      );
      assert.deepEqual(
        (await f.db.prepare("SELECT * FROM CheckoutPaymentLedger").all())
          .results,
        stored.results,
      );
      await f.db.batch(migration().map((sql) => f.db.prepare(sql)));
      assert.equal(
        (await f.db
          .prepare("SELECT COUNT(*) n FROM CheckoutPaymentLedger")
          .first<{ n: number }>())!.n,
        1,
      );
      await preorder.arrive(owner, o.id, randomUUID(), {
        arrivedAt: new Date().toISOString(),
        items: o.items.map((i) => ({ itemId: i.id, quantity: i.quantity })),
      });
      await preorder.assignCargo(owner, o.id, randomUUID(), { amount: 17 });
      await f.db
        .prepare(
          "CREATE TRIGGER fail_d1_invoice BEFORE INSERT ON AuditLog WHEN NEW.action='preorder.final-invoiced' BEGIN SELECT RAISE(ABORT,'injected invoice audit failure'); END",
        )
        .run();
      const invoiceKey = randomUUID();
      await assert.rejects(
        preorder.issueInvoice(owner, o.id, invoiceKey),
        /injected/,
      );
      assert.equal(
        (await f.db
          .prepare("SELECT COUNT(*) n FROM CheckoutFinalInvoice")
          .first<{ n: number }>())!.n,
        0,
      );
      await f.db.prepare("DROP TRIGGER fail_d1_invoice").run();
      await preorder.issueInvoice(owner, o.id, invoiceKey);
      const p = await payments.submitFinal(
        auth,
        o.id,
        randomUUID(),
        { declaredAmount: 67 },
        proof(),
      );
      assert.deepEqual((await payments.proof(auth, p.payment.id)).data, png);
      const key = randomUUID(),
        d = decision(67),
        paid = await payments.review(owner, p.payment.id, key, d);
      assert.equal(paid.finance.goodsPaid, 101);
      assert.equal(paid.finance.cargoPaid, 17);
      assert.equal(paid.finance.financiallySettled, 1);
      assert.deepEqual(
        await payments.review(owner, p.payment.id, key, d),
        paid,
      );
      return { payment: p.payment, order: o };
    });
    const file = await f.db
      .prepare("SELECT proofStorageKey FROM CheckoutPayment WHERE id=?")
      .bind(result.payment.id)
      .first<{ proofStorageKey: string }>();
    assert.equal(
      (
        await f.mf.dispatchFetch(
          "https://preview.invalid/media/" + file!.proofStorageKey,
        )
      ).status,
      404,
    );
    for (const path of [
      "/checkout/groups/commit",
      "/checkout/final-payment",
      "/admin/preorders/arrive",
      "/admin/preorders/cargo",
      "/admin/preorders/final-invoice",
    ]) {
      const response = await f.call(
        path,
        "POST",
        { amount: 17, role: "OWNER" },
        path.startsWith("/admin")
          ? f.signed
          : { authorization: "Bearer " + buyer.token },
        path.startsWith("/admin")
          ? "https://admin.preview.invalid"
          : "https://preview.invalid",
      );
      assert.ok(
        [403, 404].includes(response.status),
        `${path}: ${response.status}`,
      );
    }
    assert.equal(
      (await f.admin(`/payments/${result.payment.id}/approve`, "POST", {}))
        .status,
      404,
    );
    assert.equal(
      (
        await f.call(
          `/orders/${result.order.publicId}/payment`,
          "GET",
          undefined,
          { authorization: "Bearer " + buyer.token },
          "https://preview.invalid",
        )
      ).status,
      404,
    );
    assert.equal(f.outboundCalls(), 0);
  } finally {
    await f.mf.dispose();
  }
});
