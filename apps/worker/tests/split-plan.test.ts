import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma } from "@stenzo/database";
import { isolatedD1 } from "./helpers/sqlite.js";
import { marketingRuntime } from "./helpers/marketing-runtime.js";
import { runtimeUser } from "./helpers/customer-operations.js";
import {
  D1CartRepository,
  D1OrderRepository,
} from "../../api/src/d1/repositories.js";
import { prepareOrder } from "../../api/src/modules/checkout/domain.js";
import {
  SplitCheckoutPlanner,
  proposeDiscountAllocation,
} from "../../api/src/modules/checkout/split-plan.js";
import { toCartDto } from "../../api/src/modules/cart/service.js";

const seed = `INSERT INTO User(id,telegramId,updatedAt) VALUES('u',900081,1);
INSERT INTO Category(id,nameRu,nameUz,slug,requiresBuyerMeasurements,updatedAt) VALUES('c','Fixture','Fixture','c',0,1);
INSERT INTO Product(id,categoryId,nameRu,nameUz,slug,price,status,updatedAt) VALUES('p','c','Fixture','Fixture','p',100001,'ACTIVE',1);
INSERT INTO ProductVariant(id,productId,sku,size,stock,preorderEnabled,updatedAt) VALUES('v','p','FIXTURE','',5,1,1);`;
const input = (saleMode?: "IN_STOCK" | "PREORDER") => ({
  productId: "p",
  variantId: "v",
  quantity: 1,
  heightCm: null,
  weightKg: null,
  saleMode,
});
function fixture() {
  const f = isolatedD1();
  f.sqlite.exec(seed);
  return f;
}
const counts = async () => [
  await prisma.order.count(),
  await prisma.orderItem.count(),
  await prisma.payment.count(),
  await prisma.auditLog.count(),
];

for (const modes of [
  ["IN_STOCK"],
  ["PREORDER"],
  ["IN_STOCK", "PREORDER"],
] as const) {
  test(`preparation ${modes.join("+")}: group IDs, snapshots and reserve intent only`, async () => {
    const f = fixture();
    try {
      await f.run(async () => {
        const cart = new D1CartRepository();
        for (const mode of modes) await cart.addItem("u", input(mode));
        const dto = toCartDto(await cart.getOrCreate("u"));
        for (const mode of modes) {
          assert.equal(dto.groups![mode].quantity, 1);
          assert.equal(dto.groups![mode].subtotal, 100001);
        }
        const plan = await new SplitCheckoutPlanner(true).prepare(
          "u",
          randomUUID(),
        );
        assert.equal(plan.executable, false);
        assert.equal(plan.orders.length, modes.length);
        assert.equal(plan.subtotal, modes.length * 100001);
        assert.equal(
          plan.inventory.length,
          modes.some((mode) => mode === "IN_STOCK") ? 1 : 0,
        );
        assert.equal(
          new Set(plan.orders.map((o) => o.plannedOrderId)).size,
          modes.length,
        );
        for (const order of plan.orders) {
          assert.ok(order.plannedOrderId.startsWith(plan.checkoutGroupId));
          assert.equal(order.items[0]!.saleMode, order.saleMode);
          assert.equal(
            order.items[0]!.inventoryReservedQuantity,
            order.saleMode === "IN_STOCK" ? 1 : 0,
          );
          assert.equal(order.items[0]!.catalogSnapshot!.category!.id, "c");
          assert.equal("requiredPrepayment" in order, false);
          assert.equal("status" in order, false);
        }
        assert.deepEqual(await counts(), [0, 0, 0, 0]);
        assert.equal(
          (
            await prisma.productVariant.findUniqueOrThrow({
              where: { id: "v" },
            })
          ).stock,
          5,
        );
        assert.equal(await prisma.cartItem.count(), modes.length);
      });
    } finally {
      f.sqlite.close();
    }
  });
}

test("default preparation and every commit attempt remain disabled", async () => {
  const f = fixture();
  try {
    await f.run(async () => {
      await new D1CartRepository().addItem("u", input("IN_STOCK"));
      await assert.rejects(
        new SplitCheckoutPlanner().prepare("u", randomUUID()),
        /disabled/,
      );
      for (const enabled of [false, true])
        assert.throws(
          () => new SplitCheckoutPlanner(enabled).commit(),
          /blocked/,
        );
      assert.deepEqual(await counts(), [0, 0, 0, 0]);
    });
  } finally {
    f.sqlite.close();
  }
});

for (const [mode, sql] of [
  ["IN_STOCK", "UPDATE ProductVariant SET stock=0"],
  ["IN_STOCK", "UPDATE ProductVariant SET stock=NULL"],
  ["PREORDER", "UPDATE ProductVariant SET preorderEnabled=0"],
  ["PREORDER", "UPDATE Product SET status='INACTIVE'"],
  ["IN_STOCK", "UPDATE User SET status='BLOCKED'"],
] as const)
  test(`invalid plan ${mode}: ${sql}`, async () => {
    const f = fixture();
    try {
      await f.run(async () => {
        await new D1CartRepository().addItem("u", input(mode));
        f.sqlite.exec(sql);
        await assert.rejects(
          new SplitCheckoutPlanner(true).prepare("u", randomUUID()),
        );
        assert.deepEqual(await counts(), [0, 0, 0, 0]);
        assert.equal(await prisma.cartItem.count(), 1);
      });
    } finally {
      f.sqlite.close();
    }
  });

test("preorder stock zero and legacy mixed rejection never mutate inventory", async () => {
  const f = fixture();
  try {
    await f.run(async () => {
      const cart = new D1CartRepository();
      await cart.addItem("u", input("PREORDER"));
      f.sqlite.exec("UPDATE ProductVariant SET stock=0");
      const plan = await new SplitCheckoutPlanner(true).prepare(
        "u",
        randomUUID(),
      );
      assert.deepEqual(plan.inventory, []);
      f.sqlite.exec("UPDATE ProductVariant SET stock=5");
      await cart.addItem("u", input());
      await assert.rejects(
        new SplitCheckoutPlanner(true).prepare("u", randomUUID()),
        /LEGACY/,
      );
      assert.equal(toCartDto(await cart.getOrCreate("u")).hasLegacyItems, true);
      assert.deepEqual(await counts(), [0, 0, 0, 0]);
    });
  } finally {
    f.sqlite.close();
  }
});

test("repeat preparation is deterministic; changed catalog yields a different quote, not a persisted replay", async () => {
  const f = fixture();
  try {
    await f.run(async () => {
      await new D1CartRepository().addItem("u", input("IN_STOCK"));
      const key = randomUUID(),
        planner = new SplitCheckoutPlanner(true);
      const [a, b] = await Promise.all([
        planner.prepare("u", key),
        planner.prepare("u", key),
      ]);
      assert.deepEqual(a, b);
      assert.deepEqual(await planner.prepare("u", ` ${key} `), a);
      f.sqlite.exec("UPDATE Product SET nameRu='Changed',price=200001");
      const c = await planner.prepare("u", key);
      assert.equal(c.checkoutGroupId, a.checkoutGroupId);
      assert.notEqual(c.requestFingerprint, a.requestFingerprint);
      assert.equal(a.orders[0]!.items[0]!.productNameRu, "Fixture");
      assert.equal(a.orders[0]!.items[0]!.unitPrice, 100001);
      assert.equal(await prisma.cartItem.count(), 1);
      assert.deepEqual(await counts(), [0, 0, 0, 0]);
    });
  } finally {
    f.sqlite.close();
  }
});

test("concurrent plans for the last unit only validate intent and never claim reservations", async () => {
  const f = fixture();
  try {
    await f.run(async () => {
      f.sqlite.exec("UPDATE ProductVariant SET stock=1");
      await new D1CartRepository().addItem("u", input("IN_STOCK"));
      const planner = new SplitCheckoutPlanner(true);
      await Promise.all([
        planner.prepare("u", randomUUID()),
        planner.prepare("u", randomUUID()),
      ]);
      assert.equal(
        (await prisma.productVariant.findUniqueOrThrow({ where: { id: "v" } }))
          .stock,
        1,
      );
      assert.deepEqual(await counts(), [0, 0, 0, 0]);
    });
  } finally {
    f.sqlite.close();
  }
});

test("a legacy checkout key cannot be repurposed for a split plan", async () => {
  const f = fixture();
  try {
    await f.run(async () => {
      const cart = new D1CartRepository(),
        key = randomUUID();
      await cart.addItem("u", { ...input("IN_STOCK"), saleMode: undefined });
      await new D1OrderRepository().checkout({
        userId: "u",
        publicId: randomUUID(),
        idempotencyKey: key,
        recipient: {
          fullName: "Synthetic buyer",
          phone: "+998900000000",
          city: "Fixture",
          address: "Fixture street",
          apartment: null,
          comment: null,
        },
        prepare: prepareOrder,
      });
      await cart.addItem("u", input("PREORDER"));
      await assert.rejects(
        new SplitCheckoutPlanner(true).prepare("u", key),
        /existing order/,
      );
      assert.equal(await prisma.order.count(), 1);
      assert.equal(await prisma.cartItem.count(), 1);
    });
  } finally {
    f.sqlite.close();
  }
});

test("discount proposal is exact, order independent and does not redeem anything", () => {
  const groups = [
    { key: "IN_STOCK", subtotal: 101 },
    { key: "PREORDER", subtotal: 100 },
  ];
  assert.deepEqual(proposeDiscountAllocation(groups, 3), [
    { key: "IN_STOCK", discount: 2 },
    { key: "PREORDER", discount: 1 },
  ]);
  assert.deepEqual(
    proposeDiscountAllocation([...groups].reverse(), 3).reverse(),
    proposeDiscountAllocation(groups, 3),
  );
  for (let d = 0; d <= 201; d++)
    assert.equal(
      proposeDiscountAllocation(groups, d).reduce((n, g) => n + g.discount, 0),
      d,
    );
  assert.throws(() => proposeDiscountAllocation(groups, 202));
  assert.throws(() => proposeDiscountAllocation(groups, 1.5));
  assert.deepEqual(
    proposeDiscountAllocation([{ key: "EMPTY", subtotal: 0 }], 0),
    [{ key: "EMPTY", discount: 0 }],
  );
});

test("actual Worker exposes cart groups but no new customer/Admin checkout route", async () => {
  const f = await marketingRuntime();
  try {
    await f.db.exec(seed);
    const user = await runtimeUser(f, 900082);
    const headers = {
      authorization: "Bearer " + user.token,
      "idempotency-key": randomUUID(),
    };
    for (const mode of ["IN_STOCK", "PREORDER"] as const)
      assert.equal(
        (
          await f.call(
            "/cart/items",
            "POST",
            input(mode),
            headers,
            "https://preview.invalid",
          )
        ).status,
        201,
      );
    const cartResponse = await f.call(
      "/cart",
      "GET",
      undefined,
      headers,
      "https://preview.invalid",
    );
    const body = (await cartResponse.json()) as {
      cart: { groups: Record<string, { quantity: number }> };
    };
    assert.equal(body.cart.groups.IN_STOCK!.quantity, 1);
    assert.equal(body.cart.groups.PREORDER!.quantity, 1);
    const recipient = {
      fullName: "Synthetic buyer",
      phone: "+998900000000",
      city: "Fixture",
      address: "Fixture street",
    };
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
      409,
    );
    for (const path of ["/checkout/split", "/admin/orders/split"])
      assert.equal(
        (
          await f.call(
            path,
            "POST",
            recipient,
            path.startsWith("/admin") ? f.signed : headers,
            path.startsWith("/admin")
              ? "https://admin.preview.invalid"
              : "https://preview.invalid",
          )
        ).status,
        404,
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
