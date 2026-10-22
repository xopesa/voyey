import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { prisma } from "@stenzo/database";
import {
  normalizeCatalogAttributeDefinitions as definitions,
  validateCatalogAttributeValues,
} from "@stenzo/shared";
import { isolatedD1 } from "./helpers/sqlite.js";
import { marketingRuntime } from "./helpers/marketing-runtime.js";
import { runtimeUser } from "./helpers/customer-operations.js";
import { D1AdminCatalogRepository } from "../../api/src/d1/repositories.js";
import { D1VariantGenerator } from "../../api/src/d1/variant-generator.js";
import { CatalogService } from "../../api/src/modules/catalog/service.js";
import { PrismaCatalogRepository } from "../../api/src/modules/catalog/repository.js";
import { WEB_ADMIN_ACTOR as actor } from "../../api/src/modules/admin/web-session.js";
import type { ProductCreateInput } from "../../api/src/modules/admin/catalog/types.js";

const field = {
  key: "material",
  nameRu: "Материал",
  nameUz: "Material",
  type: "TEXT",
};
const clothing = definitions([field]);
const stationery = definitions([
  { ...field, key: "brand" },
  {
    ...field,
    key: "pack_count",
    type: "INTEGER",
    scope: "VARIANT",
    min: 1,
    max: 100,
    unit: "шт",
  },
]);
const care = definitions([
  { ...field, key: "purpose" },
  { ...field, key: "composition" },
  {
    ...field,
    key: "volume",
    type: "NUMBER",
    scope: "VARIANT",
    min: 0.1,
    unit: "ml",
  },
]);
const productInput = (
  categoryId: string,
  slug: string,
  attributes = {},
): ProductCreateInput => ({
  categoryId,
  slug,
  nameRu: "Synthetic product",
  nameUz: "Synthetic product",
  descriptionRu: null,
  descriptionUz: null,
  sourceUrl: null,
  price: 100001,
  costPrice: 42000,
  currency: "UZS",
  status: "ACTIVE",
  isFeatured: false,
  attributes,
});
const categoryInput = (slug: string, attributeDefinitions = clothing) => ({
  slug,
  nameRu: "Synthetic category",
  nameUz: "Synthetic category",
  isActive: true,
  sortOrder: 0,
  attributeDefinitions,
});
const variantInput = (sku: string, attributes = {}) => ({
  sku,
  color: null,
  stock: 3,
  isActive: true,
  attributes,
});
const hasStatus = (status: number) => (error: unknown) => {
  assert.equal((error as { statusCode: number }).statusCode, status);
  return true;
};
async function sample(
  repo: D1AdminCatalogRepository,
  slug = "clothes",
  defs = clothing,
) {
  const c = await repo.createCategory(actor, categoryInput(slug, defs));
  const p = await repo.createProduct(actor, productInput(c.id, slug));
  return { c, p };
}

test("0018 preserves every existing table/column/row and defaults legacy attributes to empty JSON", () => {
  const db = new DatabaseSync(":memory:");
  try {
    const files = readdirSync(
      new URL("../migrations/", import.meta.url),
    ).sort();
    for (const file of files.filter((f) => f < "0018"))
      db.exec(
        readFileSync(new URL("../migrations/" + file, import.meta.url), "utf8"),
      );
    db.exec(`INSERT INTO Category(id,nameRu,nameUz,slug,updatedAt) VALUES('c','Fixture','Fixture','c',1);
      INSERT INTO Product(id,categoryId,nameRu,nameUz,slug,price,costPrice,status,updatedAt) VALUES('p','c','Fixture','Fixture','p',100001,42000,'ACTIVE',1);
      INSERT INTO ProductVariant(id,productId,sku,size,color,stock,preorderEnabled,updatedAt) VALUES('v','p','LEGACY','M','blue',NULL,1,1);
      INSERT INTO ProductImage(id,productId,url) VALUES('i','p','https://images.example.invalid/p.png');
      INSERT INTO User(id,telegramId,updatedAt) VALUES('u',900053,1);
      INSERT INTO Cart(id,userId,updatedAt) VALUES('cart','u',1);
      INSERT INTO CartItem(id,cartId,productId,variantId,quantity,heightCm,weightKg,updatedAt) VALUES('line','cart','p','v',1,180,75,1);
      INSERT INTO "Order"(id,publicId,userId,idempotencyKey,fullName,phone,city,address,subtotal,total,requiredPrepayment,remainingAmount,updatedAt)
        VALUES('order','STZ-FIXTURE','u','fixture-order','Synthetic buyer','+998900000000','Fixture','Fixture street',100001,100001,50001,50000,1);
      INSERT INTO OrderItem(id,orderId,productId,variantId,productNameRu,productNameUz,productSlug,sku,size,color,unitPrice,quantity,lineTotal,heightCm,weightKg)
        VALUES('order-line','order','p','v','Fixture','Fixture','p','LEGACY','M','blue',100001,1,100001,180,75);
      INSERT INTO Payment(id,orderId,type,expectedAmount,idempotencyKey,proofStorageKey,proofMimeType,updatedAt)
        VALUES('payment','order','PREPAYMENT',50001,'fixture-payment','fixture-proof','image/png',1);`);
    const tables = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
      )
      .all()
      .map((r) => String(r.name));
    const before = new Map(
      tables.map((table) => [
        table,
        {
          columns: db
            .prepare(`PRAGMA table_info("${table}")`)
            .all()
            .map((r) => String(r.name)),
          rows: JSON.stringify(
            db.prepare(`SELECT * FROM "${table}" ORDER BY rowid`).all(),
          ),
        },
      ]),
    );
    db.exec(
      readFileSync(
        new URL(
          "../migrations/0018_universal_catalog_attributes.sql",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    assert.deepEqual(
      db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
        )
        .all()
        .map((r) => String(r.name)),
      tables,
    );
    for (const [table, old] of before) {
      assert.equal(
        JSON.stringify(
          db
            .prepare(
              `SELECT ${old.columns.map((c) => `"${c}"`).join(",")} FROM "${table}" ORDER BY rowid`,
            )
            .all(),
        ),
        old.rows,
        table,
      );
    }
    assert.equal(
      db.prepare("SELECT attributeDefinitions FROM Category").get()!
        .attributeDefinitions,
      "[]",
    );
    for (const table of ["Product", "ProductVariant"])
      assert.equal(
        db.prepare(`SELECT attributes FROM "${table}"`).get()!.attributes,
        "{}",
      );
    for (const [table, column, wrongShape] of [
      ["Category", "attributeDefinitions", "{}"],
      ["Product", "attributes", "[]"],
      ["ProductVariant", "attributes", "[]"],
    ]) {
      for (const bad of [
        null,
        "broken",
        wrongShape,
        JSON.stringify({ huge: "я".repeat(9000) }),
      ]) {
        assert.throws(
          () => db.prepare(`UPDATE "${table}" SET "${column}"=?`).run(bad),
          /CHECK|NOT NULL|malformed JSON/,
        );
      }
    }
    assert.equal(db.prepare("PRAGMA foreign_key_check").all().length, 0);
  } finally {
    db.close();
  }
});

test("D1 and public DTO support clothing, stationery, care and arbitrary future categories", async () => {
  const f = isolatedD1();
  try {
    await f.run(async () => {
      const repo = new D1AdminCatalogRepository();
      const examples = [
        {
          slug: "clothing",
          defs: clothing,
          product: { material: "cotton" },
          variant: {},
          size: "M",
          color: "blue",
        },
        {
          slug: "stationery",
          defs: stationery,
          product: { brand: "Fixture" },
          variant: { pack_count: 12 },
          color: "blue",
        },
        {
          slug: "care",
          defs: care,
          product: { purpose: "cleaning", composition: "synthetic fixture" },
          variant: { volume: 250.5 },
        },
        {
          slug: "future",
          defs: definitions([{ ...field, key: "reusable", type: "BOOLEAN" }]),
          product: { reusable: false },
          variant: {},
        },
      ];
      for (const item of examples) {
        const c = await repo.createCategory(
          actor,
          categoryInput(item.slug, item.defs),
        );
        const p = await repo.createProduct(
          actor,
          productInput(c.id, item.slug, item.product),
        );
        const v = await repo.createVariant(actor, p.id, {
          ...variantInput(item.slug, item.variant),
          size: item.size,
          color: item.color ?? null,
          preorderEnabled: true,
        });
        const dto = await new CatalogService(
          new PrismaCatalogRepository(),
        ).getProductBySlug(item.slug);
        assert.deepEqual(dto.attributes, item.product);
        assert.deepEqual(dto.category.attributeDefinitions, item.defs);
        assert.deepEqual(dto.variants[0]!.attributes, item.variant);
        assert.equal(dto.variants[0]!.size, item.size ?? "");
        assert.equal(dto.variants[0]!.color, item.color ?? null);
        assert.deepEqual(dto.availableSizes, item.size ? [item.size] : []);
        assert.equal(dto.price, 100001);
        assert.equal("costPrice" in dto, false);
        assert.equal("price" in dto.variants[0]!, false);
        assert.equal(v.preorderEnabled, true);
        assert.equal(
          dto.variants[0]!.availability.PREORDER.checkoutEnabled,
          false,
        );
      }
    });
  } finally {
    f.sqlite.close();
  }
});

test("D1 rejects wrong types, ranges, scope and undefined attributes without writes/audits", async () => {
  const f = isolatedD1();
  try {
    await f.run(async () => {
      const repo = new D1AdminCatalogRepository();
      const { c, p } = await sample(repo, "stationery", stationery);
      const before = await prisma.auditLog.count();
      for (const attributes of [
        { brand: 3 },
        { pack_count: 2 },
        { unknown: "x" },
      ]) {
        await assert.rejects(
          repo.createProduct(
            actor,
            productInput(c.id, randomUUID(), attributes),
          ),
          hasStatus(400),
        );
      }
      for (const attributes of [
        { brand: "x" },
        { pack_count: 0 },
        { pack_count: 1.5 },
        { unknown: true },
      ]) {
        await assert.rejects(
          repo.createVariant(
            actor,
            p.id,
            variantInput(randomUUID(), attributes),
          ),
          hasStatus(400),
        );
      }
      assert.equal(await prisma.product.count(), 1);
      assert.equal(await prisma.productVariant.count(), 0);
      assert.equal(await prisma.auditLog.count(), before);
    });
  } finally {
    f.sqlite.close();
  }
});

test("category edits preserve used product and SKU attributes, including archived products", async () => {
  const f = isolatedD1();
  try {
    await f.run(async () => {
      const repo = new D1AdminCatalogRepository();
      const { c, p } = await sample(repo, "stationery", stationery);
      await repo.updateProduct(actor, p.id, {
        attributes: { brand: "Fixture" },
      });
      await repo.createVariant(
        actor,
        p.id,
        variantInput("PACK", { pack_count: 12 }),
      );
      f.sqlite.prepare("UPDATE Product SET archivedAt=1 WHERE id=?").run(p.id);
      const invalid = [
        [],
        definitions([{ ...stationery[0]!, type: "INTEGER" }, stationery[1]!]),
        definitions([stationery[0]!, { ...stationery[1]!, max: 5 }]),
        definitions([stationery[0]!, { ...stationery[1]!, unit: "box" }]),
        definitions([stationery[0]!, { ...stationery[1]!, scope: "PRODUCT" }]),
      ];
      for (const defs of invalid)
        await assert.rejects(
          repo.updateCategory(actor, c.id, { attributeDefinitions: defs }),
          hasStatus(409),
        );
      assert.deepEqual(
        (await prisma.category.findUniqueOrThrow({ where: { id: c.id } }))
          .attributeDefinitions,
        stationery,
      );
      const compatible = definitions([
        { ...stationery[0]!, nameRu: "Марка" },
        stationery[1]!,
        { ...field, key: "unused" },
      ]);
      await repo.updateCategory(actor, c.id, {
        attributeDefinitions: compatible,
      });
      await repo.updateCategory(actor, c.id, {
        attributeDefinitions: compatible.slice(0, 2),
      });
    });
  } finally {
    f.sqlite.close();
  }
});

test("product movement checks SKU attributes; patch replaces maps, preserves omitted values and rolls back with audit", async () => {
  const f = isolatedD1();
  try {
    await f.run(async () => {
      const repo = new D1AdminCatalogRepository();
      const { c, p } = await sample(repo, "stationery", stationery);
      const v = await repo.createVariant(
        actor,
        p.id,
        variantInput("PACK", { pack_count: 12 }),
      );
      const target = await repo.createCategory(
        actor,
        categoryInput("generic", []),
      );
      const incompatibleUnits = await repo.createCategory(
        actor,
        categoryInput(
          "boxes",
          definitions([stationery[0]!, { ...stationery[1]!, unit: "box" }]),
        ),
      );
      await assert.rejects(
        repo.updateProduct(actor, p.id, { categoryId: incompatibleUnits.id }),
        hasStatus(400),
      );
      await assert.rejects(
        repo.updateProduct(actor, p.id, { categoryId: target.id }),
        hasStatus(400),
      );
      assert.equal((await repo.getProduct(p.id))!.categoryId, c.id);
      await repo.updateProduct(actor, p.id, { attributes: { brand: "A" } });
      assert.deepEqual(
        (await repo.updateProduct(actor, p.id, { attributes: { brand: "B" } }))
          .attributes,
        { brand: "B" },
      );
      assert.deepEqual(
        (await repo.updateProduct(actor, p.id, { price: 100002 })).attributes,
        { brand: "B" },
      );
      f.sqlite.exec(
        "CREATE TRIGGER fail_catalog_audit BEFORE INSERT ON AuditLog WHEN NEW.action='product.update' BEGIN SELECT RAISE(ABORT,'fixture-audit-failure'); END",
      );
      await assert.rejects(
        repo.updateProduct(actor, p.id, { attributes: { brand: "C" } }),
        /fixture-audit-failure/,
      );
      assert.deepEqual((await repo.getProduct(p.id))!.attributes, {
        brand: "B",
      });
      f.sqlite.exec("DROP TRIGGER fail_catalog_audit");
      await repo.updateProduct(actor, p.id, { attributes: {} });
      await repo.updateVariant(actor, v.id, { attributes: {} });
      const moved = await repo.updateProduct(actor, p.id, {
        categoryId: target.id,
      });
      assert.deepEqual(moved.attributes, {});
      assert.equal(moved.price, 100002);
      assert.equal(moved.variants[0]!.stock, 3);
      assert.equal(moved.variants[0]!.sku, "PACK");
    });
  } finally {
    f.sqlite.close();
  }
});

test("concurrent category and product writes cannot commit incompatible attribute data", async () => {
  const f = isolatedD1();
  try {
    await f.run(async () => {
      const repo = new D1AdminCatalogRepository();
      const c = await repo.createCategory(actor, categoryInput("race"));
      const results = await Promise.allSettled([
        repo.updateCategory(actor, c.id, { attributeDefinitions: [] }),
        repo.createProduct(
          actor,
          productInput(c.id, "race", { material: "cotton" }),
        ),
      ]);
      assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
      const schema = definitions(
        (await prisma.category.findUniqueOrThrow({ where: { id: c.id } }))
          .attributeDefinitions,
      );
      for (const p of await prisma.product.findMany({
        where: { categoryId: c.id },
      }))
        validateCatalogAttributeValues(schema, p.attributes, "PRODUCT");
    });
  } finally {
    f.sqlite.close();
  }
});

test("legacy size/color generator leaves existing attributes intact and new attributes empty", async () => {
  const f = isolatedD1();
  try {
    await f.run(async () => {
      const repo = new D1AdminCatalogRepository();
      const { p } = await sample(repo, "pack", stationery);
      const v = await repo.createVariant(actor, p.id, {
        ...variantInput("PACK-M", { pack_count: 12 }),
        size: "M",
        preorderEnabled: true,
      });
      const result = await new D1VariantGenerator().apply(actor, p.id, {
        baseSku: "PACK",
        sizes: ["M", "L"],
        colors: [],
        stock: 3,
        isActive: true,
      });
      assert.equal(result.createdCount, 1);
      assert.deepEqual(result.variants.find((x) => x.id === v.id)!.attributes, {
        pack_count: 12,
      });
      assert.deepEqual(
        result.variants.find((x) => x.sku === "PACK-L")!.attributes,
        {},
      );
    });
  } finally {
    f.sqlite.close();
  }
});

test("actual Worker catalog enforces Admin/CSRF and category validation with commerce disabled", async () => {
  const f = await marketingRuntime("0");
  try {
    const category = await f.admin(
      "/catalog/categories",
      "POST",
      categoryInput("care", care),
    );
    assert.equal(category.status, 201);
    const { category: c } = (await category.json()) as {
      category: { id: string };
    };
    const created = await f.admin(
      "/catalog/products",
      "POST",
      productInput(c.id, "care", {
        purpose: "cleaning",
        composition: "fixture",
      }),
    );
    assert.equal(created.status, 201);
    const { product: p } = (await created.json()) as {
      product: { id: string };
    };
    const endpoint = `/catalog/products/${p.id}/variants`;
    assert.equal(
      (await f.call("/admin" + endpoint, "POST", { sku: "NOAUTH" }, f.base))
        .status,
      401,
    );
    assert.equal(
      (
        await f.call(
          "/admin" + endpoint,
          "POST",
          { sku: "NOCSRF" },
          { ...f.signed, "x-csrf-token": "wrong" },
        )
      ).status,
      403,
    );
    assert.equal(
      (
        await f.admin(endpoint, "POST", {
          sku: "WRONG",
          attributes: { volume: "250" },
        })
      ).status,
      400,
    );
    const variant = await f.admin(endpoint, "POST", {
      sku: "CARE",
      attributes: { volume: 250 },
      stock: 2,
      preorderEnabled: true,
    });
    assert.equal(variant.status, 201);
    const { variant: v } = (await variant.json()) as {
      variant: { size: string; color: null };
    };
    assert.equal(v.size, "");
    assert.equal(v.color, null);
    assert.equal(
      (
        await f.admin(`/catalog/categories/${c.id}`, "PATCH", {
          attributeDefinitions: [],
        })
      ).status,
      409,
    );
    assert.equal(
      (
        await f.admin(`/catalog/products/${p.id}`, "PATCH", {
          attributes: { purpose: "washing" },
        })
      ).status,
      200,
    );
    for (const path of ["/catalog/products/care", "/catalog/products"]) {
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
          attributes: unknown;
          variants: { attributes: unknown }[];
          availableSizes: string[];
        };
        products?: {
          attributes: unknown;
          variants: { attributes: unknown }[];
          availableSizes: string[];
        }[];
      };
      const dto = body.product ?? body.products![0]!;
      assert.deepEqual(dto.attributes, { purpose: "washing" });
      assert.deepEqual(dto.variants[0]!.attributes, { volume: 250 });
      assert.deepEqual(dto.availableSizes, []);
    }
    const cats = await f.call(
      "/catalog/categories",
      "GET",
      undefined,
      {},
      "https://preview.invalid",
    );
    assert.equal(cats.status, 200);
    assert.match(await cats.text(), /attributeDefinitions/);
    assert.equal(f.outboundCalls(), 0);
  } finally {
    await f.mf.dispose();
  }
});

test("generic cart accepts no body measurements; unchanged checkout still requires them and retains 50% payment", async () => {
  const f = await marketingRuntime();
  try {
    await f.db
      .exec(`INSERT INTO Category(id,nameRu,nameUz,slug,updatedAt) VALUES('c','Fixture','Fixture','c',1);
      INSERT INTO Product(id,categoryId,nameRu,nameUz,slug,price,status,updatedAt) VALUES('p','c','Fixture','Fixture','p',100001,'ACTIVE',1);
      INSERT INTO ProductVariant(id,productId,sku,size,stock,preorderEnabled,updatedAt) VALUES('v','p','GENERIC','',2,1,1);`);
    const user = await runtimeUser(f, 900052);
    const headers = {
      authorization: "Bearer " + user.token,
      "idempotency-key": randomUUID(),
    };
    const call = (path: string, method: string, body: unknown) =>
      f.call(path, method, body, headers, "https://preview.invalid");
    const line = { productId: "p", variantId: "v", quantity: 1 };
    assert.equal((await call("/cart/items", "POST", line)).status, 201);
    const recipient = {
      fullName: "Synthetic buyer",
      phone: "+998900000000",
      city: "Fixture",
      address: "Fixture street",
      apartment: null,
      comment: null,
    };
    assert.equal((await call("/checkout", "POST", recipient)).status, 409);
    assert.equal(
      (await f.db
        .prepare('SELECT COUNT(*) n FROM "Order"')
        .first<{ n: number }>())!.n,
      0,
    );
    assert.equal(
      (await f.db
        .prepare("SELECT stock FROM ProductVariant WHERE id='v'")
        .first<{ stock: number }>())!.stock,
      2,
    );
    assert.equal(
      (await call("/checkout", "POST", { ...recipient, saleMode: "PREORDER" }))
        .status,
      400,
    );
    // Adding the same SKU updates existing cart measurements through the existing API.
    assert.equal(
      (
        await call("/cart/items", "POST", {
          ...line,
          heightCm: 180,
          weightKg: 75,
        })
      ).status,
      201,
    );
    const legacy = await call("/checkout", "POST", recipient);
    assert.equal(legacy.status, 201);
    const { order } = (await legacy.json()) as {
      order: { requiredPrepayment: number; status: string };
    };
    // Two additions mean quantity=2: total 200002 and the same 50% rule.
    assert.equal(order.requiredPrepayment, 100001);
    assert.equal(order.status, "AWAITING_PREPAYMENT");
    assert.equal(f.outboundCalls(), 0);
  } finally {
    await f.mf.dispose();
  }
});
