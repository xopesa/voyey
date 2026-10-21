import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma } from "@stenzo/database";
import { cancellableStatuses } from "@stenzo/shared";
import { financeFixture, payment } from "./helpers/finance.js";
import { LifecycleService } from "../../api/src/modules/admin/lifecycle.js";
import { RefundService } from "../../api/src/modules/admin/refunds.js";
import { WEB_ADMIN_ACTOR } from "../../api/src/modules/admin/web-session.js";
import { ManualOrderService } from "../../api/src/modules/admin/manual-orders.js";
import { PromoCodeService } from "../../api/src/modules/marketing/promo-codes.js";
import {
  D1CartRepository,
  D1OrderRepository,
} from "../../api/src/d1/repositories.js";
import { prepareOrder } from "../../api/src/modules/checkout/domain.js";
import { OrderService } from "../../api/src/modules/orders/service.js";
import { marketingRuntime } from "./helpers/marketing-runtime.js";
import { financeSeed } from "./helpers/finance.js";
const actor = WEB_ADMIN_ACTOR,
  body = { reason: "CUSTOMER_REQUEST", note: "Internal cancellation note" },
  s = new LifecycleService(),
  r = new RefundService();
for (const status of cancellableStatuses)
  test(`cancellation allowed from ${status}`, async () => {
    const f = financeFixture();
    try {
      await f.run(async () => {
        f.sqlite.prepare('UPDATE "Order" SET status=?').run(status);
        const a = await s.cancel("STZ-FINANCE", actor, body);
        assert.equal(a.status, "CANCELLED");
        assert.ok(a.cancelledAt);
        assert.equal(a.stockReleaseStatus, "REVIEW_REQUIRED");
        assert.equal(a.refund, null);
      });
    } finally {
      f.sqlite.close();
    }
  });
for (const status of [
  "PREPAYMENT_SUBMITTED",
  "FINAL_PAYMENT_SUBMITTED",
  "SHIPPED",
  "COMPLETED",
])
  test(`cancellation denied from ${status}`, async () => {
    const f = financeFixture();
    try {
      await f.run(async () => {
        f.sqlite.prepare('UPDATE "Order" SET status=?').run(status);
        await assert.rejects(s.cancel("STZ-FINANCE", actor, body));
        assert.equal(await prisma.refund.count(), 0);
        assert.equal(await prisma.auditLog.count(), 0);
      });
    } finally {
      f.sqlite.close();
    }
  });
test("reason required, note bounded, unresolved proof denied even with an inconsistent allowed order status", async () => {
  const f = financeFixture();
  try {
    await f.run(async () => {
      for (const input of [
        {},
        { reason: "BAD" },
        { reason: "OTHER", note: "x".repeat(501) },
        { ...body, amount: 1 },
      ])
        await assert.rejects(s.cancel("STZ-FINANCE", actor, input));
      payment(f.sqlite, "submitted", "PREPAYMENT", "SUBMITTED", 145000);
      await assert.rejects(s.cancel("STZ-FINANCE", actor, body));
      assert.equal(await prisma.refund.count(), 0);
    });
  } finally {
    f.sqlite.close();
  }
});
test("legacy cancel and concurrent replay keep timestamp/audit/refund stable; manual stock acknowledgement never changes variants", async () => {
  const f = financeFixture();
  try {
    await f.run(async () => {
      payment(f.sqlite, "approved", "PREPAYMENT", "APPROVED", 145000);
      payment(f.sqlite, "rejected", "FINAL", "REJECTED", 235000);
      const approved = f.sqlite.prepare("SELECT * FROM Payment").all();
      const [a, b] = await Promise.all([
        s.cancel("STZ-FINANCE", actor, body),
        s.cancel("STZ-FINANCE", actor, body),
      ]);
      assert.equal(a.cancelledAt, b.cancelledAt);
      assert.equal(a.refund!.amount, 145000);
      assert.equal(a.refund!.id, b.refund!.id);
      assert.equal(
        await prisma.auditLog.count({ where: { action: "order.cancelled" } }),
        1,
      );
      assert.equal(await prisma.refund.count(), 1);
      assert.deepEqual(
        f.sqlite.prepare("SELECT * FROM Payment").all(),
        approved,
      );
      await s.stockReviewed("STZ-FINANCE", actor);
      await s.stockReviewed("STZ-FINANCE", actor);
      assert.equal(
        (await s.state("STZ-FINANCE")).stockReleaseStatus,
        "RELEASED",
      );
      assert.equal(
        await prisma.auditLog.count({
          where: { action: "order.stock_release_reviewed" },
        }),
        1,
      );
      assert.equal(await prisma.productVariant.count(), 0);
    });
  } finally {
    f.sqlite.close();
  }
});
test("full approved cash including FINAL cargo creates one immutable refund, completion/replay/no undo preserve facts and customer privacy", async () => {
  const f = financeFixture();
  try {
    await f.run(async () => {
      payment(f.sqlite, "pre", "PREPAYMENT", "APPROVED", 145000);
      payment(f.sqlite, "final", "FINAL", "APPROVED", 235000);
      payment(f.sqlite, "rejected", "FINAL", "REJECTED", 999);
      const before = f.sqlite.prepare("SELECT * FROM Payment").all();
      const c = await s.cancel("STZ-FINANCE", actor, body);
      assert.equal(c.refund!.amount, 380000);
      const id = c.refund!.id;
      await assert.rejects(r.complete(id, actor, { amount: 1 }));
      await assert.rejects(
        r.complete(id, actor, { reference: "x".repeat(201) }),
      );
      await assert.rejects(r.complete(id, actor, { note: "x".repeat(501) }));
      const done = await r.complete(id, actor, {
        reference: "private-reference",
        note: "private-refund-note",
      });
      const replay = await r.complete(id, actor, {});
      assert.equal(replay.completedAt, done.completedAt);
      assert.equal(replay.reference, "private-reference");
      assert.equal(replay.amount, 380000);
      assert.equal(
        await prisma.auditLog.count({ where: { action: "refund.completed" } }),
        1,
      );
      assert.deepEqual(f.sqlite.prepare("SELECT * FROM Payment").all(), before);
      const dto = await new OrderService(new D1OrderRepository()).getForUser(
        "finance-user",
        "STZ-FINANCE",
      );
      assert.equal(dto.cancellation!.refund!.status, "COMPLETED");
      for (const secret of [
        "private-reference",
        "private-refund-note",
        "Internal cancellation note",
        "cancelledBy",
        "procurement",
        "stockRelease",
      ])
        assert.equal(JSON.stringify(dto).includes(secret), false);
      assert.equal((await r.list({ status: "COMPLETED" })).refunds.length, 1);
      assert.equal((await r.list({ status: "PENDING" })).refunds.length, 0);
    });
  } finally {
    f.sqlite.close();
  }
});
function stockFixture() {
  const f = financeFixture();
  f.sqlite.exec(
    `INSERT INTO Category(id,nameRu,nameUz,slug,updatedAt) VALUES('c','Test','Sinov','c',1);INSERT INTO Product(id,categoryId,nameRu,nameUz,slug,price,status,updatedAt) VALUES('p','c','Test','Sinov','p',100001,'ACTIVE',1);INSERT INTO ProductVariant(id,productId,sku,size,stock,isActive,updatedAt) VALUES('v','p','LIFE-M','M',5,1,1),('w','p','LIFE-L','L',NULL,1,1);`,
  );
  return f;
}
const recipient = {
  fullName: "Isolated Buyer",
  phone: "+998900000000",
  city: "Fixture",
  address: "Fixture address",
  apartment: null,
  comment: null,
};
const line = {
  productId: "p",
  variantId: "v",
  quantity: 2,
  heightCm: 180,
  weightKg: 75,
};
const manual = (items = [line], promoCode?: string) =>
  new ManualOrderService().create(actor, randomUUID(), {
    userId: "finance-user",
    recipient,
    items,
    ...(promoCode ? { promoCode } : {}),
  });
test("manual and normal checkout save finite quantity/unlimited zero; cancellation restores exact finite quantity once and leaves unlimited unchanged", async () => {
  const f = stockFixture();
  try {
    await f.run(async () => {
      const order = await manual([
        line,
        { ...line, variantId: "w", quantity: 3 },
      ]);
      const saved = await prisma.order.findUniqueOrThrow({
        where: { publicId: order.publicId },
        include: { items: true },
      });
      assert.deepEqual(
        saved.items.map((i) => i.inventoryReservedQuantity).sort(),
        [0, 2],
      );
      assert.equal(
        (await prisma.productVariant.findUniqueOrThrow({ where: { id: "v" } }))
          .stock,
        3,
      );
      await Promise.all([
        s.cancel(order.publicId, actor, body),
        s.cancel(order.publicId, actor, body),
      ]);
      assert.equal(
        (await prisma.productVariant.findUniqueOrThrow({ where: { id: "v" } }))
          .stock,
        5,
      );
      assert.equal(
        (await prisma.productVariant.findUniqueOrThrow({ where: { id: "w" } }))
          .stock,
        null,
      );
      assert.equal(
        (await s.state(order.publicId)).stockReleaseStatus,
        "RELEASED",
      );
      await new D1CartRepository().addItem("finance-user", line);
      const ck = await new D1OrderRepository().checkout({
        userId: "finance-user",
        idempotencyKey: randomUUID(),
        publicId: "STZ-CHECKOUT-SNAPSHOT",
        recipient,
        prepare: prepareOrder,
      });
      assert.equal(ck.order.items[0]!.inventoryReservedQuantity, 2);
    });
  } finally {
    f.sqlite.close();
  }
});
test("current unlimited or missing variant handled safely; unknown legacy reserve requires review without guessing", async () => {
  const f = stockFixture();
  try {
    await f.run(async () => {
      const order = await manual();
      f.sqlite.exec("UPDATE ProductVariant SET stock=NULL WHERE id='v'");
      await s.cancel(order.publicId, actor, body);
      assert.equal(
        (await s.state(order.publicId)).stockReleaseStatus,
        "RELEASED",
      );
      assert.equal(
        (await prisma.productVariant.findUniqueOrThrow({ where: { id: "v" } }))
          .stock,
        null,
      );
      f.sqlite.exec("UPDATE ProductVariant SET stock=5 WHERE id='v'");
      const another = await manual();
      f.sqlite
        .prepare(
          'UPDATE OrderItem SET variantId=NULL WHERE orderId=(SELECT id FROM "Order" WHERE publicId=?)',
        )
        .run(another.publicId);
      await s.cancel(another.publicId, actor, body);
      assert.equal(
        (await s.state(another.publicId)).stockReleaseStatus,
        "REVIEW_REQUIRED",
      );
      assert.equal(
        (await prisma.productVariant.findUniqueOrThrow({ where: { id: "v" } }))
          .stock,
        3,
      );
    });
  } finally {
    f.sqlite.close();
  }
});
test("promo global/per-user usage recovers after cancellation and concurrent cancel/checkout never consumes more than one active usage", async () => {
  const f = stockFixture();
  try {
    await f.run(async () => {
      await new PromoCodeService().save(actor, {
        code: "LIFE10",
        type: "PERCENT",
        value: 10,
        usageLimit: 1,
        perUserLimit: 1,
        isActive: true,
      });
      const first = await manual([line], "LIFE10");
      await assert.rejects(manual([line], "LIFE10"));
      await s.cancel(first.publicId, actor, body);
      const second = await manual([line], "LIFE10");
      const results = await Promise.allSettled([
        s.cancel(second.publicId, actor, body),
        manual([line], "LIFE10"),
      ]);
      assert.equal(results[0]!.status, "fulfilled");
      assert.ok(
        (await prisma.promoCodeRedemption.count({
          where: { releasedAt: null },
        })) <= 1,
      );
      assert.equal(
        (await new PromoCodeService().list())[0]!.usageCount,
        await prisma.promoCodeRedemption.count({ where: { releasedAt: null } }),
      );
      assert.equal(
        await prisma.promoCodeRedemption.count({
          where: { releaseReason: "ORDER_CANCELLED" },
        }),
        2,
      );
    });
  } finally {
    f.sqlite.close();
  }
});
test("normal checkout races cancellation without double stock or promo consumption", async () => {
  const f = stockFixture();
  try {
    await f.run(async () => {
      await new PromoCodeService().save(actor, {
        code: "RECOVER",
        type: "PERCENT",
        value: 10,
        usageLimit: 1,
        perUserLimit: 1,
        isActive: true,
      });
      const first = await manual([line], "RECOVER");
      await new D1CartRepository().addItem("finance-user", line);
      const checkout = () =>
        new D1OrderRepository().checkout({
          userId: "finance-user",
          idempotencyKey: randomUUID(),
          publicId: "STZ-RECOVERY-CHECKOUT",
          recipient,
          promoCode: "RECOVER",
          prepare: prepareOrder,
        });
      const result = await Promise.allSettled([
        s.cancel(first.publicId, actor, body),
        checkout(),
      ]);
      assert.equal(result[0]!.status, "fulfilled");
      if (result[1]!.status === "rejected") await checkout();
      assert.equal(
        await prisma.promoCodeRedemption.count({ where: { releasedAt: null } }),
        1,
      );
      assert.equal(
        (await prisma.productVariant.findUniqueOrThrow({ where: { id: "v" } }))
          .stock,
        3,
      );
      await s.cancel(first.publicId, actor, body);
      assert.equal(
        (await prisma.productVariant.findUniqueOrThrow({ where: { id: "v" } }))
          .stock,
        3,
      );
    });
  } finally {
    f.sqlite.close();
  }
});
test("repeated variant snapshots aggregate once; stock overflow needs review without a partial variant restock", async () => {
  const f = stockFixture();
  try {
    await f.run(async () => {
      f.sqlite.exec(
        `UPDATE OrderItem SET variantId='v',inventoryReservedQuantity=2 WHERE id='i'; INSERT INTO OrderItem(id,orderId,variantId,productNameRu,productNameUz,productSlug,sku,size,unitPrice,quantity,lineTotal,inventoryReservedQuantity) VALUES('j','o','v','Test','Sinov','p','LIFE-M','M',1,3,3,3)`,
      );
      await s.cancel("STZ-FINANCE", actor, body);
      assert.equal(
        (await prisma.productVariant.findUniqueOrThrow({ where: { id: "v" } }))
          .stock,
        10,
      );
    });
  } finally {
    f.sqlite.close();
  }
  const g = stockFixture();
  try {
    await g.run(async () => {
      g.sqlite.exec(
        `UPDATE OrderItem SET variantId='v',inventoryReservedQuantity=2 WHERE id='i';UPDATE ProductVariant SET stock=2147483647 WHERE id='v'`,
      );
      assert.equal(
        (await s.cancel("STZ-FINANCE", actor, body)).stockReleaseStatus,
        "REVIEW_REQUIRED",
      );
      await s.stockReviewed("STZ-FINANCE", actor);
      assert.equal(
        (await prisma.productVariant.findUniqueOrThrow({ where: { id: "v" } }))
          .stock,
        2147483647,
      );
    });
  } finally {
    g.sqlite.close();
  }
});
test("late cancellation failure rolls back stock, redemption, refund, status and audit together", async () => {
  const f = stockFixture();
  try {
    await f.run(async () => {
      await new PromoCodeService().save(actor, {
        code: "LIFE10",
        type: "PERCENT",
        value: 10,
        isActive: true,
      });
      const o = await manual([line], "LIFE10");
      const stored = await prisma.order.findUniqueOrThrow({
        where: { publicId: o.publicId },
      });
      await prisma.payment.count();
      f.sqlite
        .prepare(
          `INSERT INTO Payment(id,orderId,type,status,expectedAmount,idempotencyKey,proofStorageKey,proofMimeType,updatedAt) VALUES('cash',?,'PREPAYMENT','APPROVED',1,'cash-key','isolated-proof','image/png',1)`,
        )
        .run(stored.id);
      f.sqlite.exec(
        `CREATE TRIGGER fail_cancel BEFORE UPDATE ON "Order" WHEN NEW.status='CANCELLED' BEGIN SELECT RAISE(ABORT,'isolated rollback'); END;`,
      );
      await assert.rejects(
        s.cancel(o.publicId, actor, body),
        /isolated rollback/,
      );
      assert.equal(
        (await prisma.productVariant.findUniqueOrThrow({ where: { id: "v" } }))
          .stock,
        3,
      );
      assert.equal(await prisma.refund.count(), 0);
      assert.equal(
        await prisma.promoCodeRedemption.count({ where: { releasedAt: null } }),
        1,
      );
      assert.equal(
        await prisma.auditLog.count({ where: { action: "order.cancelled" } }),
        0,
      );
    });
  } finally {
    f.sqlite.close();
  }
});
test("refund list is bounded/cursor paginated without repeated rows; concurrent completion preserves facts and audit once", async () => {
  const f = financeFixture();
  try {
    await f.run(async () => {
      payment(f.sqlite, "pre", "PREPAYMENT", "APPROVED", 145000);
      const c = await s.cancel("STZ-FINANCE", actor, body);
      const [a, b] = await Promise.all([
        r.complete(c.refund!.id, actor, { reference: "first" }),
        r.complete(c.refund!.id, actor, { reference: "second" }),
      ]);
      assert.equal(a.completedAt, b.completedAt);
      assert.equal(a.reference, b.reference);
      assert.equal(
        await prisma.auditLog.count({ where: { action: "refund.completed" } }),
        1,
      );
      for (let i = 0; i < 24; i++) {
        const id = "page-" + String(i).padStart(2, "0");
        f.sqlite
          .prepare(
            `INSERT INTO "Order"(id,publicId,userId,idempotencyKey,status,fullName,phone,city,address,subtotal,total,requiredPrepayment,remainingAmount,updatedAt) VALUES(?,?, 'finance-user',?,'CANCELLED','Isolated','0000000','Fixture','Fixture',2,2,1,1,1)`,
          )
          .run(id, id, id);
        f.sqlite
          .prepare(
            `INSERT INTO Refund(id,orderId,amount,createdBy,createdAt,updatedAt) VALUES(?,?,1,'fixture',1,1)`,
          )
          .run(id, id);
      }
      const first = await r.list({ status: "PENDING" });
      assert.equal(first.refunds.length, 20);
      assert.ok(first.nextCursor);
      const second = await r.list({
        status: "PENDING",
        cursor: first.nextCursor,
      });
      assert.equal(second.refunds.length, 4);
      assert.equal(second.nextCursor, null);
      assert.equal(
        new Set([...first.refunds, ...second.refunds].map((x) => x.id)).size,
        24,
      );
      for (const q of [
        { limit: 0 },
        { limit: 51 },
        { status: "BAD" },
        { cursor: "bad cursor" },
      ])
        await assert.rejects(r.list(q));
    });
  } finally {
    f.sqlite.close();
  }
});
test("actual Worker cancellation/refund routes require Admin/CSRF; hard delete, amount edits and undo do not exist", async () => {
  const f = await marketingRuntime();
  try {
    for (const sql of financeSeed
      .trim()
      .split(";")
      .filter((s) => s.trim()))
      await f.db.prepare(sql).run();
    const path = "/admin/orders/STZ-FINANCE/cancel";
    assert.equal((await f.call(path, "POST", body)).status, 401);
    const h = { ...f.signed };
    delete (h as Partial<typeof h>)["x-csrf-token"];
    assert.equal((await f.call(path, "POST", body, h)).status, 403);
    assert.equal(
      (await f.admin("/orders/STZ-FINANCE/cancel", "POST", body)).status,
      200,
    );
    assert.equal((await f.admin("/finance/refunds")).status, 200);
    for (const [path, method] of [
      ["/finance/refunds/x", "DELETE"],
      ["/finance/refunds/x", "PATCH"],
      ["/finance/refunds/x/undo", "POST"],
    ])
      assert.ok([403, 404].includes((await f.admin(path!, method!)).status));
  } finally {
    await f.mf.dispose();
  }
});
