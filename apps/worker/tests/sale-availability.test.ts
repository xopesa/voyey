import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { prisma } from "@stenzo/database";
import { isolatedD1 } from "./helpers/sqlite.js";
import { marketingRuntime } from "./helpers/marketing-runtime.js";
import { runtimeUser } from "./helpers/customer-operations.js";
import {
  D1AdminCatalogRepository,
  D1CartRepository,
  D1OrderRepository,
} from "../../api/src/d1/repositories.js";
import { D1VariantGenerator } from "../../api/src/d1/variant-generator.js";
import { ManualOrderService } from "../../api/src/modules/admin/manual-orders.js";
import { prepareOrder } from "../../api/src/modules/checkout/domain.js";
import { CartStockExceededError } from "../../api/src/modules/cart/errors.js";
import { WEB_ADMIN_ACTOR } from "../../api/src/modules/admin/web-session.js";
import {
  variantCreateSchema,
  variantPatchSchema,
} from "../../api/src/modules/admin/catalog/schemas.js";

const recipient = {
  fullName: "Synthetic buyer",
  phone: "+998900000000",
  city: "Fixture",
  address: "Fixture street",
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
const seed = `INSERT INTO Category(id,nameRu,nameUz,slug,updatedAt) VALUES('c','Fixture','Fixture','c',1);
INSERT INTO Product(id,categoryId,nameRu,nameUz,slug,price,costPrice,status,updatedAt) VALUES('p','c','Fixture','Fixture','p',100001,42000,'ACTIVE',1);
INSERT INTO ProductImage(id,productId,url,isPrimary) VALUES('image','p','https://images.example.invalid/p.png',1);
INSERT INTO ProductVariant(id,productId,sku,size,color,stock,updatedAt) VALUES('v','p','AV-M','M','blue',2,1);`;
function fixture() {
  const f = isolatedD1();
  f.sqlite.exec(
    seed + "INSERT INTO User(id,telegramId,updatedAt) VALUES('u',12345,1);",
  );
  return f;
}

test("0017 preserves legacy variants, stock=NULL, prices, images and relations; defaults off and checks boolean values", () => {
  const sqlite = new DatabaseSync(":memory:");
  try {
    for (const file of readdirSync(
      new URL("../migrations/", import.meta.url),
    ).sort()) {
      if (file.startsWith("0017_")) {
        sqlite.exec(seed);
        sqlite.exec(
          "INSERT INTO ProductVariant(id,productId,sku,size,stock,updatedAt) VALUES('null','p','AV-NULL','L',NULL,1),('zero','p','AV-ZERO','S',0,1)",
        );
      }
      sqlite.exec(
        readFileSync(new URL("../migrations/" + file, import.meta.url), "utf8"),
      );
    }
    assert.deepEqual(
      sqlite
        .prepare(
          "SELECT id,stock,preorderEnabled FROM ProductVariant ORDER BY id",
        )
        .all()
        .map((r) => ({ ...r })),
      [
        { id: "null", stock: null, preorderEnabled: 0 },
        { id: "v", stock: 2, preorderEnabled: 0 },
        { id: "zero", stock: 0, preorderEnabled: 0 },
      ],
    );
    assert.equal(
      sqlite.prepare("SELECT price FROM Product").get()!.price,
      100001,
    );
    assert.equal(
      sqlite.prepare("SELECT costPrice FROM Product").get()!.costPrice,
      42000,
    );
    assert.equal(
      sqlite.prepare("SELECT url FROM ProductImage").get()!.url,
      "https://images.example.invalid/p.png",
    );
    assert.equal(
      sqlite.prepare("SELECT sku FROM ProductVariant WHERE id='v'").get()!.sku,
      "AV-M",
    );
    assert.equal(sqlite.prepare("PRAGMA foreign_key_check").all().length, 0);
    for (const value of [2, -1, "invalid", null])
      assert.throws(
        () =>
          sqlite
            .prepare("UPDATE ProductVariant SET preorderEnabled=? WHERE id='v'")
            .run(value),
        /CHECK constraint|NOT NULL/,
      );
    sqlite.exec("UPDATE ProductVariant SET preorderEnabled=1 WHERE id='v'");
    assert.equal(
      sqlite
        .prepare("SELECT preorderEnabled FROM ProductVariant WHERE id='v'")
        .get()!.preorderEnabled,
      1,
    );
  } finally {
    sqlite.close();
  }
});

test("Admin variant schemas accept an optional strict boolean; old payloads remain valid", () => {
  const old = { sku: "OLD-M", size: "M", stock: null };
  assert.equal(variantCreateSchema.parse(old).preorderEnabled, false);
  assert.deepEqual(variantPatchSchema.parse({ stock: 4 }), { stock: 4 });
  for (const value of [null, 0, 1, "true", "PREORDER", [], {}]) {
    assert.equal(
      variantCreateSchema.safeParse({ ...old, preorderEnabled: value }).success,
      false,
    );
    assert.equal(
      variantPatchSchema.safeParse({ preorderEnabled: value }).success,
      false,
    );
  }
  assert.deepEqual(variantPatchSchema.parse({ preorderEnabled: true }), {
    preorderEnabled: true,
  });
});

test("D1 variant CRUD keeps availability independent from SKU/stock/product and audits changes atomically", async () => {
  const f = fixture();
  try {
    await f.run(async () => {
      const repo = new D1AdminCatalogRepository();
      const variant = await repo.createVariant(WEB_ADMIN_ACTOR, "p", {
        sku: "AV-L",
        size: "L",
        color: null,
        stock: null,
        isActive: true,
      });
      assert.equal(variant.preorderEnabled, false);
      for (const enabled of [true, false, true]) {
        const updated = await repo.updateVariant(WEB_ADMIN_ACTOR, variant.id, {
          preorderEnabled: enabled,
        });
        assert.equal(updated.preorderEnabled, enabled);
        assert.equal(updated.stock, null);
        assert.equal(updated.sku, "AV-L");
        assert.equal(updated.productId, "p");
      }
      assert.equal(
        (await repo.updateVariant(WEB_ADMIN_ACTOR, variant.id, { stock: 5 }))
          .preorderEnabled,
        true,
      );
      const product = await repo.getProduct("p");
      assert.equal(product!.price, 100001);
      assert.equal(product!.costPrice, 42000);
      assert.equal(product!.images.length, 1);
      const updates = f.sqlite
        .prepare(
          "SELECT metadata FROM AuditLog WHERE action='product-variant.update' ORDER BY rowid",
        )
        .all();
      assert.deepEqual(
        updates
          .slice(0, 3)
          .map((r) => JSON.parse(String(r.metadata)).preorderEnabled),
        [true, false, true],
      );
      f.sqlite.exec(
        "CREATE TRIGGER fail_availability_audit BEFORE INSERT ON AuditLog WHEN NEW.action='product-variant.update' BEGIN SELECT RAISE(ABORT,'fixture-audit-failure'); END",
      );
      await assert.rejects(
        repo.updateVariant(WEB_ADMIN_ACTOR, variant.id, {
          preorderEnabled: false,
        }),
        /fixture-audit-failure/,
      );
      assert.equal(
        (
          await prisma.productVariant.findUniqueOrThrow({
            where: { id: variant.id },
          })
        ).preorderEnabled,
        true,
      );
    });
  } finally {
    f.sqlite.close();
  }
});

test("SKU generator keeps existing preorder permissions and defaults new variants off", async () => {
  const f = fixture();
  try {
    await f.run(async () => {
      await new D1AdminCatalogRepository().updateVariant(WEB_ADMIN_ACTOR, "v", {
        preorderEnabled: true,
        color: null,
      });
      const generator = new D1VariantGenerator();
      const input = {
        baseSku: "AV",
        sizes: ["M", "L"],
        colors: [],
        stock: 2,
        isActive: true,
      };
      const first = await generator.apply(WEB_ADMIN_ACTOR, "p", input);
      assert.equal(first.createdCount, 1);
      assert.equal(
        first.variants.find((v) => v.sku === "AV-M")!.preorderEnabled,
        true,
      );
      assert.equal(
        first.variants.find((v) => v.sku === "AV-L")!.preorderEnabled,
        false,
      );
      assert.equal(
        (await generator.apply(WEB_ADMIN_ACTOR, "p", input)).createdCount,
        0,
      );
    });
  } finally {
    f.sqlite.close();
  }
});

test("preorder permission cannot bypass finite stock in cart, checkout or manual orders", async () => {
  const f = fixture();
  try {
    await f.run(async () => {
      const catalog = new D1AdminCatalogRepository();
      const carts = new D1CartRepository();
      await carts.addItem("u", line);
      await catalog.updateVariant(WEB_ADMIN_ACTOR, "v", {
        stock: 0,
        preorderEnabled: true,
      });
      await assert.rejects(carts.addItem("u", line), CartStockExceededError);
      await assert.rejects(
        new D1OrderRepository().checkout({
          userId: "u",
          publicId: randomUUID(),
          idempotencyKey: randomUUID(),
          recipient,
          prepare: prepareOrder,
        }),
        CartStockExceededError,
      );
      await assert.rejects(
        new ManualOrderService().create(WEB_ADMIN_ACTOR, randomUUID(), {
          userId: "u",
          recipient,
          items: [line],
        }),
        CartStockExceededError,
      );
      assert.equal(await prisma.order.count(), 0);
      assert.equal(
        (await prisma.productVariant.findUniqueOrThrow({ where: { id: "v" } }))
          .stock,
        0,
      );
      assert.equal(await prisma.cartItem.count(), 1);
    });
  } finally {
    f.sqlite.close();
  }
});

test("legacy untracked-stock checkout remains unchanged and never creates a typed PREORDER", async () => {
  const f = fixture();
  try {
    await f.run(async () => {
      await new D1AdminCatalogRepository().updateVariant(WEB_ADMIN_ACTOR, "v", {
        stock: null,
      });
      const order = await new ManualOrderService().create(
        WEB_ADMIN_ACTOR,
        randomUUID(),
        { userId: "u", recipient, items: [line] },
      );
      assert.equal(order.requiredPrepayment, 50001);
      assert.equal(order.status, "AWAITING_PREPAYMENT");
      assert.equal(
        (await prisma.productVariant.findUniqueOrThrow({ where: { id: "v" } }))
          .stock,
        null,
      );
      assert.equal(
        (await prisma.productVariant.findUniqueOrThrow({ where: { id: "v" } }))
          .preorderEnabled,
        false,
      );
      assert.ok(!("saleMode" in order));
    });
  } finally {
    f.sqlite.close();
  }
});

test("actual Worker serves both catalog modes with commerce off; permission changes require Admin and CSRF", async () => {
  const f = await marketingRuntime("0");
  try {
    await f.db.exec(seed);
    assert.equal(
      (
        await f.call(
          "/admin/catalog/variants/v",
          "PATCH",
          { preorderEnabled: true },
          f.base,
        )
      ).status,
      401,
    );
    assert.equal(
      (
        await f.call(
          "/admin/catalog/variants/v",
          "PATCH",
          { preorderEnabled: true },
          { ...f.signed, "x-csrf-token": "wrong" },
        )
      ).status,
      403,
    );
    for (const invalid of [null, 1, "true"])
      assert.equal(
        (
          await f.admin("/catalog/variants/v", "PATCH", {
            preorderEnabled: invalid,
          })
        ).status,
        400,
      );
    const changed = await f.admin("/catalog/variants/v", "PATCH", {
      preorderEnabled: true,
    });
    assert.equal(changed.status, 200);
    assert.equal(
      ((await changed.json()) as { variant: { preorderEnabled: boolean } })
        .variant.preorderEnabled,
      true,
    );
    for (const path of ["/catalog/products/p", "/catalog/products"]) {
      const response = await f.call(
        path,
        "GET",
        undefined,
        {},
        "https://preview.invalid",
      );
      assert.equal(response.status, 200);
      const body = (await response.json()) as {
        product?: {
          variants: {
            stock: number;
            isAvailable: boolean;
            availability: unknown;
          }[];
        };
        products?: {
          variants: {
            stock: number;
            isAvailable: boolean;
            availability: unknown;
          }[];
        }[];
      };
      const variant = (body.product ?? body.products![0]!).variants[0]!;
      assert.equal(variant.stock, 2);
      assert.equal(variant.isAvailable, true);
      assert.deepEqual(variant.availability, {
        IN_STOCK: { quantity: 2, available: true },
        PREORDER: { enabled: true, checkoutEnabled: false },
      });
    }
    const created = await f.admin("/catalog/products/p/variants", "POST", {
      sku: "AV-API",
      size: "ONE",
      stock: 0,
      preorderEnabled: true,
    });
    assert.equal(created.status, 201);
    assert.equal(
      ((await created.json()) as { variant: { preorderEnabled: boolean } })
        .variant.preorderEnabled,
      true,
    );
    assert.equal(f.outboundCalls(), 0);
  } finally {
    await f.mf.dispose();
  }
});

test("actual checkout rejects typed PREORDER/IN_STOCK and manual-order overrides even in commerce-enabled fixtures", async () => {
  const f = await marketingRuntime();
  try {
    await f.db.exec(seed);
    await f.admin("/catalog/variants/v", "PATCH", { preorderEnabled: true });
    const user = await runtimeUser(f, 900051);
    const headers = {
      authorization: "Bearer " + user.token,
      "idempotency-key": randomUUID(),
    };
    const call = (path: string, body: unknown) =>
      f.call(path, "POST", body, headers, "https://preview.invalid");
    assert.equal((await call("/cart/items", line)).status, 201);
    for (const mode of ["PREORDER", "IN_STOCK"]) {
      assert.equal(
        (await call("/checkout", { ...recipient, saleMode: mode })).status,
        400,
      );
      assert.equal(
        (await call("/cart/items", { ...line, saleMode: mode })).status,
        400,
      );
      const manual = { userId: user.id, recipient, items: [line] };
      assert.equal(
        (
          await f.admin("/orders/manual/preview", "POST", {
            ...manual,
            saleMode: mode,
          })
        ).status,
        400,
      );
      assert.equal(
        (
          await f.call(
            "/admin/orders/manual",
            "POST",
            { ...manual, items: [{ ...line, saleMode: mode }] },
            { ...f.signed, "idempotency-key": randomUUID() },
          )
        ).status,
        400,
      );
    }
    assert.equal(
      (await f.db
        .prepare('SELECT COUNT(*) n FROM "Order"')
        .first<{ n: number }>())!.n,
      0,
    );
    const legacy = await call("/checkout", recipient);
    assert.equal(legacy.status, 201);
    const { order } = (await legacy.json()) as {
      order: { requiredPrepayment: number; status: string };
    };
    assert.equal(order.requiredPrepayment, 50001);
    assert.equal(order.status, "AWAITING_PREPAYMENT");
    assert.equal(
      (await f.db
        .prepare("SELECT stock FROM ProductVariant WHERE id='v'")
        .first<{ stock: number }>())!.stock,
      1,
    );
    assert.equal(f.outboundCalls(), 0);
  } finally {
    await f.mf.dispose();
  }
});
