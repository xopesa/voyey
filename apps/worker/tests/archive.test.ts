import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma } from "@stenzo/database";
import { financeFixture, financeSeed } from "./helpers/finance.js";
import { marketingRuntime } from "./helpers/marketing-runtime.js";
import { CatalogArchiveService } from "../../api/src/modules/admin/catalog/archive.js";
import { PrismaCatalogRepository } from "../../api/src/modules/catalog/repository.js";
import {
  D1AdminCatalogRepository,
  D1CartRepository,
  D1OrderRepository,
} from "../../api/src/d1/repositories.js";
import { AdminCatalogService } from "../../api/src/modules/admin/catalog/service.js";
import { ManualOrderService } from "../../api/src/modules/admin/manual-orders.js";
import { prepareOrder } from "../../api/src/modules/checkout/domain.js";
import { publicBanners } from "../../api/src/modules/marketing/banners.js";
import { productPhotoPost } from "../../api/src/modules/telegram-channel/publisher.js";
import { toCartDto } from "../../api/src/modules/cart/service.js";
import { WEB_ADMIN_ACTOR } from "../../api/src/modules/admin/web-session.js";
const actor = WEB_ADMIN_ACTOR,
  s = new CatalogArchiveService(),
  catalog = new PrismaCatalogRepository(),
  repo = new D1AdminCatalogRepository();
const seed = `INSERT INTO Category(id,nameRu,nameUz,slug,updatedAt) VALUES('c','Брюки','Shim','c',1),('empty','Пусто','Bosh','empty',1);
INSERT INTO Product(id,categoryId,nameRu,nameUz,slug,price,status,isFeatured,updatedAt) VALUES('p','c','Брюки','Shim','p',100001,'ACTIVE',1,1);
INSERT INTO ProductVariant(id,productId,sku,size,stock,isActive,updatedAt) VALUES('v','p','ARC-M','M',10,1,1);
INSERT INTO ProductImage(id,productId,url,isPrimary) VALUES('image','p','https://preview.invalid/image.png',1);
INSERT INTO TelegramProductPost(id,productId,channelChatId,status,messageId,attemptId,publishedAt,lastAttemptAt,createdAt,updatedAt) VALUES('post','p','-1001','PUBLISHED',1,'fixture',1,1,1,1);
UPDATE OrderItem SET productId='p',variantId='v' WHERE id='i';`;
function fixture() {
  const f = financeFixture();
  f.sqlite.exec(seed);
  return f;
}
const line = {
  productId: "p",
  variantId: "v",
  quantity: 1,
  heightCm: 180,
  weightKg: 75,
};
const recipient = {
  fullName: "Isolated",
  phone: "+998900000000",
  city: "Fixture",
  address: "Fixture address",
  apartment: null,
  comment: null,
};
test("product archive is audited/idempotent, inactive/unfeatured; images/variants/posts and historical order snapshots unchanged", async () => {
  const f = fixture();
  try {
    await f.run(async () => {
      const before = f.sqlite.prepare("SELECT * FROM OrderItem").all(),
        history = f.sqlite.prepare("SELECT * FROM TelegramProductPost").all();
      const a = await s.product("p", actor, true),
        b = await s.product("p", actor, true);
      assert.equal(a.status, "INACTIVE");
      assert.equal(a.isFeatured, false);
      assert.ok(a.archivedAt);
      assert.equal(a.archivedAt!.getTime(), b.archivedAt!.getTime());
      assert.equal(a.images.length, 1);
      assert.equal(a.variants.length, 1);
      assert.deepEqual(
        f.sqlite.prepare("SELECT * FROM OrderItem").all(),
        before,
      );
      assert.deepEqual(
        f.sqlite.prepare("SELECT * FROM TelegramProductPost").all(),
        history,
      );
      assert.equal(
        await prisma.auditLog.count({ where: { action: "product.archived" } }),
        1,
      );
      assert.equal(
        (await catalog.listActiveProducts({ limit: 20 })).products.length,
        0,
      );
      assert.equal(await catalog.getActiveProductBySlug("p"), null);
      assert.equal((await repo.listProducts({ limit: 20 })).products.length, 0);
      assert.equal(
        (await repo.listProducts({ limit: 20, archive: "archived" })).products
          .length,
        1,
      );
    });
  } finally {
    f.sqlite.close();
  }
});
test("archived product blocks Add Cart, checkout of existing cart, Manual Order, activation/update and Telegram without calling provider", async () => {
  const f = fixture();
  try {
    await f.run(async () => {
      const cart = new D1CartRepository();
      await cart.addItem("finance-user", line);
      await s.product("p", actor, true);
      assert.equal(
        toCartDto(await cart.getOrCreate("finance-user")).items[0]!.isAvailable,
        false,
      );
      await assert.rejects(cart.addItem("finance-user", line));
      await assert.rejects(
        new D1OrderRepository().checkout({
          userId: "finance-user",
          idempotencyKey: randomUUID(),
          publicId: "STZ-ARCHIVE-CHECKOUT",
          recipient,
          prepare: prepareOrder,
        }),
      );
      await assert.rejects(
        new ManualOrderService().create(actor, randomUUID(), {
          userId: "finance-user",
          recipient,
          items: [line],
        }),
      );
      await assert.rejects(repo.setProductStatus(actor, "p", "ACTIVE"));
      await assert.rejects(
        repo.updateProduct(actor, "p", { status: "ACTIVE" }),
      );
      let publishes = 0;
      const admin = new AdminCatalogService(repo, undefined, {
        getPublication: async () => ({
          status: "NOT_PUBLISHED",
          retryAllowed: true,
        }),
        publishProduct: async () => {
          publishes++;
          return { status: "PENDING", retryAllowed: false };
        },
      });
      await assert.rejects(admin.publishTelegram(actor, "p"));
      assert.equal(publishes, 0);
      const archived = (await repo.getProduct("p"))!;
      assert.throws(() =>
        productPhotoPost(
          { ...archived, status: "ACTIVE" },
          "https://preview.invalid",
          "fixture_bot",
          "fixture_sales",
        ),
      );
      assert.equal(await prisma.order.count(), 1);
    });
  } finally {
    f.sqlite.close();
  }
});
test("restore product clears archive but stays INACTIVE/unfeatured with no auto publication and stable repeat audit", async () => {
  const f = fixture();
  try {
    await f.run(async () => {
      await s.product("p", actor, true);
      const a = await s.product("p", actor, false);
      await s.product("p", actor, false);
      assert.equal(a.archivedAt, null);
      assert.equal(a.status, "INACTIVE");
      assert.equal(a.isFeatured, false);
      assert.equal(
        (await catalog.listActiveProducts({ limit: 20 })).products.length,
        0,
      );
      assert.equal(
        await prisma.auditLog.count({ where: { action: "product.restored" } }),
        1,
      );
    });
  } finally {
    f.sqlite.close();
  }
});
test("category nonarchived children (including INACTIVE) conflict; empty archive allowed, hide and restore stays inactive", async () => {
  const f = fixture();
  try {
    await f.run(async () => {
      await assert.rejects(s.category("c", actor, true));
      await repo.setProductStatus(actor, "p", "INACTIVE");
      await assert.rejects(s.category("c", actor, true));
      await s.product("p", actor, true);
      const a = await s.category("c", actor, true);
      await s.category("c", actor, true);
      assert.equal(a.isActive, false);
      assert.ok(a.archivedAt);
      assert.equal(
        (await catalog.listActiveCategories()).some((c) => c.id === "c"),
        false,
      );
      await assert.rejects(repo.setCategoryActive(actor, "c", true));
      await assert.rejects(s.product("p", actor, false));
      const restore = await s.category("c", actor, false);
      assert.equal(restore.archivedAt, null);
      assert.equal(restore.isActive, false);
      await s.category("empty", actor, true);
      await s.category("empty", actor, false);
      assert.equal(
        (await prisma.category.findUniqueOrThrow({ where: { id: "empty" } }))
          .isActive,
        false,
      );
    });
  } finally {
    f.sqlite.close();
  }
});
test("archived category cannot receive a new or moved current product; concurrent restore cannot violate empty-category archive", async () => {
  const f = fixture();
  try {
    await f.run(async () => {
      await s.category("empty", actor, true);
      const source = (await repo.getProduct("p"))!;
      await assert.rejects(
        repo.createProduct(actor, {
          categoryId: "empty",
          nameRu: "Тест",
          nameUz: "Sinov",
          slug: "new",
          descriptionRu: null,
          descriptionUz: null,
          sourceUrl: null,
          price: 1,
          currency: "UZS",
          status: "DRAFT",
          isFeatured: false,
        }),
      );
      await assert.rejects(
        repo.updateProduct(actor, "p", { categoryId: "empty" }),
      );
      await s.product("p", actor, true);
      await Promise.allSettled([
        s.category("c", actor, true),
        s.product("p", actor, false),
      ]);
      const cat = await prisma.category.findUniqueOrThrow({
        where: { id: source.categoryId },
      });
      if (cat.archivedAt)
        assert.equal(
          await prisma.product.count({
            where: { categoryId: "c", archivedAt: null },
          }),
          0,
        );
    });
  } finally {
    f.sqlite.close();
  }
});
test("public Banner archived product/category href becomes null while banner record and endpoint survive; independent archive checks defend inconsistent active flags", async () => {
  const f = fixture();
  try {
    await f.run(async () => {
      f.sqlite.exec(
        `INSERT INTO Banner(id,titleRu,titleUz,imageUrl,storageKey,targetType,targetProductId,isActive,createdAt,updatedAt) VALUES('bp','Тест','Sinov','https://preview.invalid/b.png','b','PRODUCT','p',1,1,1);INSERT INTO Banner(id,titleRu,titleUz,imageUrl,storageKey,targetType,targetCategoryId,isActive,createdAt,updatedAt) VALUES('bc','Тест','Sinov','https://preview.invalid/b.png','c','CATEGORY','c',1,1,1)`,
      );
      assert.ok((await publicBanners()).every((b) => b.href));
      await s.product("p", actor, true);
      assert.equal(
        (await publicBanners()).find((b) => b.id === "bp")!.href,
        null,
      );
      await s.category("c", actor, true);
      assert.ok((await publicBanners()).every((b) => b.href === null));
      // Simulate external stale flags solely in disposable DB: archive itself remains authoritative.
      f.sqlite.exec(
        `UPDATE Product SET status='ACTIVE';UPDATE Category SET isActive=1 WHERE id='c'`,
      );
      assert.equal(await catalog.getActiveProductBySlug("p"), null);
      assert.equal(
        (await catalog.listActiveProducts({ limit: 20 })).products.length,
        0,
      );
      assert.equal(
        (await catalog.listActiveCategories()).some((c) => c.id === "c"),
        false,
      );
      assert.ok((await publicBanners()).every((b) => b.href === null));
      await assert.rejects(
        new D1CartRepository().addItem("finance-user", line),
      );
      assert.equal(await prisma.banner.count(), 2);
    });
  } finally {
    f.sqlite.close();
  }
});
test("actual Worker archive requires Admin + CSRF, preserves history and restore inactive; no hard delete route", async () => {
  const f = await marketingRuntime();
  try {
    for (const sql of (financeSeed + seed).split(";").filter((s) => s.trim()))
      await f.db.prepare(sql).run();
    for (const kind of ["products/p", "categories/empty"]) {
      const path = "/admin/catalog/" + kind + "/archive";
      assert.equal((await f.call(path, "POST")).status, 401);
      const h = { ...f.signed };
      delete (h as Record<string, string>)["x-csrf-token"];
      assert.equal((await f.call(path, "POST", undefined, h)).status, 403);
      assert.equal(
        (await f.admin("/catalog/" + kind + "/archive", "POST")).status,
        200,
      );
      assert.equal(
        (await f.admin("/catalog/" + kind + "/restore", "POST")).status,
        200,
      );
      assert.ok(
        [403, 404].includes(
          (await f.admin("/catalog/" + kind, "DELETE")).status,
        ),
      );
    }
    assert.equal(f.outboundCalls(), 0);
  } finally {
    await f.mf.dispose();
  }
});
