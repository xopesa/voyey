import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { withDatabase, type Database } from "@stenzo/database";
import { isolatedD1 } from "./helpers/sqlite.js";
import { marketingRuntime } from "./helpers/marketing-runtime.js";
import { runtimeUser } from "./helpers/customer-operations.js";
import { png } from "../../api/tests/fixtures/images.js";
import {
  D1CartRepository,
  D1PaymentRepository,
} from "../../api/src/d1/repositories.js";
import { D1MediaBucket } from "../../api/src/d1/media.js";
import { LinkedCheckoutCommit } from "../../api/src/modules/checkout/group-commit.js";
import { readCheckoutGroup } from "../../api/src/modules/checkout/group-store.js";
import { LinkedCheckoutPayments } from "../../api/src/modules/checkout/linked-payments.js";
import { VoyeyOwnerAuthority } from "../../api/src/modules/admin/owner.js";
import { JwtTokenService } from "../../api/src/modules/auth/token.js";
import { PromoCodeService } from "../../api/src/modules/marketing/promo-codes.js";
import { WEB_ADMIN_ACTOR } from "../../api/src/modules/admin/web-session.js";

const seed = `INSERT INTO User(id,telegramId,updatedAt) VALUES('buyer',900121,1),('other',900122,1),('owner',900123,1),('employee',900124,1);
INSERT INTO TelegramAdmin(id,telegramId,isActive,createdBy,createdAt,updatedAt) VALUES('owner-admin','900123',1,'fixture',1,1),('staff-admin','900124',1,'fixture',1,1);
INSERT INTO Category(id,nameRu,nameUz,slug,requiresBuyerMeasurements,updatedAt) VALUES('c','Fixture','Fixture','c',0,1);
INSERT INTO Product(id,categoryId,nameRu,nameUz,slug,price,status,updatedAt) VALUES('p','c','Fixture','Fixture','p',101,'ACTIVE',1);
INSERT INTO ProductVariant(id,productId,sku,size,stock,preorderEnabled,updatedAt) VALUES('v','p','FIXTURE','',5,1,1);`;
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
const approve = (
  confirmedAmount: number,
  bankOperationReference: string = randomUUID(),
) => ({ decision: "APPROVE", confirmedAmount, bankOperationReference });
function fixture() {
  const f = isolatedD1();
  f.sqlite.exec(seed);
  const tokens = new JwtTokenService(randomBytes(32).toString("hex"));
  const config = { owner: "900123" };
  const authority = new VoyeyOwnerAuthority(tokens, () => config.owner);
  return {
    ...f,
    tokens,
    config,
    authority,
    payments: new LinkedCheckoutPayments(authority, true, card),
    auth: async (id = "buyer") => "Bearer " + (await tokens.issue(id)),
  };
}
type Fixture = ReturnType<typeof fixture>;
const count = (f: Fixture, table: string) =>
  (f.sqlite.prepare(`SELECT COUNT(*) n FROM "${table}"`).get() as { n: number })
    .n;
async function order(
  modes: ("IN_STOCK" | "PREORDER")[] = ["IN_STOCK"],
  percent: 50 | 100 = 50,
  promoCode?: string,
) {
  const cart = new D1CartRepository();
  for (const saleMode of modes)
    await cart.addItem("buyer", {
      productId: "p",
      variantId: "v",
      quantity: 1,
      heightCm: null,
      weightKg: null,
      saleMode,
    });
  return new LinkedCheckoutCommit(true).create("buyer", randomUUID(), {
    recipient,
    ...(modes.includes("PREORDER") ? { preorderPercent: percent } : {}),
    ...(promoCode ? { promoCode } : {}),
  });
}
async function submitted(
  f: Fixture,
  mode: "IN_STOCK" | "PREORDER" = "IN_STOCK",
  percent: 50 | 100 = 50,
) {
  const group = await order([mode], percent),
    o = group.orders[0]!,
    authorization = await f.auth();
  const claim = await f.payments.submit(
    authorization,
    o.id,
    randomUUID(),
    { declaredAmount: o.firstPaymentAmount },
    proof(),
  );
  return {
    group,
    order: o,
    claim,
    authorization,
    owner: await f.auth("owner"),
  };
}

for (const [mode, percent, first, remainder] of [
  ["IN_STOCK", 100, 101, 0],
  ["PREORDER", 50, 51, 50],
  ["PREORDER", 100, 101, 0],
] as const)
  test(`${mode} ${percent}% first payment: private proof, claim is not money; exactly-once ledger and current projection`, async () => {
    const f = fixture();
    try {
      await f.run(async () => {
        const s = await submitted(f, mode, percent);
        const initial = s.claim.finance;
        assert.equal(initial.goodsPaid, 0);
        assert.equal(initial.unpaidGoods, 101);
        assert.equal(initial.firstPaymentDue, first);
        assert.equal(initial.firstPaymentState, "PENDING_REVIEW");
        assert.equal(initial.goodsPaymentState, "UNPAID");
        assert.equal(count(f, "CheckoutPaymentLedger"), 0);
        assert.equal(count(f, "MediaObject"), 1);
        assert.equal(count(f, "MediaChunk"), 1);
        assert.equal(
          (await f.payments.instructions(s.authorization, s.order.id)).amount,
          first,
        );
        assert.equal(
          (
            await f.payments.proof(s.authorization, s.claim.payment.id)
          ).data.equals(png),
          true,
        );
        const key = randomUUID(),
          decision = approve(first);
        const result = await f.payments.review(
          s.owner,
          s.claim.payment.id,
          key,
          decision,
        );
        assert.equal(result.payment.status, "APPROVED");
        assert.equal(result.payment.confirmedAmount, first);
        assert.equal(result.finance.goodsPaid, first);
        assert.equal(result.finance.unpaidGoods, remainder);
        assert.equal(result.finance.firstPaymentDue, 0);
        assert.equal(result.finance.firstPaymentState, "CONFIRMED");
        assert.equal(
          result.finance.goodsPaymentState,
          remainder ? "PARTIALLY_PAID" : "PAID",
        );
        assert.equal(result.finance.cargoAmount, null);
        assert.equal(result.finance.cargoPaid, 0);
        assert.equal(result.finance.fulfillmentAllowed, 0);
        assert.equal(result.finance.finalPaymentEnabled, 0);
        assert.deepEqual(
          await f.payments.review(s.owner, s.claim.payment.id, key, decision),
          result,
        );
        assert.equal(count(f, "CheckoutPaymentLedger"), 1);
        const legacyInsert = f.sqlite.prepare(
          "INSERT INTO Payment(id,orderId,type,expectedAmount,idempotencyKey,proofStorageKey,proofMimeType,updatedAt) VALUES(?,'not-a-legacy-order','PREPAYMENT',101,?,?,'image/png',1)",
        );
        const privateKey = (
          f.sqlite
            .prepare("SELECT proofStorageKey FROM CheckoutPayment WHERE id=?")
            .get(s.claim.payment.id) as { proofStorageKey: string }
        ).proofStorageKey;
        assert.throws(
          () =>
            legacyInsert.run(
              s.claim.payment.id,
              randomUUID(),
              "payment-proofs/other.png",
            ),
          /linked receipt isolated/,
        );
        assert.throws(
          () => legacyInsert.run(randomUUID(), randomUUID(), privateKey),
          /linked receipt isolated/,
        );
        assert.equal(count(f, "Payment"), 0);
        assert.equal(
          (
            f.sqlite
              .prepare(
                "SELECT COUNT(*) n FROM AuditLog WHERE action='linked-payment.approved'",
              )
              .get() as { n: number }
          ).n,
          1,
        );
        const current = await readCheckoutGroup("buyer", s.group.id);
        assert.equal(current.orders[0]!.goodsPaid, first);
        assert.equal(current.orders[0]!.unpaidGoods, remainder);
        assert.deepEqual(
          current.orders[0]!.financialPolicy,
          s.order.financialPolicy,
        );
        assert.equal(current.orders[0]!.state, "PAYMENTS_BLOCKED");
        // 0021 contract is immutable; only the dedicated ledger projection represents received money.
        assert.equal(
          (
            f.sqlite
              .prepare("SELECT goodsPaid FROM CheckoutOrder WHERE id=?")
              .get(s.order.id) as { goodsPaid: number }
          ).goodsPaid,
          0,
        );
        await assert.rejects(
          f.payments.instructions(s.authorization, s.order.id),
          /already confirmed/,
        );
        await assert.rejects(
          f.payments.submit(
            s.authorization,
            s.order.id,
            randomUUID(),
            { declaredAmount: first },
            proof(),
          ),
          /already confirmed/,
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

test("claim amount and catalog edits cannot alter saved price, discount, obligation or approval amount", async () => {
  const f = fixture();
  try {
    await f.run(async () => {
      await new PromoCodeService().save(WEB_ADMIN_ACTOR, {
        code: "PAYONCE",
        type: "FIXED",
        value: 3,
        isActive: true,
      });
      const group = await order(["IN_STOCK", "PREORDER"], 50, "PAYONCE");
      const o = group.orders[0]!,
        authorization = await f.auth();
      f.sqlite.exec(
        "UPDATE Product SET price=9999 WHERE id='p'; UPDATE PromoCode SET value=50 WHERE code='PAYONCE'",
      );
      const s = await f.payments.submit(
        authorization,
        o.id,
        randomUUID(),
        { declaredAmount: 999 },
        proof(),
      );
      assert.equal(s.payment.declaredAmount, 999);
      assert.equal(s.payment.expectedAmount, 99);
      assert.equal(s.finance.goodsTotal, 99);
      await assert.rejects(
        f.payments.review(
          await f.auth("owner"),
          s.payment.id,
          randomUUID(),
          approve(999),
        ),
        /exactly/,
      );
      const result = await f.payments.review(
        await f.auth("owner"),
        s.payment.id,
        randomUUID(),
        approve(99),
      );
      assert.equal(result.finance.goodsPaid, 99);
      assert.equal(result.finance.unpaidGoods, 0);
      const after = await readCheckoutGroup("buyer", group.id);
      assert.equal(after.discountAmount, 3);
      assert.deepEqual(
        after.orders.map((o) => o.discountAmount),
        [2, 1],
      );
      assert.equal(after.orders[1]!.goodsPaid, 0);
      assert.equal(after.orders[1]!.unpaidGoods, 100);
      assert.equal(count(f, "CheckoutPromoUse"), 1);
      assert.equal(count(f, "PromoCodeRedemption"), 0);
    });
  } finally {
    f.sqlite.close();
  }
});

test("rejection records no money, is idempotent and allows a new receipt attempt", async () => {
  const f = fixture();
  try {
    await f.run(async () => {
      const s = await submitted(f),
        key = randomUUID(),
        decision = { decision: "REJECT", reason: "NOT_RECEIVED" };
      const result = await f.payments.review(
        s.owner,
        s.claim.payment.id,
        key,
        decision,
      );
      assert.equal(result.payment.status, "REJECTED");
      assert.equal(result.finance.goodsPaid, 0);
      assert.equal(result.finance.unpaidGoods, 101);
      assert.equal(result.finance.firstPaymentState, "REJECTED");
      assert.equal(count(f, "CheckoutPaymentLedger"), 0);
      assert.deepEqual(
        await f.payments.review(s.owner, s.claim.payment.id, key, decision),
        result,
      );
      await assert.rejects(
        f.payments.review(
          s.owner,
          s.claim.payment.id,
          randomUUID(),
          approve(101),
        ),
        /replay/,
      );
      const next = await f.payments.submit(
        s.authorization,
        s.order.id,
        randomUUID(),
        { declaredAmount: 101 },
        proof(),
      );
      assert.equal(next.finance.firstPaymentState, "PENDING_REVIEW");
      const paid = await f.payments.review(
        s.owner,
        next.payment.id,
        randomUUID(),
        approve(101),
      );
      assert.equal(paid.finance.goodsPaid, 101);
      assert.equal(count(f, "CheckoutPayment"), 2);
      assert.equal(count(f, "CheckoutPaymentLedger"), 1);
    });
  } finally {
    f.sqlite.close();
  }
});

test("submission replay, concurrent replay and key conflicts never duplicate a private file", async () => {
  const f = fixture();
  try {
    await f.run(async () => {
      const group = await order(),
        o = group.orders[0]!,
        auth = await f.auth(),
        key = randomUUID();
      const results = await Promise.all([
        f.payments.submit(auth, o.id, key, { declaredAmount: 101 }, proof()),
        f.payments.submit(auth, o.id, key, { declaredAmount: 101 }, proof()),
      ]);
      assert.deepEqual(results[0], results[1]);
      assert.equal(count(f, "CheckoutPayment"), 1);
      assert.equal(count(f, "MediaObject"), 1);
      await assert.rejects(
        f.payments.submit(auth, o.id, key, { declaredAmount: 100 }, proof()),
        /key reuse/,
      );
      await assert.rejects(
        f.payments.submit(
          auth,
          o.id,
          randomUUID(),
          { declaredAmount: 101 },
          proof(),
        ),
        /pending/,
      );
      const other = (await order(["PREORDER"])).orders[0]!;
      await assert.rejects(
        f.payments.submit(
          auth,
          other.id,
          key,
          { declaredAmount: 101 },
          proof(),
        ),
        /key reuse/,
      );
      assert.equal(count(f, "MediaObject"), 1);
      assert.equal(count(f, "MediaChunk"), 1);
    });
  } finally {
    f.sqlite.close();
  }
});

test("two concurrent different submission keys admit one pending proof and no orphan", async () => {
  const f = fixture();
  try {
    await f.run(async () => {
      const o = (await order()).orders[0]!,
        auth = await f.auth();
      const results = await Promise.allSettled(
        [1, 2].map(() =>
          f.payments.submit(
            auth,
            o.id,
            randomUUID(),
            { declaredAmount: 101 },
            proof(),
          ),
        ),
      );
      assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
      assert.equal(count(f, "CheckoutPayment"), 1);
      assert.equal(count(f, "MediaObject"), 1);
    });
  } finally {
    f.sqlite.close();
  }
});

for (const fail of [
  "CREATE TRIGGER fail_proof BEFORE INSERT ON MediaChunk BEGIN SELECT RAISE(ABORT,'injected proof failure'); END;",
  "CREATE TRIGGER fail_claim BEFORE INSERT ON CheckoutPayment BEGIN SELECT RAISE(ABORT,'injected claim failure'); END;",
  "CREATE TRIGGER fail_submit_audit BEFORE INSERT ON AuditLog WHEN NEW.action='linked-payment.submitted' BEGIN SELECT RAISE(ABORT,'injected submit audit failure'); END;",
])
  test(`receipt and metadata rollback together: ${fail.split(" ")[2]}`, async () => {
    const f = fixture();
    try {
      await f.run(async () => {
        const o = (await order()).orders[0]!,
          auth = await f.auth(),
          key = randomUUID(),
          audits = count(f, "AuditLog");
        f.sqlite.exec(fail);
        await assert.rejects(
          f.payments.submit(auth, o.id, key, { declaredAmount: 101 }, proof()),
          /injected/,
        );
        for (const table of [
          "CheckoutPayment",
          "CheckoutPaymentLedger",
          "MediaObject",
          "MediaChunk",
          "_BatchGuard",
        ])
          assert.equal(count(f, table), 0);
        assert.equal(count(f, "AuditLog"), audits);
        f.sqlite.exec(`DROP TRIGGER ${fail.split(" ")[2]}`);
        assert.equal(
          (
            await f.payments.submit(
              auth,
              o.id,
              key,
              { declaredAmount: 101 },
              proof(),
            )
          ).payment.status,
          "SUBMITTED",
        );
      });
    } finally {
      f.sqlite.close();
    }
  });

for (const fail of [
  "CREATE TRIGGER fail_ledger BEFORE INSERT ON CheckoutPaymentLedger BEGIN SELECT RAISE(ABORT,'injected ledger failure'); END;",
  "CREATE TRIGGER fail_decision BEFORE UPDATE ON CheckoutPayment BEGIN SELECT RAISE(ABORT,'injected decision failure'); END;",
  "CREATE TRIGGER fail_approval_audit BEFORE INSERT ON AuditLog WHEN NEW.action='linked-payment.approved' BEGIN SELECT RAISE(ABORT,'injected approve audit failure'); END;",
])
  test(`approval, ledger, financial state and audit rollback together: ${fail.split(" ")[2]}`, async () => {
    const f = fixture();
    try {
      await f.run(async () => {
        const s = await submitted(f),
          audits = count(f, "AuditLog"),
          key = randomUUID(),
          decision = approve(101);
        f.sqlite.exec(fail);
        await assert.rejects(
          f.payments.review(s.owner, s.claim.payment.id, key, decision),
          /injected/,
        );
        assert.equal(count(f, "CheckoutPaymentLedger"), 0);
        assert.equal(count(f, "AuditLog"), audits);
        assert.equal(
          (await f.payments.state(s.authorization, s.order.id)).goodsPaid,
          0,
        );
        assert.equal(
          (
            f.sqlite.prepare("SELECT status FROM CheckoutPayment").get() as {
              status: string;
            }
          ).status,
          "SUBMITTED",
        );
        f.sqlite.exec(`DROP TRIGGER ${fail.split(" ")[2]}`);
        assert.equal(
          (await f.payments.review(s.owner, s.claim.payment.id, key, decision))
            .finance.goodsPaid,
          101,
        );
      });
    } finally {
      f.sqlite.close();
    }
  });

test("concurrent same payment approvals with same key credit once", async () => {
  const f = fixture();
  try {
    await f.run(async () => {
      const s = await submitted(f),
        key = randomUUID(),
        decision = approve(101);
      const results = await Promise.all([
        f.payments.review(s.owner, s.claim.payment.id, key, decision),
        f.payments.review(s.owner, s.claim.payment.id, key, decision),
      ]);
      assert.deepEqual(results[0], results[1]);
      assert.equal(count(f, "CheckoutPaymentLedger"), 1);
      assert.equal(results[0]!.finance.goodsPaid, 101);
    });
  } finally {
    f.sqlite.close();
  }
});

test("concurrent approve/reject resolves one immutable decision without partial ledger", async () => {
  const f = fixture();
  try {
    await f.run(async () => {
      const s = await submitted(f);
      const results = await Promise.allSettled([
        f.payments.review(
          s.owner,
          s.claim.payment.id,
          randomUUID(),
          approve(101),
        ),
        f.payments.review(s.owner, s.claim.payment.id, randomUUID(), {
          decision: "REJECT",
          reason: "NOT_RECEIVED",
        }),
      ]);
      assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
      const state = await f.payments.state(s.authorization, s.order.id);
      assert.ok([0, 101].includes(state.goodsPaid));
      assert.equal(count(f, "CheckoutPaymentLedger"), state.goodsPaid ? 1 : 0);
      assert.equal(state.unpaidGoods + state.goodsPaid, 101);
    });
  } finally {
    f.sqlite.close();
  }
});

test("bank reference uniqueness prevents crediting a forwarded/reuploaded proof to another order", async () => {
  const f = fixture();
  try {
    await f.run(async () => {
      const group = await order(["IN_STOCK", "PREORDER"], 100),
        auth = await f.auth(),
        owner = await f.auth("owner");
      const a = await f.payments.submit(
        auth,
        group.orders[0]!.id,
        randomUUID(),
        { declaredAmount: 101 },
        proof(),
      );
      const b = await f.payments.submit(
        auth,
        group.orders[1]!.id,
        randomUUID(),
        { declaredAmount: 101 },
        proof(),
      );
      const bank = "LOCAL-BANK-TXN-" + randomUUID();
      await f.payments.review(
        owner,
        a.payment.id,
        randomUUID(),
        approve(101, bank),
      );
      await assert.rejects(
        f.payments.review(
          owner,
          b.payment.id,
          randomUUID(),
          approve(101, bank.replaceAll("-", "").toLowerCase()),
        ),
        /already credited/,
      );
      assert.equal(
        (await f.payments.state(auth, group.orders[1]!.id)).goodsPaid,
        0,
      );
      assert.equal(count(f, "CheckoutPaymentLedger"), 1);
      const duplicate = {
        ...f.sqlite.prepare("SELECT * FROM CheckoutPaymentLedger").get(),
        id: randomUUID(),
        paymentId: b.payment.id,
        orderId: b.payment.orderId,
        reviewKey: randomUUID(),
        verifiedAt: Date.now(),
      };
      const duplicateKeys = Object.keys(duplicate);
      assert.throws(
        () =>
          f.sqlite
            .prepare(
              `INSERT INTO CheckoutPaymentLedger(${duplicateKeys.join(",")}) VALUES(${duplicateKeys.map(() => "?").join(",")})`,
            )
            .run(...(Object.values(duplicate) as never[])),
        /UNIQUE/,
      );
      // An independently verified transaction, not the image alone, is needed for the second credit.
      await f.payments.review(owner, b.payment.id, randomUUID(), approve(101));
      assert.equal(count(f, "CheckoutPaymentLedger"), 2);
      assert.equal(
        (await f.payments.state(auth, group.orders[1]!.id)).goodsPaid,
        101,
      );
      const audit = JSON.stringify(
        f.sqlite.prepare("SELECT * FROM AuditLog").all(),
      );
      assert.ok(!audit.includes(bank));
      assert.ok(!audit.includes(owner.slice(7)));
      assert.ok(!JSON.stringify(a).includes("proofStorageKey"));
      assert.ok(!JSON.stringify(a).includes("bankOperationDigest"));
    });
  } finally {
    f.sqlite.close();
  }
});

test("concurrent bank operation reused across orders has a single winner", async () => {
  const f = fixture();
  try {
    await f.run(async () => {
      const group = await order(["IN_STOCK", "PREORDER"], 100),
        auth = await f.auth(),
        owner = await f.auth("owner");
      const receipts = [];
      for (const o of group.orders)
        receipts.push(
          await f.payments.submit(
            auth,
            o.id,
            randomUUID(),
            { declaredAmount: 101 },
            proof(),
          ),
        );
      const decision = approve(101);
      const results = await Promise.allSettled(
        receipts.map((r) =>
          f.payments.review(owner, r.payment.id, randomUUID(), decision),
        ),
      );
      assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
      assert.equal(count(f, "CheckoutPaymentLedger"), 1);
      const after = await readCheckoutGroup("buyer", group.id);
      assert.equal(
        after.orders.reduce((s, o) => s + o.goodsPaid, 0),
        101,
      );
    });
  } finally {
    f.sqlite.close();
  }
});

test("owner missing, staff, customer, anonymous, invalid JWT, inactive owner all denied and audited", async () => {
  const f = fixture();
  try {
    await f.run(async () => {
      const s = await submitted(f);
      for (const auth of [
        await f.auth("employee"),
        s.authorization,
        undefined,
        "Bearer invalid",
        WEB_ADMIN_ACTOR,
      ])
        await assert.rejects(
          f.payments.review(
            auth,
            s.claim.payment.id,
            randomUUID(),
            approve(101),
          ),
          { statusCode: 403 },
        );
      f.config.owner = "";
      await assert.rejects(
        f.payments.review(
          s.owner,
          s.claim.payment.id,
          randomUUID(),
          approve(101),
        ),
        { statusCode: 503 },
      );
      f.config.owner = "900123";
      f.sqlite.exec(
        "UPDATE TelegramAdmin SET isActive=0 WHERE id='owner-admin'",
      );
      await assert.rejects(
        f.payments.review(
          s.owner,
          s.claim.payment.id,
          randomUUID(),
          approve(101),
        ),
        { statusCode: 403 },
      );
      f.sqlite.exec(
        "UPDATE TelegramAdmin SET isActive=1 WHERE id='owner-admin'; UPDATE User SET status='BLOCKED' WHERE id='owner'",
      );
      await assert.rejects(
        f.payments.review(
          s.owner,
          s.claim.payment.id,
          randomUUID(),
          approve(101),
        ),
        { statusCode: 403 },
      );
      assert.equal(count(f, "CheckoutPaymentLedger"), 0);
      assert.equal(
        (await f.payments.state(s.authorization, s.order.id)).goodsPaid,
        0,
      );
      const denied = (
        f.sqlite
          .prepare(
            "SELECT COUNT(*) n FROM AuditLog WHERE action='owner.denied'",
          )
          .get() as { n: number }
      ).n;
      assert.equal(denied, 8);
    });
  } finally {
    f.sqlite.close();
  }
});

for (const revoke of [
  "UPDATE TelegramAdmin SET isActive=0 WHERE id='owner-admin'",
  "UPDATE User SET status='BLOCKED' WHERE id='owner'",
])
  test(`owner revocation between authorization read and D1 commit is caught by CAS: ${revoke}`, async () => {
    const f = fixture();
    try {
      await f.run(async () => {
        const s = await submitted(f);
        let revoked = false;
        const wrapped: Database = {
          prepare: (sql) => f.db.prepare(sql),
          batch: async (statements) => {
            if (
              !revoked &&
              statements.some((statement) =>
                String((statement as unknown as { sql: string }).sql).includes(
                  "INSERT INTO CheckoutPaymentLedger",
                ),
              )
            ) {
              revoked = true;
              f.sqlite.exec(revoke);
            }
            return f.db.batch(statements);
          },
        };
        await assert.rejects(
          withDatabase(wrapped, () =>
            f.payments.review(
              s.owner,
              s.claim.payment.id,
              randomUUID(),
              approve(101),
            ),
          ),
          { statusCode: 403 },
        );
        assert.ok(revoked);
        assert.equal(count(f, "CheckoutPaymentLedger"), 0);
        assert.equal(
          (await f.payments.state(s.authorization, s.order.id)).goodsPaid,
          0,
        );
        assert.equal(
          (
            f.sqlite
              .prepare(
                "SELECT COUNT(*) n FROM AuditLog WHERE action='linked-payment.approved'",
              )
              .get() as { n: number }
          ).n,
          0,
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

test("proof and finance ownership: customer sees own bytes, owner may review; other buyer/staff cannot", async () => {
  const f = fixture();
  try {
    await f.run(async () => {
      const s = await submitted(f);
      await assert.rejects(
        f.payments.state(await f.auth("other"), s.order.id),
        { statusCode: 404 },
      );
      await assert.rejects(
        f.payments.submit(
          await f.auth("other"),
          s.order.id,
          randomUUID(),
          { declaredAmount: 101 },
          proof(),
        ),
        { statusCode: 404 },
      );
      for (const id of ["other", "employee"])
        await assert.rejects(
          f.payments.proof(await f.auth(id), s.claim.payment.id),
          { statusCode: 403 },
        );
      await assert.rejects(f.payments.proof(undefined, s.claim.payment.id), {
        statusCode: 401,
      });
      assert.deepEqual(
        (await f.payments.proof(s.owner, s.claim.payment.id)).data,
        png,
      );
      assert.equal(
        (await f.payments.reviewState(s.owner, s.claim.payment.id)).payment
          .expectedAmount,
        101,
      );
      await assert.rejects(
        f.payments.reviewState(await f.auth("employee"), s.claim.payment.id),
        { statusCode: 403 },
      );
      const row = f.sqlite
        .prepare("SELECT proofStorageKey FROM CheckoutPayment")
        .get() as { proofStorageKey: string };
      await assert.rejects(new D1MediaBucket(false).get(row.proofStorageKey));
      for (const sql of [
        "UPDATE MediaObject SET private=0",
        "DELETE FROM MediaObject",
        "DELETE FROM MediaChunk",
        "UPDATE MediaChunk SET ordinal=1",
      ])
        assert.throws(() => f.sqlite.exec(sql), /immutable/);
    });
  } finally {
    f.sqlite.close();
  }
});

test("invalid files, amounts, client approval/role/source fields and unsafe lifecycle actions fail closed", async () => {
  const f = fixture();
  try {
    await f.run(async () => {
      const o = (await order()).orders[0]!,
        auth = await f.auth();
      for (const bad of [
        { data: Buffer.alloc(0), declaredMimeType: "image/png" },
        { data: Buffer.from("<svg></svg>"), declaredMimeType: "image/svg+xml" },
        { data: Buffer.from(png), declaredMimeType: "image/jpeg" },
        {
          data: Buffer.from(png.subarray(0, 20)),
          declaredMimeType: "image/png",
        },
        {
          data: Buffer.alloc(5 * 1024 * 1024 + 1),
          declaredMimeType: "image/png",
        },
      ])
        await assert.rejects(
          f.payments.submit(
            auth,
            o.id,
            randomUUID(),
            { declaredAmount: 101 },
            bad,
          ),
        );
      for (const claim of [
        { declaredAmount: 0 },
        { declaredAmount: -1 },
        { declaredAmount: 1.5 },
        { declaredAmount: 2147483648 },
        { declaredAmount: 101, status: "APPROVED" },
        { declaredAmount: 101, source: "TELEGRAM_OPERATOR" },
        { declaredAmount: 101, role: "OWNER" },
        { declaredAmount: 101, cargoAmount: 1 },
      ])
        await assert.rejects(
          f.payments.submit(auth, o.id, randomUUID(), claim, proof()),
          { statusCode: 400 },
        );
      assert.equal(count(f, "MediaObject"), 0);
      assert.equal(count(f, "CheckoutPayment"), 0);
      const s = await f.payments.submit(
          auth,
          o.id,
          randomUUID(),
          { declaredAmount: 101 },
          proof(),
        ),
        owner = await f.auth("owner");
      for (const value of [
        approve(102),
        approve(100),
        approve(0),
        approve(-1),
        approve(1.5),
        approve(2147483648),
        { ...approve(101), cargoAmount: 1 },
        { ...approve(101), role: "OWNER" },
        { decision: "APPROVE", confirmedAmount: 101 },
        { ...approve(101), phase: "FINAL" },
      ])
        await assert.rejects(
          f.payments.review(owner, s.payment.id, randomUUID(), value),
        );
      assert.equal(count(f, "CheckoutPaymentLedger"), 0);
      assert.throws(() => f.payments.attachTelegramProof(), {
        statusCode: 503,
      });
      for (const sql of [
        "UPDATE CheckoutOrder SET cargoAmount=17",
        "UPDATE CheckoutOrder SET state='COMPLETED'",
        "DELETE FROM CheckoutOrder",
        "UPDATE CheckoutPromoUse SET releasedAt=1",
      ])
        if (!sql.includes("CheckoutPromoUse"))
          assert.throws(() => f.sqlite.exec(sql));
    });
  } finally {
    f.sqlite.close();
  }
});

test("SQL cannot approve without ledger, alter settled money/history, or record future CARGO/final phase", async () => {
  const f = fixture();
  try {
    await f.run(async () => {
      const s = await submitted(f);
      assert.throws(
        () =>
          f.sqlite
            .prepare(
              "UPDATE CheckoutPayment SET status='APPROVED',confirmedAmount=101,reviewedBy='owner',reviewedAt=?,reviewKey=?,reviewFingerprint=?",
            )
            .run(Date.now(), randomUUID(), "a".repeat(64)),
        /ledger/,
      );
      const result = await f.payments.review(
        s.owner,
        s.claim.payment.id,
        randomUUID(),
        approve(101),
      );
      assert.equal(result.finance.goodsPaid, 101);
      for (const sql of [
        "UPDATE CheckoutPayment SET confirmedAmount=1",
        "DELETE FROM CheckoutPayment",
        "UPDATE CheckoutPaymentLedger SET goodsAmount=1",
        "DELETE FROM CheckoutPaymentLedger",
      ])
        assert.throws(() => f.sqlite.exec(sql), /immutable/);
      const ledger = f.sqlite
        .prepare("SELECT * FROM CheckoutPaymentLedger")
        .get() as Record<string, string | number>;
      for (const changes of [
        { phase: "FINAL" },
        { cargoAmount: 17 },
        { goodsAmount: 102 },
        { goodsAmount: -1 },
        { orderId: "missing" },
      ]) {
        const row = { ...ledger, id: randomUUID(), ...changes },
          keys = Object.keys(row);
        assert.throws(() =>
          f.sqlite
            .prepare(
              `INSERT INTO CheckoutPaymentLedger(${keys.join(",")}) VALUES(${keys.map(() => "?").join(",")})`,
            )
            .run(...Object.values(row)),
        );
      }
      assert.equal(count(f, "CheckoutPaymentLedger"), 1);
    });
  } finally {
    f.sqlite.close();
  }
});

test("payment service default off; no independent card config; legacy repositories cannot see new paid orders", async () => {
  const f = fixture();
  try {
    await f.run(async () => {
      const s = await submitted(f),
        disabled = new LinkedCheckoutPayments(f.authority);
      await assert.rejects(disabled.state(s.authorization, s.order.id), {
        statusCode: 503,
      });
      await assert.rejects(
        disabled.submit(
          s.authorization,
          s.order.id,
          randomUUID(),
          { declaredAmount: 101 },
          proof(),
        ),
        { statusCode: 503 },
      );
      await assert.rejects(
        disabled.review(
          s.owner,
          s.claim.payment.id,
          randomUUID(),
          approve(101),
        ),
        { statusCode: 503 },
      );
      await assert.rejects(
        disabled.proof(s.authorization, s.claim.payment.id),
        { statusCode: 503 },
      );
      await assert.rejects(
        new LinkedCheckoutPayments(f.authority, true).instructions(
          s.authorization,
          s.order.id,
        ),
        { statusCode: 503 },
      );
      await f.payments.review(
        s.owner,
        s.claim.payment.id,
        randomUUID(),
        approve(101),
      );
      assert.equal(
        await new D1PaymentRepository().getOrderForUser(
          "buyer",
          s.order.publicId,
        ),
        null,
      );
      assert.equal(count(f, "Payment"), 0);
      assert.equal(count(f, "Refund"), 0);
    });
  } finally {
    f.sqlite.close();
  }
});

test("review keys cannot move to a second payment, and revoked owner cannot replay a prior decision", async () => {
  const f = fixture();
  try {
    await f.run(async () => {
      const group = await order(["IN_STOCK", "PREORDER"], 100),
        auth = await f.auth(),
        owner = await f.auth("owner");
      const first = await f.payments.submit(
        auth,
        group.orders[0]!.id,
        randomUUID(),
        { declaredAmount: 101 },
        proof(),
      );
      const second = await f.payments.submit(
        auth,
        group.orders[1]!.id,
        randomUUID(),
        { declaredAmount: 101 },
        proof(),
      );
      const key = randomUUID(),
        decision = approve(101);
      await f.payments.review(owner, first.payment.id, key, decision);
      await assert.rejects(
        f.payments.review(owner, second.payment.id, key, approve(101)),
        /key already used/,
      );
      await assert.rejects(
        f.payments.review(owner, first.payment.id, key, approve(101)),
        /replay/,
      );
      f.sqlite.exec(
        "UPDATE TelegramAdmin SET isActive=0 WHERE id='owner-admin'",
      );
      await assert.rejects(
        f.payments.review(owner, first.payment.id, key, decision),
        { statusCode: 403 },
      );
      assert.equal(count(f, "CheckoutPaymentLedger"), 1);
      assert.equal(
        (await f.payments.state(auth, group.orders[1]!.id)).goodsPaid,
        0,
      );
    });
  } finally {
    f.sqlite.close();
  }
});

test("rejection audit failure leaves claim submitted; Telegram operator source is SQL-blocked", async () => {
  const f = fixture();
  try {
    await f.run(async () => {
      const s = await submitted(f),
        before = count(f, "AuditLog");
      f.sqlite.exec(
        "CREATE TRIGGER fail_reject_audit BEFORE INSERT ON AuditLog WHEN NEW.action='linked-payment.rejected' BEGIN SELECT RAISE(ABORT,'injected rejection audit failure'); END",
      );
      await assert.rejects(
        f.payments.review(s.owner, s.claim.payment.id, randomUUID(), {
          decision: "REJECT",
          reason: "NOT_RECEIVED",
        }),
        /injected/,
      );
      assert.equal(count(f, "AuditLog"), before);
      assert.equal(
        (await f.payments.state(s.authorization, s.order.id)).firstPaymentState,
        "PENDING_REVIEW",
      );
      const row = {
        ...f.sqlite.prepare("SELECT * FROM CheckoutPayment").get(),
        id: randomUUID(),
        source: "TELEGRAM_OPERATOR",
      };
      const keys = Object.keys(row);
      assert.throws(
        () =>
          f.sqlite
            .prepare(
              `INSERT INTO CheckoutPayment(${keys.join(",")}) VALUES(${keys.map(() => "?").join(",")})`,
            )
            .run(...(Object.values(row) as never[])),
        /first payment unavailable/,
      );
      assert.equal(count(f, "CheckoutPaymentLedger"), 0);
    });
  } finally {
    f.sqlite.close();
  }
});

test("migration 0022 preserves existing 0021 snapshots, tables, guards and initial finance", async () => {
  const f = fixture(),
    sqlite = new DatabaseSync(":memory:");
  try {
    await f.run(async () => {
      await order(["IN_STOCK", "PREORDER"], 50);
      const directory = new URL("../migrations/", import.meta.url);
      for (const file of readdirSync(directory)
        .filter((file) => file < "0022")
        .sort())
        sqlite.exec(readFileSync(new URL(file, directory), "utf8"));
      sqlite.exec(seed);
      for (const table of [
        "CheckoutGroup",
        "CheckoutOrder",
        "CheckoutOrderItem",
      ]) {
        for (const source of f.sqlite.prepare(`SELECT * FROM ${table}`).all()) {
          const row = {
            ...source,
            ...(table === "CheckoutGroup" ? { sealed: 0 } : {}),
          };
          const keys = Object.keys(row);
          sqlite
            .prepare(
              `INSERT INTO ${table}(${keys.join(",")}) VALUES(${keys.map(() => "?").join(",")})`,
            )
            .run(...(Object.values(row) as never[]));
        }
      }
      sqlite.exec("UPDATE CheckoutGroup SET sealed=1");
      const before = sqlite
        .prepare(
          "SELECT name,sql FROM sqlite_master WHERE name LIKE 'Checkout%' OR name LIKE 'Order_linked%'",
        )
        .all();
      const snapshots = sqlite
        .prepare("SELECT * FROM CheckoutOrderItem ORDER BY id")
        .all();
      sqlite.exec(
        readFileSync(
          new URL("0022_linked_checkout_payments.sql", directory),
          "utf8",
        ),
      );
      for (const entry of before as { name: string; sql: string }[])
        assert.equal(
          (
            sqlite
              .prepare("SELECT sql FROM sqlite_master WHERE name=?")
              .get(entry.name) as { sql: string }
          ).sql,
          entry.sql,
        );
      assert.deepEqual(
        sqlite.prepare("SELECT * FROM CheckoutOrderItem ORDER BY id").all(),
        snapshots,
      );
      for (const state of sqlite
        .prepare("SELECT * FROM CheckoutOrderFinance")
        .all() as {
        goodsPaid: number;
        unpaidGoods: number;
        firstPaymentState: string;
      }[]) {
        assert.equal(state.goodsPaid, 0);
        assert.equal(state.unpaidGoods, 101);
        assert.equal(state.firstPaymentState, "AWAITING_PAYMENT");
      }
      assert.deepEqual(sqlite.prepare("PRAGMA foreign_key_check").all(), []);
      assert.throws(
        () => sqlite.exec("UPDATE CheckoutOrder SET cargoAmount=17"),
        /blocked/,
      );
      assert.throws(
        () => sqlite.exec("DELETE FROM CheckoutOrderItem"),
        /immutable/,
      );
    });
  } finally {
    sqlite.close();
    f.sqlite.close();
  }
});

test("real isolated D1: atomic proof rollback, approval/replay, private URLs and no new public/Admin routes", async () => {
  const f = await marketingRuntime();
  try {
    await f.db.exec(seed);
    const buyer = await runtimeUser(f, 900121),
      tokens = new JwtTokenService(randomBytes(32).toString("hex"));
    const authority = new VoyeyOwnerAuthority(tokens, () => "900123"),
      service = new LinkedCheckoutPayments(authority, true, card);
    const auth = "Bearer " + (await tokens.issue("buyer")),
      owner = "Bearer " + (await tokens.issue("owner"));
    const saved = await withDatabase(f.db as unknown as Database, async () => {
      const o = (await order()).orders[0]!;
      await f.db
        .prepare(
          "CREATE TRIGGER fail_real BEFORE INSERT ON CheckoutPayment BEGIN SELECT RAISE(ABORT,'injected real receipt failure'); END",
        )
        .run();
      const key = randomUUID();
      await assert.rejects(
        service.submit(auth, o.id, key, { declaredAmount: 101 }, proof()),
        /injected real/,
      );
      for (const table of ["MediaObject", "MediaChunk", "CheckoutPayment"])
        assert.equal(
          (await f.db
            .prepare(`SELECT COUNT(*) n FROM ${table}`)
            .first<{ n: number }>())!.n,
          0,
        );
      await f.db.prepare("DROP TRIGGER fail_real").run();
      const submitted = await service.submit(
        auth,
        o.id,
        key,
        { declaredAmount: 101 },
        proof(),
      );
      assert.deepEqual(
        (await service.proof(auth, submitted.payment.id)).data,
        png,
      );
      await f.db
        .prepare(
          "CREATE TRIGGER fail_real_ledger BEFORE INSERT ON CheckoutPaymentLedger BEGIN SELECT RAISE(ABORT,'injected real ledger failure'); END",
        )
        .run();
      const reviewKey = randomUUID(),
        decision = approve(101);
      await assert.rejects(
        service.review(owner, submitted.payment.id, reviewKey, decision),
        /injected real/,
      );
      assert.equal((await service.state(auth, o.id)).goodsPaid, 0);
      await f.db.prepare("DROP TRIGGER fail_real_ledger").run();
      const result = await service.review(
        owner,
        submitted.payment.id,
        reviewKey,
        decision,
      );
      assert.equal(result.finance.goodsPaid, 101);
      assert.deepEqual(
        await service.review(owner, submitted.payment.id, reviewKey, decision),
        result,
      );
      return { paymentId: submitted.payment.id, order: o };
    });
    const media = await f.db
      .prepare("SELECT proofStorageKey FROM CheckoutPayment WHERE id=?")
      .bind(saved.paymentId)
      .first<{ proofStorageKey: string }>();
    const direct = await f.mf.dispatchFetch(
      "https://preview.invalid/media/" + media!.proofStorageKey,
    );
    assert.equal(direct.status, 404);
    for (const path of [
      "/checkout/commit",
      "/checkout/groups/commit",
      "/checkout/payments",
      "/admin/checkout/payments/approve",
      "/admin/linked-payments/approve",
    ]) {
      const headers: Record<string, string> = path.startsWith("/admin")
        ? f.signed
        : { authorization: "Bearer " + buyer.token };
      const response = await f.call(
        path,
        "POST",
        approve(101),
        headers,
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
      (await f.admin(`/payments/${saved.paymentId}/approve`, "POST", {}))
        .status,
      404,
    );
    assert.equal(
      (
        await f.call(
          `/orders/${saved.order.publicId}/payment`,
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
