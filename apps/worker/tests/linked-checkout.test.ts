import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { prisma, withDatabase, type Database } from "@stenzo/database";
import { isolatedD1 } from "./helpers/sqlite.js";
import { marketingRuntime } from "./helpers/marketing-runtime.js";
import { runtimeUser } from "./helpers/customer-operations.js";
import {
  D1CartRepository,
  D1OrderRepository,
  D1PaymentRepository,
} from "../../api/src/d1/repositories.js";
import { LinkedCheckoutCommit } from "../../api/src/modules/checkout/group-commit.js";
import { readCheckoutGroup } from "../../api/src/modules/checkout/group-store.js";
import { prepareOrder } from "../../api/src/modules/checkout/domain.js";
import { PromoCodeService } from "../../api/src/modules/marketing/promo-codes.js";
import { ManualOrderService } from "../../api/src/modules/admin/manual-orders.js";
import { LifecycleService } from "../../api/src/modules/admin/lifecycle.js";
import { RefundService } from "../../api/src/modules/admin/refunds.js";
import { PaymentService } from "../../api/src/modules/payments/service.js";
import { WEB_ADMIN_ACTOR } from "../../api/src/modules/admin/web-session.js";
import { VoyeyOwnerAuthority } from "../../api/src/modules/admin/owner.js";
import { JwtTokenService } from "../../api/src/modules/auth/token.js";

const seed = `INSERT INTO User(id,telegramId,updatedAt) VALUES('u',900101,1),('other',900102,1);
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
const request = { recipient, preorderPercent: 50 };
const input = (saleMode?: "IN_STOCK" | "PREORDER", quantity = 1) => ({
  productId: "p",
  variantId: "v",
  quantity,
  heightCm: null,
  weightKg: null,
  saleMode,
});
const commit = new LinkedCheckoutCommit(true);
const cart = new D1CartRepository();
function fixture() {
  const f = isolatedD1();
  f.sqlite.exec(seed);
  return f;
}
function count(f: ReturnType<typeof fixture>, table: string) {
  return (
    f.sqlite.prepare(`SELECT COUNT(*) n FROM "${table}"`).get() as { n: number }
  ).n;
}
function stock(f: ReturnType<typeof fixture>) {
  return (
    f.sqlite.prepare("SELECT stock FROM ProductVariant WHERE id='v'").get() as {
      stock: number;
    }
  ).stock;
}
const legacy = (key = randomUUID(), promoCode?: string) =>
  new D1OrderRepository().checkout({
    userId: "u",
    publicId: randomUUID(),
    idempotencyKey: key,
    recipient,
    promoCode,
    prepare: prepareOrder,
  });
async function add(modes: ("IN_STOCK" | "PREORDER")[], user = "u") {
  for (const mode of modes) await cart.addItem(user, input(mode));
}

for (const [mode, percent, first, remainder, reserved] of [
  ["IN_STOCK", undefined, 101, 0, 1],
  ["PREORDER", 50, 51, 50, 0],
  ["PREORDER", 100, 101, 0, 0],
] as const)
  test(`atomic persisted ${mode} ${percent ?? 100}%: money due is not money received`, async () => {
    const f = fixture();
    try {
      await f.run(async () => {
        await add([mode]);
        const result = await commit.create("u", randomUUID(), {
          recipient,
          ...(percent ? { preorderPercent: percent } : {}),
        });
        const order = result.orders[0]!;
        assert.equal(result.userId, "u");
        assert.equal(result.sealed, 1);
        assert.equal(order.state, "PAYMENTS_BLOCKED");
        assert.equal(order.firstPaymentAmount, first);
        assert.equal(order.remainingAfterFirst, remainder);
        assert.equal(order.goodsPaid, 0);
        assert.equal(order.unpaidGoods, 101);
        assert.equal(order.cargoAmount, null);
        assert.equal(order.cargoPaid, 0);
        assert.equal(order.items[0]!.inventoryReservedQuantity, reserved);
        assert.equal(stock(f), 5 - reserved);
        assert.equal(
          order.financialPolicy.cargo,
          mode === "PREORDER" ? "UNKNOWN_UNTIL_ARRIVAL" : "NOT_APPLICABLE",
        );
        assert.match(order.publicId, /^STZ-/);
        assert.equal(order.checkoutGroupId, result.id);
        assert.equal(count(f, "CheckoutGroup"), 1);
        assert.equal(count(f, "CheckoutOrder"), 1);
        assert.equal(await prisma.checkoutGroup.count(), 1);
        assert.equal(count(f, "AuditLog"), 2);
        assert.equal(count(f, "CartItem"), 0);
        for (const table of [
          "Order",
          "Payment",
          "Refund",
          "PromoCodeRedemption",
        ])
          assert.equal(count(f, table), 0);
        assert.equal(
          order.firstPaymentAmount + order.remainingAfterFirst,
          order.goodsTotal,
        );
      });
    } finally {
      f.sqlite.close();
    }
  });

test("mixed same SKU: two real order IDs, one group, snapshots and one inventory reservation", async () => {
  const f = fixture();
  try {
    await f.run(async () => {
      f.sqlite.exec(
        `UPDATE Product SET attributes='{"material":"cotton"}' WHERE id='p'; UPDATE ProductVariant SET attributes='{"pack":2}' WHERE id='v'`,
      );
      f.sqlite
        .prepare("UPDATE Category SET attributeDefinitions=? WHERE id='c'")
        .run(
          JSON.stringify([
            {
              key: "material",
              nameRu: "Material",
              nameUz: "Material",
              type: "TEXT",
              scope: "PRODUCT",
            },
            {
              key: "pack",
              nameRu: "Pack",
              nameUz: "Pack",
              type: "INTEGER",
              scope: "VARIANT",
            },
          ]),
        );
      await add(["IN_STOCK", "PREORDER"]);
      const result = await commit.create("u", randomUUID(), request);
      assert.equal(result.orders.length, 2);
      assert.equal(new Set(result.orders.map((o) => o.id)).size, 2);
      assert.equal(new Set(result.orders.map((o) => o.publicId)).size, 2);
      assert.equal(result.goodsTotal, 202);
      assert.equal(stock(f), 4);
      assert.deepEqual(
        result.orders.map((o) => o.saleMode),
        ["IN_STOCK", "PREORDER"],
      );
      assert.equal(count(f, "AuditLog"), 3);
      assert.deepEqual(f.sqlite.prepare("PRAGMA foreign_key_check").all(), []);
      const saved = structuredClone(result);
      f.sqlite.exec(
        `UPDATE Product SET nameRu='Changed',price=999,attributes='{}' WHERE id='p'; UPDATE ProductVariant SET attributes='{}',sku='CHANGED' WHERE id='v'; UPDATE Category SET nameRu='Changed',slug='changed' WHERE id='c'`,
      );
      assert.deepEqual(await readCheckoutGroup("u", result.id), saved);
      for (const order of saved.orders) {
        assert.equal(order.items[0]!.snapshot.productNameRu, "Fixture");
        assert.equal(order.items[0]!.snapshot.sku, "FIXTURE");
        assert.equal(order.items[0]!.snapshot.unitPrice, 101);
        assert.match(
          JSON.stringify(order.items[0]!.snapshot.catalogSnapshot),
          /cotton/,
        );
        assert.match(
          JSON.stringify(order.items[0]!.snapshot.catalogSnapshot),
          /pack/,
        );
      }
      await assert.rejects(readCheckoutGroup("other", result.id), /not found/);
      for (const sql of [
        `UPDATE CheckoutOrder SET goodsPaid=101`,
        `DELETE FROM CheckoutOrder`,
        `UPDATE CheckoutOrderItem SET snapshot='{}'`,
        `DELETE FROM CheckoutOrderItem`,
        `UPDATE CheckoutGroup SET goodsTotal=1`,
        `DELETE FROM CheckoutGroup`,
      ])
        assert.throws(() => f.sqlite.exec(sql));
    });
  } finally {
    f.sqlite.close();
  }
});

test("zero stock PREORDER succeeds; IN_STOCK is revalidated at commit and fails without writes", async () => {
  const f = fixture();
  try {
    await f.run(async () => {
      await add(["IN_STOCK", "PREORDER"]);
      f.sqlite.exec("UPDATE ProductVariant SET stock=0 WHERE id='v'");
      await assert.rejects(commit.create("u", randomUUID(), request));
      for (const table of [
        "CheckoutGroup",
        "CheckoutOrder",
        "CheckoutOrderItem",
        "AuditLog",
      ])
        assert.equal(count(f, table), 0);
      assert.equal(count(f, "CartItem"), 2);
      assert.equal(stock(f), 0);
      await cart.clear("u");
      await add(["PREORDER"]);
      const result = await commit.create("u", randomUUID(), request);
      assert.equal(result.orders[0]!.items[0]!.inventoryReservedQuantity, 0);
      assert.equal(stock(f), 0);
    });
  } finally {
    f.sqlite.close();
  }
});

for (const change of [
  "UPDATE ProductVariant SET preorderEnabled=0",
  "UPDATE ProductVariant SET isActive=0",
  "UPDATE Product SET status='DRAFT'",
  "UPDATE Category SET isActive=0",
  "UPDATE User SET status='BLOCKED' WHERE id='u'",
])
  test(`stale eligibility fails closed: ${change}`, async () => {
    const f = fixture();
    try {
      await f.run(async () => {
        await add(["PREORDER"]);
        f.sqlite.exec(change);
        await assert.rejects(commit.create("u", randomUUID(), request));
        assert.equal(count(f, "CheckoutGroup"), 0);
        assert.equal(count(f, "CartItem"), 1);
        assert.equal(stock(f), 5);
      });
    } finally {
      f.sqlite.close();
    }
  });

test("default off, mixed LEGACY, client money/role/IDs, invalid percentages and null stock cannot bypass commit", async () => {
  const f = fixture();
  try {
    await f.run(async () => {
      await add(["PREORDER"]);
      await assert.rejects(
        new LinkedCheckoutCommit().create("u", randomUUID(), request),
        /disabled/,
      );
      for (const extra of [
        { preorderPercent: 75 },
        { goodsPaid: 101 },
        { firstPaymentAmount: 1 },
        { role: "OWNER" },
        { userId: "other" },
        { owner: true },
      ])
        await assert.rejects(
          commit.create("u", randomUUID(), { ...request, ...extra }),
        );
      await assert.rejects(commit.create("u", randomUUID(), { recipient }));
      await cart.addItem("u", input());
      await assert.rejects(commit.create("u", randomUUID(), request), /LEGACY/);
      assert.equal(count(f, "CheckoutGroup"), 0);
      await cart.clear("u");
      await add(["IN_STOCK"]);
      f.sqlite.exec("UPDATE ProductVariant SET stock=NULL");
      await assert.rejects(commit.create("u", randomUUID(), { recipient }));
      assert.equal(count(f, "CheckoutOrder"), 0);
    });
  } finally {
    f.sqlite.close();
  }
});

test("group idempotency replays original result after cart/catalog changes; conflicts preserve fresh cart", async () => {
  const f = fixture();
  try {
    await f.run(async () => {
      await add(["IN_STOCK", "PREORDER"]);
      const key = randomUUID();
      const result = await commit.create("u", key, request);
      await add(["IN_STOCK"]);
      f.sqlite.exec("UPDATE Product SET price=333 WHERE id='p'");
      const fresh = await cart.getOrCreate("u");
      assert.deepEqual(await commit.create("u", key, request), result);
      assert.deepEqual(await cart.getOrCreate("u"), fresh);
      assert.equal(stock(f), 4);
      for (const value of [
        { ...request, preorderPercent: 100 },
        { ...request, recipient: { ...recipient, city: "Changed" } },
        { ...request, promoCode: "ABC" },
      ])
        await assert.rejects(commit.create("u", key, value), /Incompatible/);
      assert.equal(count(f, "CheckoutOrder"), 2);
      assert.equal(count(f, "AuditLog"), 3);
      assert.equal(stock(f), 4);
      await add(["IN_STOCK"], "other");
      const other = await commit.create("other", key, { recipient });
      assert.notEqual(other.id, result.id);
      assert.equal(other.userId, "other");
    });
  } finally {
    f.sqlite.close();
  }
});

test("concurrent final unit and concurrent same key cannot double-reserve", async () => {
  for (const sameUser of [false, true]) {
    const f = fixture();
    try {
      await f.run(async () => {
        f.sqlite.exec("UPDATE ProductVariant SET stock=1");
        await add(["IN_STOCK"]);
        if (!sameUser) await add(["IN_STOCK"], "other");
        const key = randomUUID();
        const results = await Promise.allSettled([
          commit.create("u", key, { recipient }),
          commit.create(
            sameUser ? "u" : "other",
            sameUser ? key : randomUUID(),
            { recipient },
          ),
        ]);
        assert.equal(
          results.filter((r) => r.status === "fulfilled").length,
          sameUser ? 2 : 1,
        );
        if (sameUser)
          assert.deepEqual(
            (results[0] as PromiseFulfilledResult<unknown>).value,
            (results[1] as PromiseFulfilledResult<unknown>).value,
          );
        assert.equal(count(f, "CheckoutGroup"), 1);
        assert.equal(count(f, "CheckoutOrder"), 1);
        assert.equal(stock(f), 0);
        assert.equal(count(f, "AuditLog"), 2);
        assert.equal(count(f, "CartItem"), sameUser ? 0 : 1);
      });
    } finally {
      f.sqlite.close();
    }
  }
});

test("commit rejects forged aggregate quantities across sale modes before any mutation", async () => {
  const f = fixture();
  try {
    await f.run(async () => {
      f.sqlite.exec("UPDATE ProductVariant SET stock=100");
      await add(["IN_STOCK", "PREORDER"]);
      // Simulate a stale/corrupt cart rather than trusting prior Cart API validation.
      f.sqlite.exec("UPDATE CartItem SET quantity=60");
      await assert.rejects(commit.create("u", randomUUID(), request));
      assert.equal(count(f, "CheckoutGroup"), 0);
      assert.equal(count(f, "CartItem"), 2);
      assert.equal(stock(f), 100);
      assert.equal(count(f, "AuditLog"), 0);
    });
  } finally {
    f.sqlite.close();
  }
});

for (const failure of [
  "CREATE TRIGGER injected_order BEFORE INSERT ON CheckoutOrder WHEN NEW.saleMode='PREORDER' BEGIN SELECT RAISE(ABORT,'injected second order failure'); END;",
  "CREATE TRIGGER injected_audit BEFORE INSERT ON AuditLog WHEN NEW.action='checkout-group.create' BEGIN SELECT RAISE(ABORT,'injected audit failure'); END;",
  "CREATE TRIGGER injected_seal BEFORE UPDATE ON CheckoutGroup BEGIN SELECT RAISE(ABORT,'injected seal failure'); END;",
])
  test(`whole D1 batch rolls back: ${failure.split(" ")[2]}`, async () => {
    const f = fixture();
    try {
      await f.run(async () => {
        await new PromoCodeService().save(WEB_ADMIN_ACTOR, {
          code: "ONCE",
          type: "FIXED",
          value: 3,
          isActive: true,
        });
        await add(["IN_STOCK", "PREORDER"]);
        const audits = count(f, "AuditLog");
        f.sqlite.exec(failure);
        const key = randomUUID();
        await assert.rejects(
          commit.create("u", key, { ...request, promoCode: "ONCE" }),
          /injected/,
        );
        for (const table of [
          "CheckoutGroup",
          "CheckoutOrder",
          "CheckoutOrderItem",
          "CheckoutPromoUse",
          "Payment",
        ])
          assert.equal(count(f, table), 0);
        assert.equal(count(f, "AuditLog"), audits);
        assert.equal(count(f, "CartItem"), 2);
        assert.equal(stock(f), 5);
        assert.equal(count(f, "_BatchGuard"), 0);
        f.sqlite.exec(`DROP TRIGGER ${failure.split(" ")[2]}`);
        assert.equal(
          (await commit.create("u", key, { ...request, promoCode: "ONCE" }))
            .orders.length,
          2,
        );
        assert.equal(count(f, "CheckoutPromoUse"), 1);
        assert.equal(stock(f), 4);
      });
    } finally {
      f.sqlite.close();
    }
  });

test("one promotion per group, conserved discount and shared legacy/new per-user limits", async () => {
  const f = fixture();
  try {
    await f.run(async () => {
      const promos = new PromoCodeService();
      await promos.save(WEB_ADMIN_ACTOR, {
        code: "ONCE",
        type: "FIXED",
        value: 3,
        isActive: true,
      });
      await add(["IN_STOCK", "PREORDER"]);
      const key = randomUUID();
      const result = await commit.create("u", key, {
        ...request,
        promoCode: "once",
      });
      assert.equal(result.discountAmount, 3);
      assert.equal(result.goodsTotal, 199);
      assert.deepEqual(
        result.orders.map((o) => o.discountAmount),
        [2, 1],
      );
      assert.equal(
        result.orders.reduce((s, o) => s + o.goodsTotal, 0),
        199,
      );
      assert.equal(
        result.orders.reduce(
          (s, o) => s + o.firstPaymentAmount + o.remainingAfterFirst,
          0,
        ),
        199,
      );
      assert.equal(
        result.orders.reduce((s, o) => s + o.goodsPaid, 0),
        0,
      );
      assert.equal(count(f, "CheckoutPromoUse"), 1);
      assert.equal(count(f, "PromoCodeRedemption"), 0);
      assert.equal((await promos.list())[0]!.usageCount, 1);
      await add(["PREORDER"]);
      assert.deepEqual(
        await commit.create("u", key, { ...request, promoCode: "ONCE" }),
        result,
      );
      assert.equal(count(f, "CartItem"), 1);
      assert.equal(count(f, "CheckoutPromoUse"), 1);
      await assert.rejects(
        commit.create("u", randomUUID(), { ...request, promoCode: "ONCE" }),
        /PROMO_USER_LIMIT/,
      );
      await cart.clear("u");
      await cart.addItem("u", input());
      await assert.rejects(legacy(randomUUID(), "ONCE"), /PROMO_USER_LIMIT/);
      // Legacy -> new shares the same limit too, without converting legacy financial state.
      await promos.save(WEB_ADMIN_ACTOR, {
        code: "OLD1",
        type: "FIXED",
        value: 3,
        isActive: true,
      });
      const old = await legacy(randomUUID(), "OLD1");
      assert.equal(old.order.requiredPrepayment, 49);
      assert.equal(old.order.paidAmount, 0);
      await add(["PREORDER"]);
      await assert.rejects(
        commit.create("u", randomUUID(), { ...request, promoCode: "OLD1" }),
        /PROMO_USER_LIMIT/,
      );
      assert.equal(count(f, "CheckoutGroup"), 1);
      assert.equal(count(f, "PromoCodeRedemption"), 1);
      for (const sql of [
        "UPDATE CheckoutPromoUse SET releasedAt=1",
        "DELETE FROM CheckoutPromoUse",
      ])
        assert.throws(() => f.sqlite.exec(sql));
    });
  } finally {
    f.sqlite.close();
  }
});

test("concurrent global promotion limit is spent once across groups", async () => {
  const f = fixture();
  try {
    await f.run(async () => {
      await new PromoCodeService().save(WEB_ADMIN_ACTOR, {
        code: "LAST",
        type: "FIXED",
        value: 3,
        isActive: true,
        usageLimit: 1,
      });
      await add(["PREORDER"]);
      await add(["PREORDER"], "other");
      const results = await Promise.allSettled([
        commit.create("u", randomUUID(), { ...request, promoCode: "LAST" }),
        commit.create("other", randomUUID(), { ...request, promoCode: "LAST" }),
      ]);
      assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
      assert.equal(count(f, "CheckoutPromoUse"), 1);
      assert.equal(count(f, "CheckoutGroup"), 1);
      assert.equal(count(f, "CartItem"), 1);
      assert.equal(stock(f), 5);
    });
  } finally {
    f.sqlite.close();
  }
});

test("legacy and linked idempotency namespaces cannot collide via customer or manual orders", async () => {
  const f = fixture();
  try {
    await f.run(async () => {
      await add(["PREORDER"]);
      const key = randomUUID();
      await commit.create("u", key, request);
      await cart.addItem("u", input());
      await assert.rejects(legacy(key), /linked checkout/);
      await assert.rejects(
        new ManualOrderService().create(WEB_ADMIN_ACTOR, key, {
          userId: "u",
          recipient,
          items: [input()],
        }),
        /linked checkout/,
      );
      const legacyKey = randomUUID();
      const old = await legacy(legacyKey);
      assert.equal(old.order.requiredPrepayment, 51);
      await add(["PREORDER"]);
      await assert.rejects(
        commit.create("u", legacyKey, request),
        /legacy order/,
      );
      assert.equal(count(f, "CheckoutGroup"), 1);
      assert.equal(count(f, "Order"), 1);
      const linked = f.sqlite
        .prepare("SELECT id,publicId FROM CheckoutOrder LIMIT 1")
        .get() as { id: string; publicId: string };
      const insertLegacy = f.sqlite.prepare(
        `INSERT INTO "Order"(id,publicId,userId,idempotencyKey,fullName,phone,city,address,subtotal,total,requiredPrepayment,remainingAmount,updatedAt) VALUES(?,?,'u',?,'Synthetic','1234567','Fixture','Fixture',101,101,51,50,1)`,
      );
      for (const values of [
        [linked.id, "SAFE-NEW", randomUUID()],
        [randomUUID(), linked.publicId, randomUUID()],
        [randomUUID(), "SAFE-NEW", key],
      ])
        assert.throws(() => insertLegacy.run(...values), /linked checkout/);
    });
  } finally {
    f.sqlite.close();
  }
});

test("new IDs never resolve through legacy payment, cargo, status, cancellation or refund services", async () => {
  const f = fixture();
  try {
    await f.run(async () => {
      await add(["IN_STOCK", "PREORDER"]);
      const result = await commit.create("u", randomUUID(), request);
      const payments = new PaymentService(
        new D1PaymentRepository(),
        undefined,
        {
          cardHolder: "ISOLATED",
          cardNumber: "ISOLATED",
          instructionsRu: "ISOLATED",
          instructionsUz: "ISOLATED",
        },
      );
      for (const order of result.orders) {
        assert.equal(
          await new D1PaymentRepository().getOrderForUser("u", order.publicId),
          null,
        );
        assert.equal(
          await new D1OrderRepository().getForUser("u", order.publicId),
          null,
        );
        await assert.rejects(payments.getInstructions("u", order.publicId));
        await assert.rejects(
          payments.submit("u", order.publicId, randomUUID(), {
            data: Buffer.from("fixture"),
            declaredMimeType: "image/png",
          }),
        );
        await assert.rejects(payments.approve(order.id, WEB_ADMIN_ACTOR));
        await assert.rejects(
          payments.requestFinalPayment(order.publicId, 123, WEB_ADMIN_ACTOR),
        );
        await assert.rejects(
          new LifecycleService().cancel(order.publicId, WEB_ADMIN_ACTOR, {
            reason: "CUSTOMER_REQUEST",
          }),
        );
        await assert.rejects(
          new RefundService().complete(order.id, WEB_ADMIN_ACTOR, {}),
        );
      }
      assert.deepEqual(await readCheckoutGroup("u", result.id), result);
      assert.equal(stock(f), 4);
      for (const table of ["Payment", "Order", "Refund"])
        assert.equal(count(f, table), 0);
    });
  } finally {
    f.sqlite.close();
  }
});

test("migration 0021 preserves legacy rows/columns, adds constraints and blocks incomplete groups", () => {
  const sqlite = new DatabaseSync(":memory:");
  try {
    const directory = new URL("../migrations/", import.meta.url);
    for (const file of readdirSync(directory)
      .filter((f) => f < "0021")
      .sort())
      sqlite.exec(readFileSync(new URL(file, directory), "utf8"));
    sqlite.exec(seed);
    sqlite.exec(
      `INSERT INTO "Order"(id,publicId,userId,idempotencyKey,fullName,phone,city,address,subtotal,total,requiredPrepayment,remainingAmount,updatedAt) VALUES('old','OLD-1','u','old-existing-key-123','Synthetic','1234567','Fixture','Fixture',101,101,51,50,1)`,
    );
    const tables = (
      sqlite
        .prepare(
          "SELECT name,sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'",
        )
        .all() as { name: string; sql: string }[]
    ).filter((t) => !t.name.startsWith("_"));
    const before = tables.map((t) => ({
      name: t.name,
      sql: t.sql,
      rows: sqlite.prepare(`SELECT * FROM "${t.name}"`).all(),
    }));
    sqlite.exec(
      readFileSync(new URL("0021_linked_checkout.sql", directory), "utf8"),
    );
    for (const t of before) {
      assert.equal(
        (
          sqlite
            .prepare("SELECT sql FROM sqlite_master WHERE name=?")
            .get(t.name) as { sql: string }
        ).sql,
        t.sql,
      );
      assert.deepEqual(
        sqlite.prepare(`SELECT * FROM "${t.name}"`).all(),
        t.rows,
      );
    }
    assert.deepEqual(sqlite.prepare("PRAGMA foreign_key_check").all(), []);
    sqlite.exec(
      `INSERT INTO CheckoutGroup(id,userId,idempotencyKey,requestFingerprint,recipient,goodsSubtotal,discountAmount,goodsTotal,createdAt) VALUES('g','u','test-incomplete-key','fingerprint','{}',0,0,0,1)`,
    );
    assert.throws(
      () => sqlite.exec("UPDATE CheckoutGroup SET sealed=1 WHERE id='g'"),
      /incomplete/,
    );
    assert.throws(
      () =>
        sqlite.exec(
          `INSERT INTO CheckoutGroup(id,userId,idempotencyKey,requestFingerprint,recipient,goodsSubtotal,discountAmount,goodsTotal,createdAt) VALUES('g2','u','test-incomplete-key','fp','{}',0,0,0,1)`,
        ),
      /UNIQUE/,
    );
    assert.throws(
      () =>
        sqlite.exec(
          `INSERT INTO CheckoutGroup(id,userId,idempotencyKey,requestFingerprint,recipient,goodsSubtotal,discountAmount,goodsTotal,createdAt) VALUES('g3','u','other-incomplete-key','fp','{}',1,0,0,1)`,
        ),
      /CHECK/,
    );
  } finally {
    sqlite.close();
  }
});

test("D1 rejects inconsistent obligations, duplicate child modes and snapshot amounts", async () => {
  const f = fixture();
  try {
    await f.run(async () => {
      await add(["IN_STOCK"]);
      const saved = await commit.create("u", randomUUID(), { recipient });
      f.sqlite
        .prepare(
          `INSERT INTO CheckoutGroup(id,userId,idempotencyKey,requestFingerprint,recipient,goodsSubtotal,discountAmount,goodsTotal,createdAt) SELECT 'unsealed',userId,'unsealed-test-key',requestFingerprint,recipient,goodsSubtotal,discountAmount,goodsTotal,createdAt FROM CheckoutGroup WHERE id=?`,
        )
        .run(saved.id);
      const order = f.sqlite
        .prepare("SELECT * FROM CheckoutOrder LIMIT 1")
        .get() as Record<string, string | number | null>;
      const insert = (changes: Record<string, string | number | null>) => {
        const data = {
          ...order,
          id: randomUUID(),
          publicId: randomUUID(),
          checkoutGroupId: "unsealed",
          ...changes,
        };
        const keys = Object.keys(data);
        return f.sqlite
          .prepare(
            `INSERT INTO CheckoutOrder(${keys.join(",")}) VALUES(${keys.map(() => "?").join(",")})`,
          )
          .run(...Object.values(data));
      };
      for (const changes of [
        { saleMode: "LEGACY" },
        { prepaymentPercent: 50 },
        { firstPaymentAmount: 51 },
        { remainingAfterFirst: 1 },
        { goodsPaid: 1 },
        { unpaidGoods: 0 },
        { cargoAmount: 0 },
        { goodsTotal: 1 },
        { discountAmount: 102 },
        { financialPolicy: "{}" },
        { publicId: saved.orders[0]!.publicId },
      ] as Record<string, string | number | null>[])
        assert.throws(() => insert(changes));
      const childId = randomUUID();
      insert({ id: childId });
      assert.throws(() => insert({}), /UNIQUE/);
      assert.throws(
        () =>
          f.sqlite.exec(
            "UPDATE CheckoutGroup SET sealed=1 WHERE id='unsealed'",
          ),
        /incomplete order items/,
      );
      const item = f.sqlite
        .prepare("SELECT * FROM CheckoutOrderItem LIMIT 1")
        .get() as Record<string, string | number | null>;
      const values = { ...item, id: randomUUID(), orderId: childId };
      const keys = Object.keys(values);
      const stmt = f.sqlite.prepare(
        `INSERT INTO CheckoutOrderItem(${keys.join(",")}) VALUES(${keys.map(() => "?").join(",")})`,
      );
      for (const changes of [
        { lineTotal: 1 },
        { inventoryReservedQuantity: 0 },
        { saleMode: "PREORDER" },
        { snapshot: "{}" },
      ])
        assert.throws(() =>
          stmt.run(...Object.values({ ...values, ...changes })),
        );
      stmt.run(...Object.values(values));
      f.sqlite.exec("UPDATE CheckoutGroup SET sealed=1 WHERE id='unsealed'");
      assert.deepEqual(f.sqlite.prepare("PRAGMA foreign_key_check").all(), []);
    });
  } finally {
    f.sqlite.close();
  }
});

test("owner authority: server configuration + verified personal JWT + active membership, audited without credentials", async () => {
  const f = fixture();
  try {
    await f.run(async () => {
      f.sqlite.exec(
        `INSERT INTO TelegramAdmin(id,telegramId,isActive,createdBy,createdAt,updatedAt) VALUES('owner-admin','900101',1,'fixture',1,1),('employee','900102',1,'fixture',1,1)`,
      );
      const tokens = new JwtTokenService(randomBytes(32).toString("hex"));
      const owner = "Bearer " + (await tokens.issue("u")),
        employee = "Bearer " + (await tokens.issue("other"));
      let configured = "900101";
      const auth = new VoyeyOwnerAuthority(tokens, () => configured);
      assert.deepEqual(await auth.authorize(owner, "PAYMENT_CONFIRM"), {
        userId: "u",
      });
      await assert.rejects(auth.authorize(employee, "PAYMENT_CONFIRM"), {
        statusCode: 403,
      });
      await assert.rejects(auth.authorize(undefined, "REFUND_CONFIRM"), {
        statusCode: 403,
      });
      await assert.rejects(
        auth.authorize("Bearer synthetic-invalid", "CARGO_CHANGE"),
        { statusCode: 403 },
      );
      configured = "";
      await assert.rejects(auth.authorize(owner, "PAYMENT_CONFIRM"), {
        statusCode: 503,
      });
      for (const bad of ["000900101", "invalid", "900101,900102"]) {
        configured = bad;
        await assert.rejects(auth.authorize(owner, "PAYMENT_CONFIRM"), {
          statusCode: 503,
        });
      }
      configured = "900101";
      f.sqlite.exec(
        "UPDATE TelegramAdmin SET isActive=0 WHERE id='owner-admin'",
      );
      await assert.rejects(auth.authorize(owner, "PAYMENT_CONFIRM"), {
        statusCode: 403,
      });
      f.sqlite.exec(
        "UPDATE TelegramAdmin SET isActive=1 WHERE id='owner-admin'; UPDATE User SET status='BLOCKED' WHERE id='u'",
      );
      await assert.rejects(auth.authorize(owner, "PAYMENT_CONFIRM"), {
        statusCode: 403,
      });
      f.sqlite.exec("UPDATE User SET status='ACTIVE' WHERE id='u'");
      configured = "900102";
      await assert.rejects(auth.authorize(owner, "PAYMENT_CONFIRM"), {
        statusCode: 403,
      });
      assert.deepEqual(await auth.authorize(employee, "REFUND_CONFIRM"), {
        userId: "other",
      });
      await assert.rejects(auth.confirmNewPayment(employee), {
        statusCode: 503,
      });
      const logs = f.sqlite
        .prepare("SELECT * FROM AuditLog WHERE entityType='OwnerAuthority'")
        .all();
      assert.ok(logs.length >= 12);
      const audit = JSON.stringify(logs);
      for (const secret of [
        owner.slice(7),
        employee.slice(7),
        "900101",
        "900102",
        "synthetic-invalid",
      ])
        assert.ok(!audit.includes(secret));
      assert.match(audit, /OWNER_NOT_CONFIGURED/);
      assert.match(audit, /owner.denied/);
      assert.match(audit, /owner.authorized/);
      assert.equal(count(f, "Payment"), 0);
    });
  } finally {
    f.sqlite.close();
  }
});

test("actual Worker has no linked commit route for customers, shared Admin, or anonymous calls, even commerce=1", async () => {
  const f = await marketingRuntime();
  try {
    const user = await runtimeUser(f, 900103);
    for (const path of [
      "/checkout/groups/commit",
      "/checkout/commit",
      "/checkout-groups",
      "/admin/checkout/groups/commit",
      "/admin/linked-orders/commit",
    ]) {
      for (const headers of [
        {},
        { authorization: "Bearer " + user.token },
        f.signed,
      ] as Record<string, string>[]) {
        const response = await f.call(
          path,
          "POST",
          { ...request, owner: true, role: "OWNER" },
          headers,
          path.startsWith("/admin")
            ? "https://admin.preview.invalid"
            : "https://preview.invalid",
        );
        assert.ok(
          [401, 403, 404].includes(response.status),
          `${path}: ${response.status}`,
        );
      }
    }
    assert.equal(
      (await f.db
        .prepare("SELECT COUNT(*) n FROM CheckoutGroup")
        .first<{ n: number }>())!.n,
      0,
    );
    assert.equal(f.outboundCalls(), 0);
  } finally {
    await f.mf.dispose();
  }
});

test("real isolated D1 batch persists/replays group and rolls back second child; Worker legacy routes reject it", async () => {
  const f = await marketingRuntime();
  try {
    await f.db.exec(seed);
    const user = await runtimeUser(f, 900101);
    const result = await withDatabase(f.db as unknown as Database, async () => {
      await add(["IN_STOCK", "PREORDER"]);
      await f.db
        .prepare(
          "CREATE TRIGGER injected_real BEFORE INSERT ON CheckoutOrder WHEN NEW.saleMode='PREORDER' BEGIN SELECT RAISE(ABORT,'injected real D1 failure'); END",
        )
        .run();
      const key = randomUUID();
      await assert.rejects(commit.create("u", key, request), /injected real/);
      for (const table of [
        "CheckoutGroup",
        "CheckoutOrder",
        "CheckoutOrderItem",
        "AuditLog",
      ])
        assert.equal(
          (await f.db
            .prepare(`SELECT COUNT(*) n FROM ${table}`)
            .first<{ n: number }>())!.n,
          0,
        );
      assert.equal(
        (await f.db
          .prepare("SELECT stock FROM ProductVariant WHERE id='v'")
          .first<{ stock: number }>())!.stock,
        5,
      );
      await f.db.prepare("DROP TRIGGER injected_real").run();
      const saved = await commit.create("u", key, request);
      assert.deepEqual(await commit.create("u", key, request), saved);
      return saved;
    });
    for (const order of result.orders) {
      for (const path of [
        `/orders/${order.publicId}`,
        `/orders/${order.publicId}/payment`,
      ])
        assert.equal(
          (
            await f.call(
              path,
              "GET",
              undefined,
              { authorization: "Bearer " + user.token },
              "https://preview.invalid",
            )
          ).status,
          404,
        );
      for (const [path, body] of [
        [`/orders/${order.publicId}/cancel`, { reason: "CUSTOMER_REQUEST" }],
        [
          `/orders/${order.publicId}/request-final-payment`,
          { cargoAmount: 101 },
        ],
        [`/payments/${order.id}/approve`, {}],
      ] as const)
        assert.equal((await f.admin(path, "POST", body)).status, 404);
    }
    assert.equal(f.outboundCalls(), 0);
  } finally {
    await f.mf.dispose();
  }
});
