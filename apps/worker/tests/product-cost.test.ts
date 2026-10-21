import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { prisma } from "@stenzo/database";
import { financeSeed } from "./helpers/finance.js";
import { isolatedD1 } from "./helpers/sqlite.js";
import { marketingRuntime } from "./helpers/marketing-runtime.js";
import { runtimeUser } from "./helpers/customer-operations.js";
import {
  D1CartRepository,
  D1OrderRepository,
  D1AdminCatalogRepository,
} from "../../api/src/d1/repositories.js";
import { ManualOrderService } from "../../api/src/modules/admin/manual-orders.js";
import { AdminCatalogService } from "../../api/src/modules/admin/catalog/service.js";
import { prepareOrder } from "../../api/src/modules/checkout/domain.js";
import { toOrderDto } from "../../api/src/modules/orders/service.js";
import { toCartDto } from "../../api/src/modules/cart/service.js";
import { toProductDto } from "../../api/src/modules/catalog/service.js";
import { D1DashboardRepository } from "../../api/src/d1/dashboard.js";
import { dashboardPeriod } from "../../api/src/modules/admin/dashboard.js";
import { FinanceService } from "../../api/src/modules/admin/finance/analytics.js";
import { WEB_ADMIN_ACTOR } from "../../api/src/modules/admin/web-session.js";
import { productPatchSchema } from "../../api/src/modules/admin/catalog/schemas.js";
const recipient = {
  fullName: "Isolated buyer",
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
const now = Date.parse("2026-10-21T12:00:00Z"),
  query = { range: "custom", from: "2026-10-21", to: "2026-10-21" };
function fixture() {
  const f = isolatedD1();
  f.sqlite.exec(`INSERT INTO User(id,telegramId,updatedAt) VALUES('u',12345,1);
 INSERT INTO Category(id,nameRu,nameUz,slug,updatedAt) VALUES('c','Тест','Sinov','c',1);
 INSERT INTO Product(id,categoryId,nameRu,nameUz,slug,price,costPrice,status,updatedAt) VALUES('p','c','Тест','Sinov','p',200000,73001,'ACTIVE',1);
 INSERT INTO ProductVariant(id,productId,sku,size,stock,isActive,updatedAt) VALUES('v','p','COST-M','M',20,1,1);`);
  return f;
}
const catalog = () => new AdminCatalogService(new D1AdminCatalogRepository());
function privateAbsent(value: unknown) {
  assert.doesNotMatch(
    JSON.stringify(value),
    /"(?:costPrice|procurementUnitCost|procurementUpdatedAt|procurementUpdatedBy)"/,
  );
}
for (const kind of ["MINIAPP", "ADMIN"])
  test(`${kind}: current private cost is copied per unit, idempotent and immutable after catalog edits`, async () => {
    const f = fixture();
    try {
      await f.run(async () => {
        const key = randomUUID(),
          publicId = randomUUID();
        const create = async () =>
          kind === "ADMIN"
            ? new ManualOrderService().create(WEB_ADMIN_ACTOR, key, {
                userId: "u",
                recipient,
                items: [line],
              })
            : (
                await new D1OrderRepository().checkout({
                  userId: "u",
                  publicId,
                  idempotencyKey: key,
                  recipient,
                  prepare: prepareOrder,
                })
              ).order;
        if (kind === "MINIAPP") {
          const cart = await new D1CartRepository().addItem("u", line);
          privateAbsent(toCartDto(cart));
        }
        const first = await create();
        privateAbsent(kind === "ADMIN" ? first : toOrderDto(first as never));
        const item = f.sqlite.prepare("SELECT * FROM OrderItem").get()!;
        assert.equal(item.procurementUnitCost, 73001);
        assert.equal(item.quantity, 2);
        await catalog().updateProduct(WEB_ADMIN_ACTOR, "p", {
          costPrice: 99001,
        });
        await create();
        assert.equal(await prisma.order.count(), 1);
        assert.equal(
          f.sqlite.prepare("SELECT procurementUnitCost FROM OrderItem").get()!
            .procurementUnitCost,
          73001,
        );
        assert.equal(
          (
            await prisma.productVariant.findUniqueOrThrow({
              where: { id: "v" },
            })
          ).stock,
          18,
        );
        const product = await catalog().getProduct("p");
        assert.equal(product.costPrice, 99001);
        privateAbsent(toProductDto(product));
      });
    } finally {
      f.sqlite.close();
    }
  });

test("unknown catalog cost remains NULL in new orders and never becomes a free procurement cost", async () => {
  const f = fixture();
  try {
    await f.run(async () => {
      await catalog().updateProduct(WEB_ADMIN_ACTOR, "p", { costPrice: null });
      await new ManualOrderService().create(WEB_ADMIN_ACTOR, randomUUID(), {
        userId: "u",
        recipient,
        items: [line],
      });
      assert.equal(
        f.sqlite.prepare("SELECT procurementUnitCost FROM OrderItem").get()!
          .procurementUnitCost,
        null,
      );
    });
  } finally {
    f.sqlite.close();
  }
});

test("dashboard net profit subtracts snapshot quantity cost, linked costs and period overhead once; pending/cancelled orders excluded", async () => {
  const f = fixture();
  try {
    await f.run(async () => {
      const order = await new ManualOrderService().create(
        WEB_ADMIN_ACTOR,
        randomUUID(),
        { userId: "u", recipient, items: [line] },
      );
      f.sqlite
        .prepare(
          `UPDATE "Order" SET status='COMPLETED',completedAt=?,cargoAmount=20000,itemsSubtotal=400000,total=360000,subtotal=360000,requiredPrepayment=180000,remainingAmount=180000,discountAmount=40000 WHERE publicId=?`,
        )
        .run(now, order.publicId);
      const id = f.sqlite
        .prepare('SELECT id FROM "Order" WHERE publicId=?')
        .get(order.publicId)!.id as string;
      const addExpense = (
        id: string,
        amount: number,
        orderId: string | null,
        at = now,
        voided: number | null = null,
      ) =>
        f.sqlite
          .prepare(
            "INSERT INTO Expense(id,category,amount,occurredAt,orderId,createdBy,createdAt,updatedAt,voidedAt) VALUES(?,'OTHER',?,?,?,?,?,?,?)",
          )
          .run(id, amount, at, orderId, "fixture", now, now, voided);
      addExpense("linked", 11000, id);
      addExpense("global", 7000, null);
      addExpense("voided", 999999, null, now, now);
      addExpense("outside", 999999, null, now - 86400000);
      const repo = new D1DashboardRepository();
      let result = await repo.load(dashboardPeriod(query, now));
      assert.equal(result.profit!.netProfit, 215998);
      assert.equal(result.profit!.overheadExpenses, 7000);
      assert.equal(result.profit!.completedOrders, 1);
      assert.equal(
        (await new FinanceService().load(query, now)).realized.profit,
        222998,
      );
      await catalog().updateProduct(WEB_ADMIN_ACTOR, "p", {
        costPrice: 999999,
      });
      assert.equal(
        (await repo.load(dashboardPeriod(query, now))).profit!.netProfit,
        215998,
      );
      f.sqlite.exec("UPDATE OrderItem SET procurementUnitCost=NULL");
      result = await repo.load(dashboardPeriod(query, now));
      assert.equal(result.profit!.netProfit, null);
      assert.equal(result.profit!.incompleteOrders, 1);
      f.sqlite.exec("UPDATE OrderItem SET procurementUnitCost=300000");
      assert.equal(
        (await repo.load(dashboardPeriod(query, now))).profit!.netProfit,
        -238000,
      );
      f.sqlite.exec(`UPDATE "Order" SET status='CANCELLED'`);
      assert.equal(
        (await repo.load(dashboardPeriod(query, now))).profit!.netProfit,
        -7000,
      );
    });
  } finally {
    f.sqlite.close();
  }
});

for (const value of [-1, 0, 1.5, "123", 2147483648])
  test(`private product cost rejects invalid value ${value}`, () => {
    assert.equal(
      productPatchSchema.safeParse({ costPrice: value }).success,
      false,
    );
  });

test("migration adds only nullable cost and preserves all existing product/order snapshots", () => {
  const db = new DatabaseSync(":memory:");
  try {
    const files = readdirSync(
      new URL("../migrations/", import.meta.url),
    ).sort();
    for (const name of files.filter((n) => !n.startsWith("0014_")))
      db.exec(
        readFileSync(new URL("../migrations/" + name, import.meta.url), "utf8"),
      );
    db.exec(
      `INSERT INTO Category(id,nameRu,nameUz,slug,updatedAt) VALUES('c','A','A','c',1); INSERT INTO Product(id,categoryId,nameRu,nameUz,slug,price,updatedAt) VALUES('p','c','A','A','p',99,1);`,
    );
    const before = db
      .prepare("SELECT id,price,status,updatedAt FROM Product")
      .all();
    db.exec(financeSeed);
    db.exec("UPDATE OrderItem SET procurementUnitCost=9500 WHERE id='i'");
    const historicalOrders = db.prepare('SELECT * FROM "Order"').all();
    const historicalItems = db.prepare("SELECT * FROM OrderItem").all();
    db.exec(
      readFileSync(
        new URL("../migrations/0014_product_cost_price.sql", import.meta.url),
        "utf8",
      ),
    );
    assert.deepEqual(
      db.prepare("SELECT id,price,status,updatedAt FROM Product").all(),
      before,
    );
    assert.equal(
      db.prepare("SELECT costPrice FROM Product").get()!.costPrice,
      null,
    );
    assert.deepEqual(
      db.prepare('SELECT * FROM "Order"').all(),
      historicalOrders,
    );
    assert.deepEqual(
      db.prepare("SELECT * FROM OrderItem").all(),
      historicalItems,
    );
    assert.throws(() => db.exec("UPDATE Product SET costPrice=-1"));
    assert.throws(() => db.exec("UPDATE Product SET costPrice=1.5"));
  } finally {
    db.close();
  }
});

test("isolated Worker: only Admin can edit/read cost; public product/cart/checkout/order and channel never expose it", async () => {
  const r = await marketingRuntime();
  try {
    await r.db
      .prepare(
        "INSERT INTO Category(id,nameRu,nameUz,slug,updatedAt) VALUES('c','A','A','c',1)",
      )
      .run();
    const created = await r.admin("/catalog/products", "POST", {
      categoryId: "c",
      nameRu: "Тест",
      nameUz: "Sinov",
      slug: "cost-fixture",
      price: 200000,
      costPrice: 73001,
      status: "ACTIVE",
      publishToChannel: false,
    });
    assert.equal(created.status, 201);
    const product = (
      (await created.json()) as { product: { id: string; costPrice: number } }
    ).product;
    assert.equal(product.costPrice, 73001);
    const variantResponse = await r.admin(
      `/catalog/products/${product.id}/variants`,
      "POST",
      { sku: "COST-M", size: "M", stock: 10, isActive: true },
    );
    assert.equal(variantResponse.status, 201);
    const variant = (
      (await variantResponse.json()) as { variant: { id: string } }
    ).variant;
    for (const path of [
      "/catalog/products",
      "/catalog/products/cost-fixture",
    ]) {
      const response = await r.call(
        path,
        "GET",
        undefined,
        {},
        "https://preview.invalid",
      );
      assert.equal(response.status, 200);
      privateAbsent(await response.json());
    }
    assert.equal(
      (
        await r.call(`/admin/catalog/products/${product.id}`, "PATCH", {
          costPrice: 1,
        })
      ).status,
      401,
    );
    const buyer = await runtimeUser(r, 12345),
      headers = { authorization: "Bearer " + buyer.token };
    const payload = {
      productId: product.id,
      variantId: variant.id,
      quantity: 2,
      heightCm: 180,
      weightKg: 75,
    };
    const cart = await r.call(
      "/cart/items",
      "POST",
      payload,
      headers,
      "https://preview.invalid",
    );
    assert.equal(cart.status, 201);
    privateAbsent(await cart.json());
    const checkout = await r.call(
      "/checkout",
      "POST",
      recipient,
      { ...headers, "idempotency-key": randomUUID() },
      "https://preview.invalid",
    );
    assert.equal(checkout.status, 201);
    const order = ((await checkout.json()) as { order: { publicId: string } })
      .order;
    privateAbsent(order);
    const detail = await r.call(
      `/orders/${order.publicId}`,
      "GET",
      undefined,
      headers,
      "https://preview.invalid",
    );
    assert.equal(detail.status, 200);
    privateAbsent(await detail.json());
    assert.equal(
      (await r.db.prepare("SELECT procurementUnitCost FROM OrderItem").first())!
        .procurementUnitCost,
      73001,
    );
    assert.equal(
      (
        await r.admin(`/catalog/products/${product.id}`, "PATCH", {
          costPrice: null,
        })
      ).status,
      200,
    );
    assert.equal(
      (await r.db.prepare("SELECT procurementUnitCost FROM OrderItem").first())!
        .procurementUnitCost,
      73001,
    );
    assert.equal(r.outboundCalls(), 0);
  } finally {
    await r.mf.dispose();
  }
});
