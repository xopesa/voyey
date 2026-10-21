import test from "node:test";
import assert from "node:assert/strict";
import { prisma } from "@stenzo/database";
import {
  effectiveProductPrice,
  validPromotion,
  promotionStatus,
  toTashkentInput,
  fromTashkentInput,
} from "@stenzo/shared";
import { isolatedD1 } from "./helpers/sqlite.js";
import {
  D1AdminCatalogRepository,
  D1CartRepository,
  D1OrderRepository,
} from "../../api/src/d1/repositories.js";
import { toCartDto } from "../../api/src/modules/cart/service.js";
import { toProductDto } from "../../api/src/modules/catalog/service.js";
import { prepareOrder } from "../../api/src/modules/checkout/domain.js";
import { toOrderDto } from "../../api/src/modules/orders/service.js";
import { productPhotoPost } from "../../api/src/modules/telegram-channel/publisher.js";
import {
  productCreateSchema,
  productPatchSchema,
} from "../../api/src/modules/admin/catalog/schemas.js";
import { WEB_ADMIN_ACTOR } from "../../api/src/modules/admin/web-session.js";
import { marketingRuntime } from "./helpers/marketing-runtime.js";

const now = Date.parse("2026-10-20T12:00:00Z");
const base = {
  price: 290001,
  salePrice: 250001,
  saleStartsAt: new Date(now - 1000),
  saleEndsAt: new Date(now + 1000),
};
for (const [name, product, expected] of [
  ["no sale", { price: 290001 }, 290001],
  ["active", base, 250001],
  ["scheduled", { ...base, saleStartsAt: new Date(now + 100) }, 290001],
  ["expired", { ...base, saleEndsAt: new Date(now) }, 290001],
  ["inclusive start", { ...base, saleStartsAt: new Date(now) }, 250001],
  ["no dates", { price: 290001, salePrice: 250001 }, 250001],
  ["only start", { ...base, saleEndsAt: null }, 250001],
  ["only end", { ...base, saleStartsAt: null }, 250001],
  ["invalid legacy price fails closed", { price: 100, salePrice: 200 }, 100],
] as const)
  test(`effective price: ${name}`, () =>
    assert.equal(effectiveProductPrice(product, now).effectivePrice, expected));

test("validation rejects nonpositive/equal/greater prices, reversed or invalid periods and orphan dates", () => {
  for (const salePrice of [0, -1, 290001, 300000, 1.5, NaN])
    assert.equal(validPromotion({ ...base, salePrice }), false);
  for (const saleStartsAt of [
    new Date(now + 1000),
    new Date(now + 2000),
    new Date(NaN),
  ])
    assert.equal(validPromotion({ ...base, saleStartsAt }), false);
  assert.equal(
    validPromotion({ price: 100, saleEndsAt: new Date(now) }),
    false,
  );
  assert.equal(promotionStatus(base, now), "active");
  assert.equal(
    promotionStatus({ ...base, saleStartsAt: new Date(now + 500) }, now),
    "scheduled",
  );
  assert.equal(promotionStatus(base, now + 1000), "expired");
});
test("Tashkent editor roundtrips UTC and rejects invalid local date/time", () => {
  assert.equal(toTashkentInput(new Date(now)), "2026-10-20T17:00");
  assert.equal(
    fromTashkentInput("2026-10-20T17:00"),
    new Date(now).toISOString(),
  );
  assert.throws(() => fromTashkentInput("2026-02-31T17:00"));
  assert.throws(() => fromTashkentInput("2026-10-20"));
});
test("Admin schemas accept UTC dates and reject decimal sale prices and injected fields", () => {
  assert.equal(productPatchSchema.safeParse({ salePrice: 1.5 }).success, false);
  assert.equal(
    productPatchSchema.safeParse({ saleStartsAt: "2026-10-20T17:00" }).success,
    false,
  );
  assert.equal(
    productPatchSchema.safeParse({ salePrice: 100, userId: "someone" }).success,
    false,
  );
  assert.equal(
    productCreateSchema.safeParse({
      categoryId: "c",
      nameRu: "Test",
      nameUz: "Sinov",
      slug: "test",
      price: 200,
      salePrice: 100,
      saleStartsAt: "2026-10-20T12:00:00Z",
    }).success,
    true,
  );
});

test("D1 promotion saves atomically, rejects base price conflicts, audits changes/clear once", async () => {
  const f = isolatedD1();
  try {
    await f.run(async () => {
      const repo = new D1AdminCatalogRepository();
      const category = await repo.createCategory(WEB_ADMIN_ACTOR, {
        nameRu: "Test",
        nameUz: "Sinov",
        slug: "fixture",
        isActive: true,
        sortOrder: 0,
      });
      const p = await repo.createProduct(WEB_ADMIN_ACTOR, {
        categoryId: category.id,
        nameRu: "Тест",
        nameUz: "Sinov",
        slug: "fixture",
        descriptionRu: null,
        descriptionUz: null,
        sourceUrl: null,
        price: 290001,
        currency: "UZS",
        status: "ACTIVE",
        isFeatured: false,
      });
      await repo.updateProduct(WEB_ADMIN_ACTOR, p.id, { salePrice: 250001 });
      await repo.updateProduct(WEB_ADMIN_ACTOR, p.id, { salePrice: 250001 });
      await assert.rejects(
        repo.updateProduct(WEB_ADMIN_ACTOR, p.id, { price: 100 }),
      );
      await assert.rejects(
        repo.updateProduct(WEB_ADMIN_ACTOR, p.id, { salePrice: 300000 }),
      );
      await repo.updateProduct(WEB_ADMIN_ACTOR, p.id, {
        salePrice: null,
        saleStartsAt: null,
        saleEndsAt: null,
      });
      for (const action of [
        "product.promotion.update",
        "product.promotion.clear",
      ])
        assert.equal(await prisma.auditLog.count({ where: { action } }), 1);
      assert.equal((await repo.getProduct(p.id))!.price, 290001);
    });
  } finally {
    f.sqlite.close();
  }
});

test("D1 catalog/cart use live sale; checkout snapshots sale and original price; historical order ignores edits", async () => {
  const f = isolatedD1();
  try {
    await f.run(async () => {
      f.sqlite.exec(
        `INSERT INTO User(id,telegramId,updatedAt) VALUES('buyer',123,1); INSERT INTO Category(id,nameRu,nameUz,slug,updatedAt) VALUES('c','Test','Sinov','c',1); INSERT INTO Product(id,categoryId,nameRu,nameUz,slug,price,status,salePrice,updatedAt) VALUES('p','c','Тест','Sinov','p',290001,'ACTIVE',250001,1); INSERT INTO ProductVariant(id,productId,sku,size,isActive,stock,updatedAt) VALUES('v','p','sku','M',1,10,1);`,
      );
      const carts = new D1CartRepository(),
        orders = new D1OrderRepository();
      let cart = await carts.addItem("buyer", {
        productId: "p",
        variantId: "v",
        quantity: 1,
        heightCm: 180,
        weightKg: 75,
      });
      assert.equal(toCartDto(cart).subtotal, 250001);
      const product = await new D1AdminCatalogRepository().getProduct("p");
      assert.equal(toProductDto(product!).price, 290001);
      assert.equal(toProductDto(product!).effectivePrice, 250001);
      f.sqlite.exec(`UPDATE Product SET saleEndsAt=1 WHERE id='p'`);
      cart = await carts.getOrCreate("buyer");
      assert.equal(toCartDto(cart).subtotal, 290001);
      f.sqlite.exec(`UPDATE Product SET saleEndsAt=NULL WHERE id='p'`);
      const result = await orders.checkout({
        userId: "buyer",
        publicId: "STZ-ISOLATED",
        idempotencyKey: "isolated-key-123456789",
        recipient: {
          fullName: "Fixture",
          phone: "+998900000000",
          city: "Test",
          address: "Test",
          apartment: null,
          comment: null,
        },
        prepare: prepareOrder,
      });
      assert.equal(result.order.total, 250001);
      assert.equal(result.order.requiredPrepayment, 125001);
      assert.equal(result.order.remainingAmount, 125000);
      assert.equal(result.order.items[0]!.unitPrice, 250001);
      assert.equal(result.order.items[0]!.originalUnitPrice, 290001);
      f.sqlite.exec(
        `UPDATE Product SET price=400000,salePrice=NULL WHERE id='p'`,
      );
      const old = toOrderDto(
        (await orders.getForUser("buyer", "STZ-ISOLATED"))!,
      );
      assert.equal(old.total, 250001);
      assert.equal(old.items[0]!.originalUnitPrice, 290001);
      assert.equal(old.items[0]!.unitPrice, 250001);
    });
  } finally {
    f.sqlite.close();
  }
});

test("new Telegram publication uses effective UZ price with existing photo/deep link contract", async () => {
  const f = isolatedD1();
  try {
    await f.run(async () => {
      f.sqlite.exec(
        `INSERT INTO Category(id,nameRu,nameUz,slug,updatedAt) VALUES('c','Test','Sinov','c',1); INSERT INTO Product(id,categoryId,nameRu,nameUz,slug,price,status,salePrice,updatedAt) VALUES('p','c','Тест','Sport shim','p',290000,'ACTIVE',250000,1); INSERT INTO ProductVariant(id,productId,sku,size,isActive,updatedAt) VALUES('v','p','sku','M',1,1); INSERT INTO ProductImage(id,productId,url) VALUES('i','p','https://preview.invalid/media/products/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa.png');`,
      );
      const p = (await new D1AdminCatalogRepository().getProduct("p"))!;
      f.sqlite.exec("UPDATE Product SET costPrice=73001 WHERE id='p'");
      p.costPrice = 73001;
      const post = productPhotoPost(
        p,
        "https://preview.invalid",
        "fixture_bot",
        "fixture_sales",
      );
      assert.match(post.caption, /250 000 so‘m/);
      assert.doesNotMatch(post.caption, /290 000/);
      assert.doesNotMatch(
        JSON.stringify(post),
        /73001|73 001|costPrice|procurementUnitCost/,
      );
      assert.equal(
        post.reply_markup.inline_keyboard[0]![0]!.text,
        "Sotib olish",
      );
    });
  } finally {
    f.sqlite.close();
  }
});

test("isolated Worker protects promotion mutations, public catalog returns effective price with commerce disabled", async () => {
  const f = await marketingRuntime("0");
  try {
    const c = await f.admin("/catalog/categories", "POST", {
      nameRu: "Test",
      nameUz: "Sinov",
      slug: "fixture",
    });
    const categoryId = ((await c.json()) as { category: { id: string } })
      .category.id;
    const p = await f.admin("/catalog/products", "POST", {
      categoryId,
      nameRu: "Test",
      nameUz: "Sinov",
      slug: "fixture",
      price: 290001,
      salePrice: 250001,
    });
    assert.equal(p.status, 201, await p.clone().text());
    const id = ((await p.json()) as { product: { id: string } }).product.id;
    assert.equal(
      (await f.call(`/admin/catalog/products/${id}`, "PATCH", { salePrice: 1 }))
        .status,
      401,
    );
    const noCsrf = { ...f.signed };
    delete (noCsrf as Partial<typeof noCsrf>)["x-csrf-token"];
    assert.equal(
      (
        await f.call(
          `/admin/catalog/products/${id}`,
          "PATCH",
          { salePrice: 1 },
          noCsrf,
        )
      ).status,
      403,
    );
    assert.equal(
      (await f.admin(`/catalog/products/${id}`, "PATCH", { salePrice: 300000 }))
        .status,
      400,
    );
    await f.admin(`/catalog/products/${id}/activate`, "POST");
    const result = await f.call(
      "/catalog/products/fixture",
      "GET",
      undefined,
      {},
      "https://preview.invalid",
    );
    assert.equal(result.status, 200);
    const dto = (
      (await result.json()) as {
        product: { price: number; effectivePrice: number };
      }
    ).product;
    assert.equal(dto.price, 290001);
    assert.equal(dto.effectivePrice, 250001);
    assert.equal((await f.call("/checkout", "POST", {})).status, 503);
  } finally {
    await f.mf.dispose();
  }
});
