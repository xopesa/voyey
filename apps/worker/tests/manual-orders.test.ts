import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma } from "@stenzo/database";
import { ManualOrderService } from "../../api/src/modules/admin/manual-orders.js";
import {
  D1CartRepository,
  D1OrderRepository,
  D1PaymentRepository,
} from "../../api/src/d1/repositories.js";
import { prepareOrder } from "../../api/src/modules/checkout/domain.js";
import { PromoCodeService } from "../../api/src/modules/marketing/promo-codes.js";
import { WEB_ADMIN_ACTOR } from "../../api/src/modules/admin/web-session.js";
import { isolatedD1 } from "./helpers/sqlite.js";
import { marketingRuntime } from "./helpers/marketing-runtime.js";
import { runtimeUser } from "./helpers/customer-operations.js";
import { NotificationService } from "../../api/src/modules/notifications/service.js";

const recipient = {
  fullName: "Isolated buyer",
  phone: "+998900000000",
  city: "Fixture",
  address: "Isolated address",
  apartment: null,
  comment: null,
};
const line = {
  productId: "p",
  variantId: "v",
  quantity: 1,
  heightCm: 180,
  weightKg: 75,
};
const input = () => ({
  userId: "a",
  recipient: { ...recipient },
  items: [{ ...line }],
});
const promo = { code: "OPS10", type: "PERCENT", value: 10, isActive: true };
function fixture() {
  const f = isolatedD1();
  f.sqlite.exec(`
 INSERT INTO User(id,telegramId,status,updatedAt) VALUES('a',501,'ACTIVE',1),('b',502,'ACTIVE',1),('blocked',503,'BLOCKED',1),('deleted',504,'DELETED',1);
 INSERT INTO Category(id,nameRu,nameUz,slug,updatedAt) VALUES('c','Test','Sinov','c',1);
 INSERT INTO Product(id,categoryId,nameRu,nameUz,slug,price,status,updatedAt) VALUES('p','c','Брюки','Shim','p',290001,'ACTIVE',1),('q','c','Худи','Hudi','q',100001,'ACTIVE',1);
 INSERT INTO ProductVariant(id,productId,sku,size,color,stock,isActive,updatedAt) VALUES('v','p','OPS-M','M','Gray',5,1,1),('w','p','OPS-L','L','Gray',NULL,1,1),('other','q','OPS-HUDI','M',NULL,10,1,1);
 `);
  return f;
}
const create = (value: unknown = input(), key = randomUUID()) =>
  new ManualOrderService().create(WEB_ADMIN_ACTOR, key, value);
const checkout = (userId = "b", promoCode?: string, key = randomUUID()) =>
  new D1OrderRepository().checkout({
    userId,
    promoCode,
    idempotencyKey: key,
    publicId: randomUUID(),
    recipient,
    prepare: prepareOrder,
  });
async function addCart(userId = "a") {
  return new D1CartRepository().addItem(userId, line);
}

for (const [name, patch] of [
  ["blocked user", { userId: "blocked" }],
  ["deleted user", { userId: "deleted" }],
  ["missing user", { userId: "missing" }],
  ["quantity zero", { items: [{ ...line, quantity: 0 }] }],
  ["quantity 100", { items: [{ ...line, quantity: 100 }] }],
  ["decimal quantity", { items: [{ ...line, quantity: 1.5 }] }],
  ["height 99", { items: [{ ...line, heightCm: 99 }] }],
  ["height 251", { items: [{ ...line, heightCm: 251 }] }],
  ["missing height", { items: [{ ...line, heightCm: null }] }],
  ["weight 29", { items: [{ ...line, weightKg: 29 }] }],
  ["weight 301", { items: [{ ...line, weightKg: 301 }] }],
  ["variant mismatch", { items: [{ ...line, variantId: "other" }] }],
  ["client price", { items: [{ ...line, price: 1 }] }],
  ["client totals", { total: 1 }],
  ["client paid status", { status: "PAID_FULL" }],
  ["duplicate variant", { items: [line, line] }],
  ["empty items", { items: [] }],
] as const)
  test(`manual rejects ${name} without creating records or decrementing stock`, async () => {
    const f = fixture();
    try {
      await f.run(async () => {
        await assert.rejects(create({ ...input(), ...patch }));
        assert.equal(await prisma.order.count(), 0);
        assert.equal(await prisma.payment.count(), 0);
        assert.equal(await prisma.cart.count(), 0);
        assert.equal(
          f.sqlite
            .prepare("SELECT stock FROM ProductVariant WHERE id='v'")
            .get()!.stock,
          5,
        );
        assert.equal(await prisma.user.count(), 4);
      });
    } finally {
      f.sqlite.close();
    }
  });
for (const [name, sql] of [
  ["inactive product", "UPDATE Product SET status='INACTIVE' WHERE id='p'"],
  ["inactive category", "UPDATE Category SET isActive=0 WHERE id='c'"],
  ["inactive variant", "UPDATE ProductVariant SET isActive=0 WHERE id='v'"],
  ["zero stock", "UPDATE ProductVariant SET stock=0 WHERE id='v'"],
] as const)
  test(`manual requires ${name} to be purchasable`, async () => {
    const f = fixture();
    try {
      await f.run(async () => {
        f.sqlite.exec(sql);
        await assert.rejects(create());
        assert.equal(await prisma.order.count(), 0);
      });
    } finally {
      f.sqlite.close();
    }
  });

test("manual base price snapshots, source ADMIN, prepayment rounding, no cart/payment and safe audit", async () => {
  const f = fixture();
  try {
    await f.run(async () => {
      const order = await create();
      assert.equal(order.source, "ADMIN");
      assert.equal(order.status, "AWAITING_PREPAYMENT");
      assert.equal(order.total, 290001);
      assert.equal(order.requiredPrepayment, 145001);
      assert.equal(order.remainingAmount, 145000);
      assert.equal(order.items[0]!.originalUnitPrice, 290001);
      assert.equal(order.items[0]!.unitPrice, 290001);
      assert.equal(order.items[0]!.sku, "OPS-M");
      assert.equal(order.paidAmount, 0);
      assert.equal(await prisma.cart.count(), 0);
      assert.equal(await prisma.payment.count(), 0);
      assert.equal(
        f.sqlite.prepare("SELECT stock FROM ProductVariant WHERE id='v'").get()!
          .stock,
        4,
      );
      const log = (
        await prisma.auditLog.findMany({ where: { action: "order.create" } })
      )[0]!;
      const data = log.metadata as Record<string, unknown>;
      assert.equal(log.actorId, null);
      assert.equal(data.source, "ADMIN");
      assert.equal(data.userId, "a");
      assert.ok(data.adminPrincipal);
      assert.equal(data.discountAmount, 0);
      assert.equal(JSON.stringify(data).includes(recipient.address), false);
      const owned = await new D1OrderRepository().listForUser("a", {
        limit: 20,
      });
      assert.equal(owned.orders[0]!.publicId, order.publicId);
      assert.equal(
        (await new D1OrderRepository().listForUser("b", { limit: 20 })).orders
          .length,
        0,
      );
    });
  } finally {
    f.sqlite.close();
  }
});
test("manual preview is read-only; multi-line sale snapshot and unlimited stock use the shared checkout engine", async () => {
  const f = fixture();
  try {
    await f.run(async () => {
      f.sqlite.exec("UPDATE Product SET salePrice=250001 WHERE id='p'");
      const body = {
        ...input(),
        items: [line, { ...line, variantId: "w", quantity: 2 }],
      };
      const before = f.sqlite.prepare("SELECT version FROM _Revision").get()!
        .version;
      const quote = await new ManualOrderService().preview(body);
      assert.equal(quote.total, 750003);
      assert.equal(
        f.sqlite.prepare("SELECT version FROM _Revision").get()!.version,
        before,
      );
      const order = await create(body);
      assert.equal(order.subtotal, 750003);
      assert.equal(order.items[0]!.originalUnitPrice, 290001);
      assert.equal(order.items[0]!.unitPrice, 250001);
      assert.equal(order.items.length, 2);
      assert.equal(
        f.sqlite.prepare("SELECT stock FROM ProductVariant WHERE id='w'").get()!
          .stock,
        null,
      );
      f.sqlite.exec(
        "UPDATE Product SET price=500001,salePrice=NULL,nameRu='Changed' WHERE id='p'",
      );
      const old = await new D1OrderRepository().getForUser("a", order.publicId);
      assert.equal(old!.total, 750003);
      assert.equal(old!.items[0]!.unitPrice, 250001);
      assert.equal(old!.items[0]!.productNameRu, "Брюки");
    });
  } finally {
    f.sqlite.close();
  }
});
for (const type of ["PERCENT", "FIXED"] as const)
  test(`manual reuses ${type} promo with sale, usage limits, net prepayment and immutable replay`, async () => {
    const f = fixture();
    try {
      await f.run(async () => {
        f.sqlite.exec("UPDATE Product SET salePrice=250001 WHERE id='p'");
        await new PromoCodeService().save(WEB_ADMIN_ACTOR, {
          ...promo,
          type,
          value: type === "PERCENT" ? 10 : 10001,
          usageLimit: 1,
        });
        const body = { ...input(), promoCode: "ops10" },
          key = randomUUID(),
          first = await create(body, key);
        assert.equal(first.discountAmount, type === "PERCENT" ? 25000 : 10001);
        assert.equal(first.subtotal, 250001);
        assert.equal(first.total, 250001 - first.discountAmount!);
        assert.equal(first.requiredPrepayment, Math.ceil(first.total / 2));
        assert.equal(
          first.remainingAmount,
          first.total - first.requiredPrepayment,
        );
        f.sqlite.exec(
          "UPDATE User SET status='BLOCKED' WHERE id='a';UPDATE Product SET status='INACTIVE' WHERE id='p';UPDATE PromoCode SET isActive=0;",
        );
        const again = await create({ ...body, promoCode: "OTHER" }, key);
        assert.equal(again.publicId, first.publicId);
        assert.equal(again.total, first.total);
        assert.equal(again.promoCodeSnapshot, "OPS10");
        assert.equal(await prisma.promoCodeRedemption.count(), 1);
        assert.equal(await prisma.orderItem.count(), 1);
        assert.equal(
          f.sqlite
            .prepare("SELECT stock FROM ProductVariant WHERE id='v'")
            .get()!.stock,
          4,
        );
      });
    } finally {
      f.sqlite.close();
    }
  });
test("manual leaves the customer's existing Cart and CartItems byte-for-byte unchanged", async () => {
  const f = fixture();
  try {
    await f.run(async () => {
      await addCart();
      const before = f.sqlite.prepare("SELECT * FROM Cart").all(),
        items = f.sqlite.prepare("SELECT * FROM CartItem").all();
      await create();
      assert.deepEqual(f.sqlite.prepare("SELECT * FROM Cart").all(), before);
      assert.deepEqual(f.sqlite.prepare("SELECT * FROM CartItem").all(), items);
    });
  } finally {
    f.sqlite.close();
  }
});
test("manual insufficient-stock multi-item and late SQL failure roll back every write including promo redemption", async () => {
  const f = fixture();
  try {
    await f.run(async () => {
      await new PromoCodeService().save(WEB_ADMIN_ACTOR, promo);
      await assert.rejects(
        create({
          ...input(),
          items: [
            line,
            { ...line, variantId: "other", productId: "q", quantity: 11 },
          ],
          promoCode: "OPS10",
        }),
      );
      f.sqlite.exec(
        "CREATE TRIGGER fail_manual_item BEFORE INSERT ON OrderItem BEGIN SELECT RAISE(ABORT,'isolated manual failure');END;",
      );
      await assert.rejects(
        create({ ...input(), promoCode: "OPS10" }),
        /isolated manual failure/,
      );
      assert.equal(await prisma.order.count(), 0);
      assert.equal(await prisma.promoCodeRedemption.count(), 0);
      assert.equal(
        f.sqlite.prepare("SELECT stock FROM ProductVariant WHERE id='v'").get()!
          .stock,
        5,
      );
    });
  } finally {
    f.sqlite.close();
  }
});
test("manual per-user promo limit and failed promo consume no stock or redemption", async () => {
  const f = fixture();
  try {
    await f.run(async () => {
      await new PromoCodeService().save(WEB_ADMIN_ACTOR, promo);
      await create({ ...input(), promoCode: "OPS10" });
      await assert.rejects(create({ ...input(), promoCode: "OPS10" }));
      await assert.rejects(create({ ...input(), promoCode: "MISSING" }));
      assert.equal(await prisma.promoCodeRedemption.count(), 1);
      assert.equal(
        f.sqlite.prepare("SELECT stock FROM ProductVariant WHERE id='v'").get()!
          .stock,
        4,
      );
    });
  } finally {
    f.sqlite.close();
  }
});
test("same manual key concurrently writes one order/item/stock change/redemption; cross-source collision rejected", async () => {
  const f = fixture();
  try {
    await f.run(async () => {
      await new PromoCodeService().save(WEB_ADMIN_ACTOR, promo);
      const key = randomUUID(),
        body = { ...input(), promoCode: "OPS10" };
      const [a, b] = await Promise.all([create(body, key), create(body, key)]);
      assert.equal(a.publicId, b.publicId);
      assert.equal(await prisma.promoCodeRedemption.count(), 1);
      assert.equal(await prisma.order.count(), 1);
      assert.equal(
        f.sqlite.prepare("SELECT stock FROM ProductVariant WHERE id='v'").get()!
          .stock,
        4,
      );
      await assert.rejects(checkout("a", undefined, key));
    });
  } finally {
    f.sqlite.close();
  }
});
for (const mode of ["stock", "promo"] as const)
  test(`manual vs customer checkout ${mode} concurrency shares one atomic budget`, async () => {
    const f = fixture();
    try {
      await f.run(async () => {
        if (mode === "stock")
          f.sqlite.exec("UPDATE ProductVariant SET stock=1 WHERE id='v'");
        else
          await new PromoCodeService().save(WEB_ADMIN_ACTOR, {
            ...promo,
            usageLimit: 1,
          });
        await addCart("b");
        const results = await Promise.allSettled([
          create({
            ...input(),
            ...(mode === "promo" ? { promoCode: "OPS10" } : {}),
          }),
          checkout("b", mode === "promo" ? "OPS10" : undefined),
        ]);
        assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
        assert.equal(await prisma.order.count(), 1);
        assert.equal(
          await prisma.promoCodeRedemption.count(),
          mode === "promo" ? 1 : 0,
        );
        assert.equal(
          f.sqlite
            .prepare("SELECT stock FROM ProductVariant WHERE id='v'")
            .get()!.stock,
          mode === "stock" ? 0 : 4,
        );
      });
    } finally {
      f.sqlite.close();
    }
  });
test("manual order uses unchanged PREPAYMENT / FINAL payment flow, cargo remains separate", async () => {
  const f = fixture();
  try {
    await f.run(async () => {
      const order = await create(),
        p = new D1PaymentRepository();
      const pre = await p.submit({
        userId: "a",
        orderPublicId: order.publicId,
        idempotencyKey: randomUUID(),
        proofStorageKey: "isolated-ops-pre",
        proofMimeType: "image/png",
      });
      assert.equal(pre.payment.expectedAmount, 145001);
      await p.approve(pre.payment.id, WEB_ADMIN_ACTOR);
      const stored = await prisma.order.findUniqueOrThrow({
        where: { publicId: order.publicId },
      });
      f.sqlite
        .prepare('UPDATE "Order" SET status=? WHERE id=?')
        .run("WEIGHING", stored.id);
      await p.requestFinalPayment(order.publicId, 30000, WEB_ADMIN_ACTOR);
      const final = await p.submit({
        userId: "a",
        orderPublicId: order.publicId,
        idempotencyKey: randomUUID(),
        proofStorageKey: "isolated-ops-final",
        proofMimeType: "image/png",
      });
      assert.equal(final.payment.expectedAmount, 175000);
      await p.approve(final.payment.id, WEB_ADMIN_ACTOR);
      const paid = await prisma.order.findUniqueOrThrow({
        where: { id: stored.id },
      });
      assert.equal(paid.status, "PAID_FULL");
      assert.equal(paid.paidAmount, 290001);
      assert.equal(paid.cargoPaidAmount, 30000);
    });
  } finally {
    f.sqlite.close();
  }
});
test("actual Worker manual routes require Admin/CSRF/key, create no carts/payments/notifications, and reuse normal user Orders API", async () => {
  const f = await marketingRuntime();
  try {
    const user = await runtimeUser(f, 950001),
      other = await runtimeUser(f, 950002);
    await f.db
      .prepare(
        "INSERT INTO Category(id,nameRu,nameUz,slug,updatedAt) VALUES('c','Test','Sinov','c',1)",
      )
      .run();
    await f.db
      .prepare(
        "INSERT INTO Product(id,categoryId,nameRu,nameUz,slug,price,status,updatedAt) VALUES('p','c','Test','Sinov','p',101,'ACTIVE',1)",
      )
      .run();
    await f.db
      .prepare(
        "INSERT INTO ProductVariant(id,productId,sku,size,stock,isActive,updatedAt) VALUES('v','p','OPS-REAL','M',2,1,1)",
      )
      .run();
    const body = { ...input(), userId: user.id },
      path = "/admin/orders/manual";
    assert.equal((await f.call(path, "POST", body)).status, 401);
    assert.equal((await f.admin("/orders/manual", "POST", body)).status, 400);
    const noCsrf = { ...f.signed, "idempotency-key": randomUUID() };
    delete (noCsrf as Partial<typeof noCsrf>)["x-csrf-token"];
    assert.equal((await f.call(path, "POST", body, noCsrf)).status, 403);
    const preview = await f.admin("/orders/manual/preview", "POST", body);
    assert.equal(preview.status, 200);
    const calls = f.outboundCalls();
    const headers = { ...f.signed, "idempotency-key": randomUUID() };
    const response = await f.call(path, "POST", body, headers);
    assert.equal(response.status, 201, await response.clone().text());
    const order = (
      (await response.json()) as { order: { publicId: string; source: string } }
    ).order;
    assert.equal(order.source, "ADMIN");
    assert.equal(f.outboundCalls(), calls);
    assert.equal(
      (await f.db
        .prepare("SELECT count(*) n FROM Cart")
        .first<{ n: number }>())!.n,
      0,
    );
    assert.equal(
      (await f.db
        .prepare("SELECT count(*) n FROM Payment")
        .first<{ n: number }>())!.n,
      0,
    );
    const own = await f.call(
      "/orders",
      "GET",
      undefined,
      { authorization: "Bearer " + user.token },
      "https://preview.invalid",
    );
    assert.equal(own.status, 200);
    assert.ok((await own.text()).includes(order.publicId));
    const forbidden = await f.call(
      "/orders/" + order.publicId,
      "GET",
      undefined,
      { authorization: "Bearer " + other.token },
      "https://preview.invalid",
    );
    assert.equal(forbidden.status, 404);
    assert.equal((await f.call(path, "POST", body, headers)).status, 201);
    assert.equal(
      (await f.db
        .prepare('SELECT count(*) n FROM "Order"')
        .first<{ n: number }>())!.n,
      1,
    );
    assert.equal(f.outboundCalls(), calls);
  } finally {
    await f.mf.dispose();
  }
});
test("commerce-off Worker does not permit Admin manual order creation", async () => {
  const f = await marketingRuntime("0");
  try {
    assert.equal(
      (await f.admin("/orders/manual", "POST", input())).status,
      503,
    );
  } finally {
    await f.mf.dispose();
  }
});

test("manual order notification is suppressed even during recovery", async () => {
  const f = fixture();
  try {
    await f.run(async () => {
      const dto = await create();
      const order = (await new D1OrderRepository().getForAdmin(dto.publicId))!;
      let sent = 0;
      const notifications = new NotificationService(
        {
          sendText: async () => {
            sent++;
          },
        },
        new Set(["isolated-admin"]),
      );
      await notifications.orderCreated(order);
      await notifications.orderCreated(order, true);
      assert.equal(sent, 0);
      await notifications.orderCreated({ ...order, source: "MINIAPP" });
      assert.equal(sent, 1);
    });
  } finally {
    f.sqlite.close();
  }
});

for (const budget of ["stock", "promo"] as const)
  test(`actual Worker manual/checkout ${budget} race returns one success and controlled 409`, async () => {
    const f = await marketingRuntime();
    try {
      const a = await runtimeUser(f, 960001),
        b = await runtimeUser(f, 960002);
      await f.db
        .prepare(
          "INSERT INTO Category(id,nameRu,nameUz,slug,updatedAt) VALUES('c','Test','Sinov','c',1)",
        )
        .run();
      await f.db
        .prepare(
          "INSERT INTO Product(id,categoryId,nameRu,nameUz,slug,price,status,updatedAt) VALUES('p','c','Test','Sinov','p',101,'ACTIVE',1)",
        )
        .run();
      await f.db
        .prepare(
          "INSERT INTO ProductVariant(id,productId,sku,size,stock,isActive,updatedAt) VALUES('v','p','RACE','M',?,1,1)",
        )
        .bind(budget === "stock" ? 1 : 5)
        .run();
      if (budget === "promo") {
        assert.equal(
          (
            await f.admin("/marketing/promo-codes", "POST", {
              ...promo,
              usageLimit: 1,
            })
          ).status,
          201,
        );
      }
      const userHeaders = {
        origin: "https://preview.invalid",
        authorization: "Bearer " + b.token,
      };
      assert.equal(
        (
          await f.call(
            "/cart/items",
            "POST",
            line,
            userHeaders,
            "https://preview.invalid",
          )
        ).status,
        201,
      );
      const code = budget === "promo" ? { promoCode: "OPS10" } : {};
      const responses = await Promise.all([
        f.call(
          "/admin/orders/manual",
          "POST",
          { ...input(), userId: a.id, ...code },
          { ...f.signed, "idempotency-key": randomUUID() },
        ),
        f.call(
          "/checkout",
          "POST",
          { ...recipient, ...code },
          { ...userHeaders, "idempotency-key": randomUUID() },
          "https://preview.invalid",
        ),
      ]);
      assert.deepEqual(responses.map((r) => r.status).sort(), [201, 409]);
      assert.equal(
        (await f.db
          .prepare('SELECT count(*) n FROM "Order"')
          .first<{ n: number }>())!.n,
        1,
      );
      assert.equal(
        (await f.db
          .prepare("SELECT count(*) n FROM PromoCodeRedemption")
          .first<{ n: number }>())!.n,
        budget === "promo" ? 1 : 0,
      );
      assert.equal(
        (await f.db
          .prepare("SELECT stock FROM ProductVariant WHERE id='v'")
          .first<{ stock: number }>())!.stock,
        budget === "stock" ? 0 : 4,
      );
    } finally {
      await f.mf.dispose();
    }
  });
