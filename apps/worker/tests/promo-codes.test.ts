import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID, createHmac } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { prisma } from "@stenzo/database";
import {
  cartSnapshotVersion,
  normalizePromoCode,
  promoDiscount,
} from "@stenzo/shared";
import {
  PromoCodeService,
  parsePromo,
  promoForCheckout,
  PromoUnavailableError,
} from "../../api/src/modules/marketing/promo-codes.js";
import {
  D1CartRepository,
  D1OrderRepository,
  D1PaymentRepository,
} from "../../api/src/d1/repositories.js";
import { toCartDto } from "../../api/src/modules/cart/service.js";
import { prepareOrder } from "../../api/src/modules/checkout/domain.js";
import { toOrderDto } from "../../api/src/modules/orders/service.js";
import { WEB_ADMIN_ACTOR } from "../../api/src/modules/admin/web-session.js";
import { isolatedD1 } from "./helpers/sqlite.js";
import { marketingRuntime } from "./helpers/marketing-runtime.js";

const promo = { code: "stenzo-10", type: "PERCENT", value: 10, isActive: true };
const recipient = {
  fullName: "Isolated buyer",
  phone: "+998900000000",
  city: "Fixture",
  address: "Test address",
  apartment: null,
  comment: null,
};
function fixture() {
  const f = isolatedD1();
  f.sqlite.exec(
    `INSERT INTO User(id,telegramId,updatedAt) VALUES('a',1001,1),('b',1002,1); INSERT INTO Category(id,nameRu,nameUz,slug,updatedAt) VALUES('c','Test','Sinov','c',1); INSERT INTO Product(id,categoryId,nameRu,nameUz,slug,price,salePrice,status,updatedAt) VALUES('p','c','Тест','Sinov','p',290001,250001,'ACTIVE',1); INSERT INTO ProductVariant(id,productId,sku,size,stock,isActive,updatedAt) VALUES('v','p','fixture','M',10,1,1);`,
  );
  return f;
}
async function cart(userId = "a") {
  return new D1CartRepository().addItem(userId, {
    productId: "p",
    variantId: "v",
    quantity: 1,
    heightCm: 180,
    weightKg: 75,
  });
}
const checkout = (
  userId = "a",
  promoCode: string | undefined = "STENZO-10",
  key = randomUUID(),
) =>
  new D1OrderRepository().checkout({
    userId,
    promoCode,
    idempotencyKey: key,
    publicId: randomUUID(),
    recipient,
    prepare: prepareOrder,
  });

test("promo normalization uppercase/trim and strict length/format", () => {
  assert.equal(normalizePromoCode(" stenzo-10 "), "STENZO-10");
  for (const code of [
    "ab",
    "a".repeat(33),
    "-ABC",
    "ABC-",
    "A--B",
    "АБВ",
    "A B",
    "A_B",
    "A\nB",
  ])
    assert.equal(normalizePromoCode(code), null);
});
for (const [name, input] of [
  ["percent zero", { ...promo, value: 0 }],
  ["percent 91", { ...promo, value: 91 }],
  ["fixed zero", { ...promo, type: "FIXED", value: 0 }],
  ["decimal", { ...promo, value: 1.5 }],
  [
    "period reversed",
    {
      ...promo,
      startsAt: "2026-10-21T00:00:00Z",
      endsAt: "2026-10-20T00:00:00Z",
    },
  ],
  ["non-UTC date", { ...promo, startsAt: "2026-10-21T05:00" }],
  ["injected totals", { ...promo, discountAmount: 100 }],
  ["zero user limit", { ...promo, perUserLimit: 0 }],
] as const)
  test(`promo validation rejects ${name}`, () =>
    assert.throws(() => parsePromo(input)));

for (const [name, config, subtotal, expected] of [
  [
    "percent floors odd total",
    { type: "PERCENT", value: 10, maxDiscount: null, minOrderAmount: null },
    290001,
    29000,
  ],
  [
    "percent capped",
    { type: "PERCENT", value: 90, maxDiscount: 10000, minOrderAmount: null },
    100000,
    10000,
  ],
  [
    "fixed",
    { type: "FIXED", value: 29000, maxDiscount: null, minOrderAmount: null },
    250001,
    29000,
  ],
  [
    "minimum after sale",
    { type: "PERCENT", value: 10, maxDiscount: null, minOrderAmount: 290000 },
    250001,
    null,
  ],
  [
    "fixed equal subtotal",
    { type: "FIXED", value: 250001, maxDiscount: null, minOrderAmount: null },
    250001,
    null,
  ],
  [
    "fixed exceeds subtotal",
    { type: "FIXED", value: 300000, maxDiscount: null, minOrderAmount: null },
    250001,
    null,
  ],
  [
    "zero discount",
    { type: "PERCENT", value: 1, maxDiscount: null, minOrderAmount: null },
    1,
    null,
  ],
] as const)
  test(`promo discount: ${name}`, () =>
    assert.equal(promoDiscount(config, subtotal), expected));

test("Admin create/edit/activate/deactivate preserve history and don't duplicate audit on no-op", async () => {
  const f = fixture();
  try {
    await f.run(async () => {
      const service = new PromoCodeService();
      const p = await service.save(WEB_ADMIN_ACTOR, {
        ...promo,
        isActive: false,
      });
      assert.equal(p.code, "STENZO-10");
      assert.equal(p.usageCount, 0);
      assert.equal(p.perUserLimit, 1);
      await assert.rejects(service.save(WEB_ADMIN_ACTOR, promo));
      await service.setActive(WEB_ADMIN_ACTOR, p.id, true);
      await service.setActive(WEB_ADMIN_ACTOR, p.id, true);
      await assert.rejects(
        service.save(WEB_ADMIN_ACTOR, { ...p, internalField: "forbidden" }),
      );
      await service.save(WEB_ADMIN_ACTOR, { ...promo, value: 15 }, p.id);
      await service.save(WEB_ADMIN_ACTOR, { ...promo, value: 15 }, p.id);
      await service.setActive(WEB_ADMIN_ACTOR, p.id, false);
      assert.equal((await service.list())[0]!.value, 15);
      for (const action of ["create", "update", "activate", "deactivate"])
        assert.equal(
          await prisma.auditLog.count({
            where: { action: `promo_code.${action}` },
          }),
          1,
        );
    });
  } finally {
    f.sqlite.close();
  }
});
test("validate uses current owner's cart and is read-only even without a cart; no reservation", async () => {
  const f = fixture();
  try {
    await f.run(async () => {
      const service = new PromoCodeService();
      await service.save(WEB_ADMIN_ACTOR, promo);
      const rev = f.sqlite.prepare("SELECT version FROM _Revision").get()!
        .version;
      assert.deepEqual(await service.validateCart("a", "STENZO-10"), {
        valid: false,
        reason: "PROMO_EMPTY_CART",
        cartVersion: null,
      });
      assert.equal(await prisma.cart.count(), 0);
      assert.equal(
        f.sqlite.prepare("SELECT version FROM _Revision").get()!.version,
        rev,
      );
      const snapshot = toCartDto(await cart());
      const rev2 = f.sqlite.prepare("SELECT version FROM _Revision").get()!
        .version;
      for (let i = 0; i < 3; i++)
        assert.deepEqual(await service.validateCart("a", "stenzo-10"), {
          valid: true,
          code: "STENZO-10",
          subtotal: 250001,
          discountAmount: 25000,
          total: 225001,
          cartVersion: cartSnapshotVersion(snapshot),
        });
      assert.equal((await service.validateCart("b", "stenzo-10")).valid, false);
      assert.equal(await prisma.promoCodeRedemption.count(), 0);
      assert.equal(
        f.sqlite.prepare("SELECT version FROM _Revision").get()!.version,
        rev2,
      );
    });
  } finally {
    f.sqlite.close();
  }
});
test("schedule is inclusive at start/exclusive at end; inactive/unknown codes fail closed", async () => {
  const f = fixture();
  try {
    await f.run(async () => {
      const now = Date.now(),
        service = new PromoCodeService();
      const input = {
        ...promo,
        startsAt: new Date(now).toISOString(),
        endsAt: new Date(now + 10000).toISOString(),
      };
      const p = await service.save(WEB_ADMIN_ACTOR, input);
      const check = async (time: number) =>
        (await promoForCheckout("a", p.code, 250001, time)).quote;
      assert.deepEqual(await check(now - 1), {
        valid: false,
        reason: "PROMO_NOT_STARTED",
      });
      assert.equal((await check(now)).valid, true);
      assert.deepEqual(await check(now + 10000), {
        valid: false,
        reason: "PROMO_EXPIRED",
      });
      await service.setActive(WEB_ADMIN_ACTOR, p.id, false);
      assert.deepEqual(await check(now), {
        valid: false,
        reason: "PROMO_INACTIVE",
      });
      assert.equal(
        (await promoForCheckout("a", "UNKNOWN", 100)).quote.valid,
        false,
      );
    });
  } finally {
    f.sqlite.close();
  }
});
test("sale + percent promo snapshot, odd rounding and idempotent replay survive product/code edits", async () => {
  const f = fixture();
  try {
    await f.run(async () => {
      const service = new PromoCodeService(),
        p = await service.save(WEB_ADMIN_ACTOR, promo);
      await cart();
      const key = randomUUID(),
        first = await checkout("a", "STENZO-10", key);
      const o = first.order;
      assert.equal(o.subtotal, 250001);
      assert.equal(o.discountAmount, 25000);
      assert.equal(o.total, 225001);
      assert.equal(o.requiredPrepayment, 112501);
      assert.equal(o.remainingAmount, 112500);
      assert.equal(o.items[0]!.unitPrice, 250001);
      assert.equal(o.items[0]!.originalUnitPrice, 290001);
      assert.equal(await prisma.promoCodeRedemption.count(), 1);
      assert.equal(
        await prisma.auditLog.count({
          where: { action: "promo_code.redeemed" },
        }),
        1,
      );
      await service.save(
        WEB_ADMIN_ACTOR,
        { ...promo, code: "RENAMED", value: 20, isActive: false },
        p.id,
      );
      f.sqlite.exec(
        "UPDATE Product SET price=500000,salePrice=NULL,saleEndsAt=NULL WHERE id='p'",
      );
      const replay = await checkout("a", "BAD-NEW-CODE", key);
      assert.equal(replay.created, false);
      assert.equal(replay.order.id, o.id);
      assert.equal(toOrderDto(replay.order).promoCodeSnapshot, "STENZO-10");
      assert.equal(replay.order.total, 225001);
      assert.equal(
        f.sqlite.prepare("SELECT stock FROM ProductVariant").get()!.stock,
        9,
      );
      assert.equal(await prisma.promoCodeRedemption.count(), 1);
      assert.equal(await prisma.order.count(), 1);
      assert.throws(
        () => f.sqlite.prepare("DELETE FROM PromoCode WHERE id=?").run(p.id),
        /FOREIGN KEY/,
      );
    });
  } finally {
    f.sqlite.close();
  }
});
test("fixed promo and no-promo checkout remain backward-compatible", async () => {
  const f = fixture();
  try {
    await f.run(async () => {
      await new PromoCodeService().save(WEB_ADMIN_ACTOR, {
        ...promo,
        type: "FIXED",
        value: 10001,
      });
      await cart();
      const o = (await checkout()).order;
      assert.equal(o.discountAmount, 10001);
      assert.equal(o.total, 240000);
      await cart("b");
      const plain = (
        await new D1OrderRepository().checkout({
          userId: "b",
          publicId: randomUUID(),
          idempotencyKey: randomUUID(),
          recipient,
          prepare: prepareOrder,
        })
      ).order;
      assert.equal(plain.total, 250001);
      assert.equal(plain.discountAmount, 0);
      assert.equal(plain.promoCodeSnapshot, null);
    });
  } finally {
    f.sqlite.close();
  }
});
test("global limit=1 is atomic across two users; losing cart/stock remains intact", async () => {
  const f = fixture();
  try {
    await f.run(async () => {
      await new PromoCodeService().save(WEB_ADMIN_ACTOR, {
        ...promo,
        usageLimit: 1,
      });
      await cart("a");
      await cart("b");
      const results = await Promise.allSettled([checkout("a"), checkout("b")]);
      assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
      const rejected = results.find(
        (r) => r.status === "rejected",
      ) as PromiseRejectedResult;
      assert.ok(rejected.reason instanceof PromoUnavailableError);
      assert.equal(rejected.reason.reason, "PROMO_LIMIT");
      assert.equal(await prisma.order.count(), 1);
      assert.equal(await prisma.promoCodeRedemption.count(), 1);
      assert.equal(await prisma.cartItem.count(), 1);
      assert.equal(
        f.sqlite.prepare("SELECT stock FROM ProductVariant").get()!.stock,
        9,
      );
    });
  } finally {
    f.sqlite.close();
  }
});
test("per-user limit rejects a second order and leaves its cart unchanged", async () => {
  const f = fixture();
  try {
    await f.run(async () => {
      await new PromoCodeService().save(WEB_ADMIN_ACTOR, promo);
      await cart();
      await checkout();
      await cart();
      await assert.rejects(
        checkout(),
        (e: unknown) =>
          e instanceof PromoUnavailableError && e.reason === "PROMO_USER_LIMIT",
      );
      assert.equal(await prisma.promoCodeRedemption.count(), 1);
      assert.equal(await prisma.cartItem.count(), 1);
    });
  } finally {
    f.sqlite.close();
  }
});
test("code expiring or deactivated after validate is rechecked at checkout without consuming stock", async () => {
  const f = fixture();
  try {
    await f.run(async () => {
      const service = new PromoCodeService(),
        p = await service.save(WEB_ADMIN_ACTOR, promo);
      await cart();
      assert.equal((await service.validateCart("a", "STENZO-10")).valid, true);
      await service.setActive(WEB_ADMIN_ACTOR, p.id, false);
      await assert.rejects(checkout(), PromoUnavailableError);
      assert.equal(await prisma.order.count(), 0);
      assert.equal(await prisma.promoCodeRedemption.count(), 0);
      assert.equal(
        f.sqlite.prepare("SELECT stock FROM ProductVariant").get()!.stock,
        10,
      );
    });
  } finally {
    f.sqlite.close();
  }
});
test("late redemption SQL failure rolls back stock/order/items/cart/audit and usage together", async () => {
  const f = fixture();
  try {
    await f.run(async () => {
      await new PromoCodeService().save(WEB_ADMIN_ACTOR, promo);
      await cart();
      const revision = f.sqlite.prepare("SELECT version FROM _Revision").get()!
        .version;
      f.sqlite.exec(
        "CREATE TRIGGER fail_redemption BEFORE INSERT ON PromoCodeRedemption BEGIN SELECT RAISE(ABORT,'fixture redemption failure'); END;",
      );
      await assert.rejects(checkout(), /fixture redemption failure/);
      assert.equal(await prisma.order.count(), 0);
      assert.equal(await prisma.orderItem.count(), 0);
      assert.equal(await prisma.promoCodeRedemption.count(), 0);
      assert.equal(await prisma.cartItem.count(), 1);
      assert.equal(
        f.sqlite.prepare("SELECT stock FROM ProductVariant").get()!.stock,
        10,
      );
      assert.equal(
        f.sqlite.prepare("SELECT version FROM _Revision").get()!.version,
        revision,
      );
    });
  } finally {
    f.sqlite.close();
  }
});
test("promo doesn't reduce cargo; unchanged payment review uses discounted prepayment and final balance", async () => {
  const f = fixture();
  try {
    await f.run(async () => {
      await new PromoCodeService().save(WEB_ADMIN_ACTOR, promo);
      await cart();
      const o = (await checkout()).order;
      const payments = new D1PaymentRepository();
      const pre = await payments.submit({
        userId: "a",
        orderPublicId: o.publicId,
        idempotencyKey: randomUUID(),
        proofStorageKey: "fixture-pre.png",
        proofMimeType: "image/png",
      });
      assert.equal(pre.payment.expectedAmount, 112501);
      await payments.approve(pre.payment.id, WEB_ADMIN_ACTOR);
      f.sqlite
        .prepare('UPDATE "Order" SET status=? WHERE id=?')
        .run("WEIGHING", o.id);
      await payments.requestFinalPayment(o.publicId, 30000, WEB_ADMIN_ACTOR);
      const final = await payments.submit({
        userId: "a",
        orderPublicId: o.publicId,
        idempotencyKey: randomUUID(),
        proofStorageKey: "fixture-final.png",
        proofMimeType: "image/png",
      });
      assert.equal(final.payment.expectedAmount, 142500);
      await payments.approve(final.payment.id, WEB_ADMIN_ACTOR);
      const paid = (await new D1OrderRepository().getForUser("a", o.publicId))!;
      assert.equal(paid.paidAmount, 225001);
      assert.equal(paid.cargoPaidAmount, 30000);
      assert.equal(paid.remainingAmount, 0);
      assert.equal(paid.discountAmount, 25000);
    });
  } finally {
    f.sqlite.close();
  }
});
test("migrations 0008–0010 preserve existing orders, prices and business rows with neutral defaults", () => {
  const db = new DatabaseSync(":memory:");
  try {
    const dir = new URL("../migrations/", import.meta.url),
      files = readdirSync(dir).sort();
    for (const name of files.filter((f) => f < "0008"))
      db.exec(readFileSync(new URL(name, dir), "utf8"));
    db.exec(
      `INSERT INTO User(id,telegramId,updatedAt) VALUES('existing',100,1); INSERT INTO "Order"(id,publicId,userId,idempotencyKey,fullName,phone,city,address,subtotal,total,requiredPrepayment,remainingAmount,updatedAt) VALUES('old','OLD','existing','old-key','Old','1234567','Test','Test',290001,290001,145001,145000,1);`,
    );
    db.exec(
      `INSERT INTO OrderItem(id,orderId,productNameRu,productNameUz,productSlug,sku,size,unitPrice,quantity,lineTotal) VALUES('old-item','old','История','Tarix','old','old-sku','M',290001,1,290001); INSERT INTO Payment(id,orderId,type,status,expectedAmount,idempotencyKey,proofStorageKey,proofMimeType,updatedAt) VALUES('old-payment','old','PREPAYMENT','APPROVED',145001,'old-payment-key','isolated-old.png','image/png',1);`,
    );
    const oldItem = db.prepare("SELECT * FROM OrderItem").get()!,
      oldPayment = db.prepare("SELECT * FROM Payment").get()!;
    const old = db.prepare('SELECT * FROM "Order"').get()!;
    for (const name of files.filter((f) => f >= "0008"))
      db.exec(readFileSync(new URL(name, dir), "utf8"));
    const current = db.prepare('SELECT * FROM "Order"').get()!;
    for (const key of Object.keys(old)) assert.equal(current[key], old[key]);
    for (const [table, prior] of [
      ["OrderItem", oldItem],
      ["Payment", oldPayment],
    ] as const) {
      const after = db.prepare(`SELECT * FROM ${table}`).get()!;
      for (const key of Object.keys(prior))
        assert.equal(after[key], prior[key]);
    }
    assert.equal(
      db.prepare("SELECT originalUnitPrice FROM OrderItem").get()!
        .originalUnitPrice,
      null,
    );
    assert.equal(current.itemsSubtotal, null);
    assert.equal(current.discountAmount, 0);
    assert.equal(current.promoCodeSnapshot, null);
    for (const table of ["Banner", "PromoCode", "PromoCodeRedemption"])
      assert.equal(db.prepare(`SELECT count(*) n FROM ${table}`).get()!.n, 0);
  } finally {
    db.close();
  }
});

let runtime: Awaited<ReturnType<typeof marketingRuntime>>;
before(async () => {
  runtime = await marketingRuntime();
});
after(async () => {
  await runtime?.mf.dispose();
});
let uid = 830000;
async function login() {
  const params = new URLSearchParams({
    auth_date: String(Math.floor(Date.now() / 1000)),
    user: JSON.stringify({ id: ++uid, first_name: "Isolated promo" }),
  });
  const text = [...params]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");
  params.set(
    "hash",
    createHmac(
      "sha256",
      createHmac("sha256", "WebAppData").update(runtime.botToken).digest(),
    )
      .update(text)
      .digest("hex"),
  );
  const response = await runtime.call(
    "/auth/telegram",
    "POST",
    { initData: params.toString() },
    {},
    "https://preview.invalid",
  );
  assert.equal(response.status, 200, await response.clone().text());
  return ((await response.json()) as { accessToken: string }).accessToken;
}
const userCall = (token: string, path: string, body: unknown, headers = {}) =>
  runtime.call(
    path,
    "POST",
    body,
    { authorization: "Bearer " + token, ...headers },
    "https://preview.invalid",
  );
test("isolated Worker enforces user JWT/strict current-cart body and Admin auth/CSRF; no promo DELETE", async () => {
  assert.equal(
    (await runtime.call("/promo-codes/validate", "POST", { code: "TEST" }))
      .status,
    401,
  );
  assert.equal(
    (await runtime.call("/admin/marketing/promo-codes")).status,
    401,
  );
  const noCsrf = { ...runtime.signed };
  delete (noCsrf as Partial<typeof noCsrf>)["x-csrf-token"];
  assert.equal(
    (await runtime.call("/admin/marketing/promo-codes", "POST", promo, noCsrf))
      .status,
    403,
  );
  const token = await login();
  assert.equal(
    (
      await userCall(token, "/promo-codes/validate", {
        code: "TEST",
        userId: "someone",
        subtotal: 100000,
      })
    ).status,
    400,
  );
  const create = await runtime.admin("/marketing/promo-codes", "POST", promo);
  assert.equal(create.status, 201, await create.clone().text());
  const p = ((await create.json()) as { promoCode: { id: string } }).promoCode;
  assert.equal(
    (await runtime.admin(`/marketing/promo-codes/${p.id}`, "DELETE")).status,
    404,
  );
  const validation = await userCall(token, "/promo-codes/validate", {
    code: "STENZO-10",
  });
  assert.deepEqual(await validation.json(), {
    valid: false,
    reason: "PROMO_EMPTY_CART",
    cartVersion: null,
  });
  assert.equal(
    (await runtime.db
      .prepare("SELECT count(*) n FROM Cart")
      .first<{ n: number }>())!.n,
    0,
  );
});
test("real isolated Worker concurrency limit=1 and same-key replay preserves one redemption", async () => {
  const code = "LAST-ONE";
  await runtime.admin("/marketing/promo-codes", "POST", {
    ...promo,
    code,
    usageLimit: 1,
  });
  const a = await login(),
    b = await login();
  await runtime.db
    .prepare(
      "INSERT INTO Category(id,nameRu,nameUz,slug,updatedAt) VALUES('pc','Test','Sinov','pc',1)",
    )
    .run();
  await runtime.db
    .prepare(
      "INSERT INTO Product(id,categoryId,nameRu,nameUz,slug,price,salePrice,status,updatedAt) VALUES('pp','pc','Тест','Sinov','pp',290001,250001,'ACTIVE',1)",
    )
    .run();
  await runtime.db
    .prepare(
      "INSERT INTO ProductVariant(id,productId,sku,size,stock,isActive,updatedAt) VALUES('pv','pp','isolated-promo','M',10,1,1)",
    )
    .run();
  for (const token of [a, b])
    assert.equal(
      (
        await userCall(token, "/cart/items", {
          productId: "pp",
          variantId: "pv",
          quantity: 1,
          heightCm: 180,
          weightKg: 75,
        })
      ).status,
      201,
    );
  const keys = [randomUUID(), randomUUID()];
  const responses = await Promise.all(
    [a, b].map((token, i) =>
      userCall(
        token,
        "/checkout",
        { ...recipient, promoCode: code },
        { "idempotency-key": keys[i] },
      ),
    ),
  );
  assert.deepEqual(responses.map((r) => r.status).sort(), [201, 409]);
  const winner = responses.findIndex((r) => r.status === 201),
    winningOrder = (
      (await responses[winner]!.json()) as {
        order: { publicId: string; total: number };
      }
    ).order;
  assert.equal(winningOrder.total, 225001);
  const replay = await userCall(
    [a, b][winner]!,
    "/checkout",
    { ...recipient, promoCode: "EXPIRED-OTHER" },
    { "idempotency-key": keys[winner] },
  );
  assert.equal(replay.status, 201);
  assert.equal(
    ((await replay.json()) as { order: { publicId: string } }).order.publicId,
    winningOrder.publicId,
  );
  assert.equal(
    (await runtime.db
      .prepare("SELECT count(*) n FROM PromoCodeRedemption")
      .first<{ n: number }>())!.n,
    1,
  );
  assert.equal(
    (await runtime.db
      .prepare("SELECT stock FROM ProductVariant WHERE id='pv'")
      .first<{ stock: number }>())!.stock,
    9,
  );
  assert.equal(
    (await runtime.db
      .prepare("SELECT count(*) n FROM CartItem")
      .first<{ n: number }>())!.n,
    1,
  );
});

test("concurrent identical idempotency key creates one order/redemption and decrements stock once", async () => {
  const f = fixture();
  try {
    await f.run(async () => {
      await new PromoCodeService().save(WEB_ADMIN_ACTOR, promo);
      await cart();
      const key = randomUUID();
      const [a, b] = await Promise.all([
        checkout("a", "STENZO-10", key),
        checkout("a", "STENZO-10", key),
      ]);
      assert.equal(a.order.id, b.order.id);
      assert.equal(await prisma.order.count(), 1);
      assert.equal(await prisma.promoCodeRedemption.count(), 1);
      assert.equal(
        f.sqlite.prepare("SELECT stock FROM ProductVariant").get()!.stock,
        9,
      );
    });
  } finally {
    f.sqlite.close();
  }
});
test("expired-after-validation and stock conflict never redeem code or clear cart", async () => {
  const f = fixture();
  try {
    await f.run(async () => {
      const service = new PromoCodeService(),
        p = await service.save(WEB_ADMIN_ACTOR, promo);
      await cart();
      assert.equal((await service.validateCart("a", "STENZO-10")).valid, true);
      await service.save(
        WEB_ADMIN_ACTOR,
        { ...promo, endsAt: "2020-01-01T00:00:00Z" },
        p.id,
      );
      await assert.rejects(
        checkout(),
        (e: unknown) =>
          e instanceof PromoUnavailableError && e.reason === "PROMO_EXPIRED",
      );
      await service.save(WEB_ADMIN_ACTOR, promo, p.id);
      f.sqlite.exec("UPDATE ProductVariant SET stock=0 WHERE id='v'");
      await assert.rejects(checkout());
      assert.equal(await prisma.order.count(), 0);
      assert.equal(await prisma.promoCodeRedemption.count(), 0);
      assert.equal(await prisma.cartItem.count(), 1);
    });
  } finally {
    f.sqlite.close();
  }
});
test("D1 validates minimum against sale subtotal and applies percent cap at checkout", async () => {
  const f = fixture();
  try {
    await f.run(async () => {
      const service = new PromoCodeService(),
        p = await service.save(WEB_ADMIN_ACTOR, {
          ...promo,
          minOrderAmount: 290000,
        });
      const snapshot = toCartDto(await cart());
      assert.deepEqual(await service.validateCart("a", "STENZO-10"), {
        valid: false,
        reason: "PROMO_MINIMUM",
        cartVersion: cartSnapshotVersion(snapshot),
      });
      await assert.rejects(checkout(), PromoUnavailableError);
      await service.save(
        WEB_ADMIN_ACTOR,
        { ...promo, maxDiscount: 10000 },
        p.id,
      );
      assert.equal((await checkout()).order.discountAmount, 10000);
    });
  } finally {
    f.sqlite.close();
  }
});

test("commerce-off validation still requires a normal Telegram JWT, reads existing cart only and cannot expose checkout", async () => {
  const f = await marketingRuntime("0");
  try {
    assert.equal(
      (await f.call("/promo-codes/validate", "POST", { code: "TEST" })).status,
      401,
    );
    assert.equal((await f.call("/checkout", "POST", recipient)).status, 503);
    for (const path of ["/orders", "/payments", "/payment-instructions"])
      assert.equal((await f.call(path)).status, 503);
    assert.equal(
      (await f.db
        .prepare("SELECT count(*) n FROM Cart")
        .first<{ n: number }>())!.n,
      0,
    );
  } finally {
    await f.mf.dispose();
  }
});

for (const sameTotal of [false, true])
  test(`QA-001 D1 quote identifies authoritative ${sameTotal ? "same-total variant" : "quantity"} snapshot without business writes`, async () => {
    const f = fixture();
    try {
      await f.run(async () => {
        const service = new PromoCodeService();
        await service.save(WEB_ADMIN_ACTOR, promo);
        const old = toCartDto(await cart());
        const before = await service.validateCart("a", "STENZO-10");
        assert.equal(before.cartVersion, cartSnapshotVersion(old));
        if (sameTotal) {
          // Isolated fixture represents a second tab replacing a variant at equal price.
          f.sqlite.exec(
            "INSERT INTO ProductVariant(id,productId,sku,size,stock,isActive,updatedAt) VALUES('other','p','fixture-other','L',10,1,1)",
          );
          f.sqlite
            .prepare("UPDATE CartItem SET variantId='other' WHERE id=?")
            .run(old.items[0]!.id);
        } else {
          await new D1CartRepository().updateItem("a", old.items[0]!.id, {
            quantity: 2,
          });
        }
        const fresh = toCartDto(await new D1CartRepository().getOrCreate("a"));
        const revision = f.sqlite
          .prepare("SELECT version FROM _Revision")
          .get()!.version;
        const stock = f.sqlite
          .prepare("SELECT id,stock FROM ProductVariant ORDER BY id")
          .all();
        const after = await service.validateCart("a", "STENZO-10");
        assert.equal(after.valid, true);
        assert.notEqual(after.cartVersion, before.cartVersion);
        assert.equal(after.cartVersion, cartSnapshotVersion(fresh));
        if (after.valid) assert.equal(after.subtotal, fresh.subtotal);
        if (sameTotal) assert.equal(old.subtotal, fresh.subtotal);
        assert.equal(
          f.sqlite.prepare("SELECT version FROM _Revision").get()!.version,
          revision,
        );
        assert.equal(await prisma.order.count(), 0);
        assert.equal(await prisma.promoCodeRedemption.count(), 0);
        assert.deepEqual(
          f.sqlite
            .prepare("SELECT id,stock FROM ProductVariant ORDER BY id")
            .all(),
          stock,
        );
        assert.deepEqual(await service.validateCart("b", "STENZO-10"), {
          valid: false,
          reason: "PROMO_EMPTY_CART",
          cartVersion: null,
        });
      });
    } finally {
      f.sqlite.close();
    }
  });
