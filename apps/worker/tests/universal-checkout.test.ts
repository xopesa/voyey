import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { prisma } from "@stenzo/database";
import { normalizeCatalogAttributeDefinitions as definitions } from "@stenzo/shared";
import { isolatedD1 } from "./helpers/sqlite.js";
import { marketingRuntime } from "./helpers/marketing-runtime.js";
import { runtimeUser } from "./helpers/customer-operations.js";
import {
  D1AdminCatalogRepository,
  D1CartRepository,
  D1OrderRepository,
} from "../../api/src/d1/repositories.js";
import { ManualOrderService } from "../../api/src/modules/admin/manual-orders.js";
import { WEB_ADMIN_ACTOR as actor } from "../../api/src/modules/admin/web-session.js";
import { prepareOrder } from "../../api/src/modules/checkout/domain.js";
import { CheckoutMeasurementsError } from "../../api/src/modules/checkout/errors.js";
import { CartStockExceededError } from "../../api/src/modules/cart/errors.js";
import { addCartItemSchema } from "../../api/src/modules/cart/schemas.js";
import {
  toOrderDto,
  toAdminOrderDto,
} from "../../api/src/modules/orders/service.js";
import type { OrderDto } from "../../api/src/modules/orders/types.js";

const field = { key: "brand", nameRu: "Бренд", nameUz: "Brend", type: "TEXT" };
const defs = definitions([
  field,
  {
    ...field,
    key: "pack_count",
    type: "INTEGER",
    scope: "VARIANT",
    unit: "шт",
    min: 1,
  },
  { ...field, key: "unused" },
]);
const recipient = {
  fullName: "Synthetic buyer",
  phone: "+998900000000",
  city: "Fixture",
  address: "Fixture street",
  apartment: null,
  comment: null,
};
const seed = `INSERT INTO User(id,telegramId,updatedAt) VALUES('u',900061,1),('other',900062,1);
  INSERT INTO Category(id,nameRu,nameUz,slug,requiresBuyerMeasurements,updatedAt) VALUES('clothes','Clothes','Clothes','clothes',1,1),('stationery','Stationery','Stationery','stationery',0,1),('care','Care','Care','care',0,1),('future','Future','Future','future',0,1);
  INSERT INTO Product(id,categoryId,nameRu,nameUz,slug,price,costPrice,status,updatedAt) VALUES('pc','clothes','Clothes RU','Clothes UZ','pc',100001,42000,'ACTIVE',1),('ps','stationery','Stationery RU','Stationery UZ','ps',100001,42000,'ACTIVE',1),('pw','care','Care RU','Care UZ','pw',100001,NULL,'ACTIVE',1),('pf','future','Future RU','Future UZ','pf',100001,NULL,'ACTIVE',1);
  INSERT INTO ProductVariant(id,productId,sku,size,color,stock,preorderEnabled,updatedAt) VALUES('vc','pc','CLOTHES','M','blue',5,1,1),('vs','ps','STATIONERY','',NULL,5,1,1),('vw','pw','CARE','',NULL,5,0,1),('vf','pf','FUTURE','',NULL,5,0,1);`;
const input = (productId = "ps", variantId = "vs", extra = {}) =>
  addCartItemSchema.parse({ productId, variantId, quantity: 1, ...extra });
function fixture() {
  const f = isolatedD1();
  f.sqlite.exec(seed);
  f.sqlite
    .prepare("UPDATE Category SET attributeDefinitions=? WHERE id='stationery'")
    .run(JSON.stringify(defs));
  f.sqlite
    .prepare("UPDATE Product SET attributes=? WHERE id='ps'")
    .run(JSON.stringify({ brand: "Fixture" }));
  f.sqlite
    .prepare("UPDATE ProductVariant SET attributes=? WHERE id='vs'")
    .run(JSON.stringify({ pack_count: 12 }));
  return f;
}
const checkout = (userId = "u", key = randomUUID()) =>
  new D1OrderRepository().checkout({
    userId,
    publicId: randomUUID(),
    idempotencyKey: key,
    recipient,
    prepare: prepareOrder,
  });

test("0019 preserves legacy category/order data, defaults measurements on and does not backfill snapshots", () => {
  const db = new DatabaseSync(":memory:");
  try {
    for (const file of readdirSync(new URL("../migrations/", import.meta.url))
      .sort()
      .filter((f) => f < "0019"))
      db.exec(
        readFileSync(new URL("../migrations/" + file, import.meta.url), "utf8"),
      );
    db.exec(`INSERT INTO User(id,telegramId,updatedAt) VALUES('u',900060,1);
      INSERT INTO Category(id,nameRu,nameUz,slug,updatedAt) VALUES('c','Legacy','Legacy','legacy',1);
      INSERT INTO Product(id,categoryId,nameRu,nameUz,slug,price,status,attributes,updatedAt) VALUES('p','c','Current product','Current product','p',100001,'ACTIVE','{}',1);
      INSERT INTO ProductVariant(id,productId,sku,size,stock,preorderEnabled,updatedAt) VALUES('v','p','LEGACY','M',NULL,1,1);
      INSERT INTO "Order"(id,publicId,userId,idempotencyKey,fullName,phone,city,address,subtotal,total,requiredPrepayment,remainingAmount,updatedAt) VALUES('o','STZ-LEGACY','u','fixture-key','Synthetic buyer','+998900000000','Fixture','Fixture street',100001,100001,50001,50000,1);
      INSERT INTO OrderItem(id,orderId,productId,variantId,productNameRu,productNameUz,productSlug,sku,size,unitPrice,quantity,lineTotal,heightCm,weightKg) VALUES('i','o','p','v','Historical RU','Historical UZ','old-slug','OLD-SKU','L',100001,1,100001,180,75);`);
    const tables = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
      )
      .all()
      .map((r) => String(r.name));
    const original = tables.map((table) => ({
      table,
      columns: db
        .prepare(`PRAGMA table_info("${table}")`)
        .all()
        .map((c) => String(c.name)),
      rows: JSON.stringify(
        db.prepare(`SELECT * FROM "${table}" ORDER BY rowid`).all(),
      ),
    }));
    db.exec(
      readFileSync(
        new URL(
          "../migrations/0019_checkout_measurements_and_catalog_snapshot.sql",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    for (const old of original)
      assert.equal(
        JSON.stringify(
          db
            .prepare(
              `SELECT ${old.columns.map((c) => `"${c}"`).join(",")} FROM "${old.table}" ORDER BY rowid`,
            )
            .all(),
        ),
        old.rows,
        old.table,
      );
    assert.equal(
      db.prepare("SELECT requiresBuyerMeasurements FROM Category").get()!
        .requiresBuyerMeasurements,
      1,
    );
    assert.equal(
      db.prepare("SELECT catalogSnapshot FROM OrderItem").get()!
        .catalogSnapshot,
      null,
    );
    for (const bad of [null, 2, -1, "bad"])
      assert.throws(
        () =>
          db
            .prepare("UPDATE Category SET requiresBuyerMeasurements=?")
            .run(bad),
        /CHECK|NOT NULL/,
      );
    for (const bad of [
      "bad",
      "[]",
      "{}",
      '{"version":2}',
      '{"version":"1"}',
      JSON.stringify({ version: 1, huge: "x".repeat(65536) }),
    ])
      assert.throws(
        () => db.prepare("UPDATE OrderItem SET catalogSnapshot=?").run(bad),
        /CHECK|malformed JSON/,
      );
    assert.equal(db.prepare("PRAGMA foreign_key_check").all().length, 0);
  } finally {
    db.close();
  }
});

for (const [name, p, v] of [
  ["stationery", "ps", "vs"],
  ["care", "pw", "vw"],
  ["future category", "pf", "vf"],
]) {
  test(`${name} checks out without buyer measurements at the old 50% rate`, async () => {
    const f = fixture();
    try {
      await f.run(async () => {
        await new D1CartRepository().addItem("u", input(p, v));
        const result = await checkout();
        const dto = toOrderDto(result.order);
        assert.equal(dto.requiredPrepayment, 50001);
        assert.equal(dto.remainingAmount, 50000);
        assert.equal(dto.items[0]!.heightCm, null);
        assert.equal(dto.items[0]!.weightKg, null);
        assert.equal(
          dto.items[0]!.catalogSnapshot!.requiresBuyerMeasurements,
          false,
        );
        assert.equal(dto.cargoAmount, null);
        assert.equal(dto.status, "AWAITING_PREPAYMENT");
        assert.equal(
          (await prisma.productVariant.findUniqueOrThrow({ where: { id: v } }))
            .stock,
          4,
        );
        assert.equal(await prisma.cartItem.count(), 0);
      });
    } finally {
      f.sqlite.close();
    }
  });
}

test("clothing defaults require both buyer measurements; rejection is atomic and a valid retry works", async () => {
  const f = fixture();
  try {
    await f.run(async () => {
      const carts = new D1CartRepository();
      const cart = await carts.addItem("u", input("pc", "vc"));
      await assert.rejects(checkout(), CheckoutMeasurementsError);
      assert.equal(await prisma.order.count(), 0);
      assert.equal(await prisma.orderItem.count(), 0);
      assert.equal(
        (await prisma.productVariant.findUniqueOrThrow({ where: { id: "vc" } }))
          .stock,
        5,
      );
      await carts.updateItem("u", cart.items[0]!.id, {
        heightCm: 180,
        weightKg: 75,
      });
      const result = await checkout();
      assert.equal(result.order.requiredPrepayment, 50001);
      assert.equal(result.order.items[0]!.heightCm, 180);
      assert.equal(
        toOrderDto(result.order).items[0]!.catalogSnapshot!
          .requiresBuyerMeasurements,
        true,
      );
    });
  } finally {
    f.sqlite.close();
  }
});

test("order attributes/category/labels stay historical after catalog edits, replay and deletion", async () => {
  const f = fixture();
  try {
    await f.run(async () => {
      const carts = new D1CartRepository(),
        catalog = new D1AdminCatalogRepository();
      await carts.addItem("u", input());
      const key = randomUUID(),
        result = await checkout("u", key),
        dto = toOrderDto(result.order);
      const snapshot = dto.items[0]!.catalogSnapshot!;
      assert.deepEqual(snapshot.attributeDefinitions, defs.slice(0, 2));
      assert.deepEqual(snapshot.productAttributes, { brand: "Fixture" });
      assert.deepEqual(snapshot.variantAttributes, { pack_count: 12 });
      assert.equal(snapshot.category!.id, "stationery");
      await catalog.updateProduct(actor, "ps", {
        attributes: {},
        nameRu: "Changed",
        nameUz: "Changed",
        slug: "changed",
        price: 200003,
      });
      await catalog.updateVariant(actor, "vs", {
        attributes: {},
        sku: "CHANGED",
        size: "XL",
        color: "red",
      });
      await catalog.updateCategory(actor, "stationery", {
        attributeDefinitions: [],
        nameRu: "Changed category",
        requiresBuyerMeasurements: true,
      });
      await catalog.updateProduct(actor, "ps", { categoryId: "care" });
      await carts.addItem("u", input("pw", "vw"));
      const replay = await checkout("u", key);
      assert.equal(replay.created, false);
      assert.deepEqual(toOrderDto(replay.order), dto);
      assert.equal(await prisma.cartItem.count(), 1);
      const repo = new D1OrderRepository();
      assert.deepEqual(
        toAdminOrderDto((await repo.getForAdmin(dto.publicId))!).items[0]!
          .catalogSnapshot,
        snapshot,
      );
      assert.deepEqual(
        toOrderDto((await repo.listForUser("u", { limit: 20 })).orders[0]!)
          .items[0]!.catalogSnapshot,
        snapshot,
      );
      f.sqlite.exec(
        "DELETE FROM ProductVariant WHERE id='vs'; DELETE FROM Product WHERE id='ps'; DELETE FROM Category WHERE id='stationery';",
      );
      const historical = toOrderDto(
        (await repo.getForUser("u", dto.publicId))!,
      );
      assert.equal(historical.items[0]!.productId, null);
      assert.equal(historical.items[0]!.sku, "STATIONERY");
      assert.equal(historical.items[0]!.productNameRu, "Stationery RU");
      assert.deepEqual(historical.items[0]!.catalogSnapshot, snapshot);
    });
  } finally {
    f.sqlite.close();
  }
});

test("legacy order rows return null snapshot rather than today's catalog characteristics", async () => {
  const f = fixture();
  try {
    await f.run(async () => {
      await new D1CartRepository().addItem("u", input());
      const created = await checkout();
      f.sqlite.exec(
        "UPDATE OrderItem SET catalogSnapshot=NULL; UPDATE Product SET nameRu='Changed';",
      );
      const row = (await new D1OrderRepository().getForUser(
        "u",
        created.order.publicId,
      ))!;
      assert.equal(toOrderDto(row).items[0]!.catalogSnapshot, null);
      assert.equal(toAdminOrderDto(row).items[0]!.catalogSnapshot, null);
      assert.equal(toOrderDto(row).items[0]!.productNameRu, "Stationery RU");
    });
  } finally {
    f.sqlite.close();
  }
});

test("optional measurements do not bypass zero stock/preorder, including manual orders", async () => {
  const f = fixture();
  try {
    await f.run(async () => {
      await new D1CartRepository().addItem("u", input());
      f.sqlite.exec(
        "UPDATE ProductVariant SET stock=0,preorderEnabled=1 WHERE id='vs'",
      );
      await assert.rejects(checkout(), CartStockExceededError);
      await assert.rejects(
        new ManualOrderService().create(actor, randomUUID(), {
          userId: "u",
          recipient,
          items: [input()],
        }),
        CartStockExceededError,
      );
      assert.equal(await prisma.order.count(), 0);
      assert.equal(await prisma.orderItem.count(), 0);
      assert.equal(await prisma.payment.count(), 0);
      assert.equal(await prisma.cartItem.count(), 1);
    });
  } finally {
    f.sqlite.close();
  }
});

test("audit failure rolls back order, snapshots, stock and cart deletion together", async () => {
  const f = fixture();
  try {
    await f.run(async () => {
      await new D1CartRepository().addItem("u", input());
      f.sqlite.exec(
        "CREATE TRIGGER fail_order_audit BEFORE INSERT ON AuditLog WHEN NEW.action='order.create' BEGIN SELECT RAISE(ABORT,'fixture-audit-failure'); END",
      );
      await assert.rejects(checkout(), /fixture-audit-failure/);
      assert.equal(await prisma.order.count(), 0);
      assert.equal(await prisma.orderItem.count(), 0);
      assert.equal(await prisma.auditLog.count(), 0);
      assert.equal(await prisma.cartItem.count(), 1);
      assert.equal(
        (await prisma.productVariant.findUniqueOrThrow({ where: { id: "vs" } }))
          .stock,
        5,
      );
    });
  } finally {
    f.sqlite.close();
  }
});

test("concurrent same-key checkout reserves once and returns the same immutable snapshot", async () => {
  const f = fixture();
  try {
    await f.run(async () => {
      f.sqlite.exec("UPDATE ProductVariant SET stock=1 WHERE id='vs'");
      await new D1CartRepository().addItem("u", input());
      const key = randomUUID(),
        results = await Promise.all([checkout("u", key), checkout("u", key)]);
      assert.equal(results.filter((r) => r.created).length, 1);
      assert.deepEqual(
        toOrderDto(results[0]!.order),
        toOrderDto(results[1]!.order),
      );
      assert.equal(await prisma.order.count(), 1);
      assert.equal(await prisma.orderItem.count(), 1);
      assert.equal(
        (await prisma.productVariant.findUniqueOrThrow({ where: { id: "vs" } }))
          .stock,
        0,
      );
    });
  } finally {
    f.sqlite.close();
  }
});

test("two buyers racing for the final generic SKU cannot oversell or partially snapshot", async () => {
  const f = fixture();
  try {
    await f.run(async () => {
      f.sqlite.exec("UPDATE ProductVariant SET stock=1 WHERE id='vs'");
      const carts = new D1CartRepository();
      await carts.addItem("u", input());
      await carts.addItem("other", input());
      const results = await Promise.allSettled([
        checkout("u"),
        checkout("other"),
      ]);
      assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
      assert.equal(await prisma.order.count(), 1);
      assert.equal(await prisma.orderItem.count(), 1);
      assert.equal(await prisma.cartItem.count(), 1);
      assert.equal(
        (await prisma.productVariant.findUniqueOrThrow({ where: { id: "vs" } }))
          .stock,
        0,
      );
      assert.ok((await prisma.orderItem.findMany())[0]!.catalogSnapshot);
    });
  } finally {
    f.sqlite.close();
  }
});

test("category policy updates racing checkout use one guarded catalog state", async () => {
  const f = fixture();
  try {
    await f.run(async () => {
      await new D1CartRepository().addItem("u", input());
      const [, result] = await Promise.allSettled([
        new D1AdminCatalogRepository().updateCategory(actor, "stationery", {
          requiresBuyerMeasurements: true,
        }),
        checkout(),
      ]);
      if (result.status === "fulfilled") {
        assert.equal(
          toOrderDto(result.value.order).items[0]!.catalogSnapshot!
            .requiresBuyerMeasurements,
          false,
        );
        assert.equal(
          (
            await prisma.productVariant.findUniqueOrThrow({
              where: { id: "vs" },
            })
          ).stock,
          4,
        );
      } else {
        assert.ok(result.reason instanceof CheckoutMeasurementsError);
        assert.equal(await prisma.order.count(), 0);
        assert.equal(
          (
            await prisma.productVariant.findUniqueOrThrow({
              where: { id: "vs" },
            })
          ).stock,
          5,
        );
      }
    });
  } finally {
    f.sqlite.close();
  }
});

test("manual preview/create use the same optional sizing policy, snapshots, pricing and replay", async () => {
  const f = fixture();
  try {
    await f.run(async () => {
      const service = new ManualOrderService(),
        key = randomUUID();
      const body = {
        userId: "u",
        recipient,
        items: [input("ps", "vs", { quantity: 2 })],
      };
      f.sqlite.exec("UPDATE Product SET price=200003 WHERE id='ps'");
      const preview = await service.preview(body);
      assert.equal(await prisma.order.count(), 0);
      assert.equal(preview.total, 400006);
      assert.equal(preview.requiredPrepayment, 200003);
      const order = await service.create(actor, key, body);
      assert.equal(order.total, preview.total);
      assert.deepEqual(
        order.items[0]!.catalogSnapshot,
        preview.items[0]!.catalogSnapshot,
      );
      assert.equal(order.source, "ADMIN");
      assert.equal(order.items[0]!.heightCm, null);
      await new D1AdminCatalogRepository().updateCategory(actor, "stationery", {
        requiresBuyerMeasurements: true,
      });
      assert.deepEqual(await service.create(actor, key, body), order);
      assert.equal(await prisma.cart.count(), 0);
      assert.equal(
        (await prisma.productVariant.findUniqueOrThrow({ where: { id: "vs" } }))
          .stock,
        3,
      );
    });
  } finally {
    f.sqlite.close();
  }
});

test("actual Worker checks out stationery without measurements and protects policy/manual APIs", async () => {
  const f = await marketingRuntime();
  try {
    await f.db.exec(seed);
    await f.db
      .prepare(
        "UPDATE Category SET attributeDefinitions=? WHERE id='stationery'",
      )
      .bind(JSON.stringify(defs))
      .run();
    await f.db
      .prepare("UPDATE Product SET attributes=? WHERE id='ps'")
      .bind(JSON.stringify({ brand: "Fixture" }))
      .run();
    await f.db
      .prepare("UPDATE ProductVariant SET attributes=? WHERE id='vs'")
      .bind(JSON.stringify({ pack_count: 12 }))
      .run();
    const user = await runtimeUser(f, 900063),
      foreign = await runtimeUser(f, 900064);
    const headers = {
      authorization: "Bearer " + user.token,
      "idempotency-key": randomUUID(),
    };
    const call = (path: string, method: string, body?: unknown) =>
      f.call(path, method, body, headers, "https://preview.invalid");
    const policy = { requiresBuyerMeasurements: false };
    assert.equal(
      (
        await f.call(
          "/admin/catalog/categories/clothes",
          "PATCH",
          policy,
          f.base,
        )
      ).status,
      401,
    );
    assert.equal(
      (
        await f.call("/admin/catalog/categories/clothes", "PATCH", policy, {
          ...f.signed,
          "x-csrf-token": "wrong",
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await f.admin("/catalog/categories/clothes", "PATCH", {
          requiresBuyerMeasurements: "false",
        })
      ).status,
      400,
    );
    assert.equal(
      (await f.admin("/catalog/categories/future", "PATCH", policy)).status,
      200,
    );
    assert.equal((await call("/cart/items", "POST", input())).status, 201);
    assert.equal(
      (await call("/checkout", "POST", { ...recipient, saleMode: "PREORDER" }))
        .status,
      400,
    );
    assert.equal(
      (
        await call("/checkout", "POST", {
          ...recipient,
          requiresBuyerMeasurements: false,
        })
      ).status,
      400,
    );
    const response = await call("/checkout", "POST", recipient);
    assert.equal(response.status, 201);
    const { order } = (await response.json()) as { order: OrderDto };
    assert.equal(order.requiredPrepayment, 50001);
    assert.equal(order.items[0]!.heightCm, null);
    assert.deepEqual(order.items[0]!.catalogSnapshot!.variantAttributes, {
      pack_count: 12,
    });
    assert.equal(
      (
        await f.call(
          `/orders/${order.publicId}`,
          "GET",
          undefined,
          { authorization: "Bearer " + foreign.token },
          "https://preview.invalid",
        )
      ).status,
      404,
    );
    const replay = await call("/checkout", "POST", recipient);
    assert.equal(replay.status, 201);
    assert.deepEqual(
      ((await replay.json()) as { order: OrderDto }).order,
      order,
    );
    const manualBody = {
      userId: foreign.id,
      recipient,
      items: [{ productId: "ps", variantId: "vs", quantity: 1 }],
    };
    assert.equal(
      (await f.admin("/orders/manual/preview", "POST", manualBody)).status,
      200,
    );
    const manual = await f.call("/admin/orders/manual", "POST", manualBody, {
      ...f.signed,
      "idempotency-key": randomUUID(),
    });
    assert.equal(manual.status, 201);
    assert.equal(
      ((await manual.json()) as { order: OrderDto }).order.items[0]!
        .catalogSnapshot!.requiresBuyerMeasurements,
      false,
    );
    const clothes = {
      ...manualBody,
      items: [{ productId: "pc", variantId: "vc", quantity: 1 }],
    };
    assert.equal(
      (await f.admin("/orders/manual/preview", "POST", clothes)).status,
      409,
    );
    assert.equal(
      (
        await f.call("/admin/orders/manual", "POST", clothes, {
          ...f.signed,
          "idempotency-key": randomUUID(),
        })
      ).status,
      409,
    );
    assert.equal(f.outboundCalls(), 0);
  } finally {
    await f.mf.dispose();
  }
});

test("commerce remains disabled even when category measurements are optional", async () => {
  const f = await marketingRuntime("0");
  try {
    await f.db.exec(seed);
    const user = await runtimeUser(f, 900065);
    const headers = {
      authorization: "Bearer " + user.token,
      "idempotency-key": randomUUID(),
    };
    assert.equal(
      (
        await f.call(
          "/cart/items",
          "POST",
          input(),
          headers,
          "https://preview.invalid",
        )
      ).status,
      201,
    );
    assert.equal(
      (
        await f.call(
          "/checkout",
          "POST",
          recipient,
          headers,
          "https://preview.invalid",
        )
      ).status,
      503,
    );
    const manualBody = { userId: user.id, recipient, items: [input()] };
    assert.equal(
      (
        await f.call("/admin/orders/manual", "POST", manualBody, {
          ...f.signed,
          "idempotency-key": randomUUID(),
        })
      ).status,
      503,
    );
    assert.equal(
      (await f.db
        .prepare('SELECT COUNT(*) n FROM "Order"')
        .first<{ n: number }>())!.n,
      0,
    );
    assert.equal(f.outboundCalls(), 0);
  } finally {
    await f.mf.dispose();
  }
});
