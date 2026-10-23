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
  D1CartRepository,
  D1OrderRepository,
} from "../../api/src/d1/repositories.js";
import { ManualOrderService } from "../../api/src/modules/admin/manual-orders.js";
import { prepareOrder } from "../../api/src/modules/checkout/domain.js";
import { toCartDto } from "../../api/src/modules/cart/service.js";
import { WEB_ADMIN_ACTOR } from "../../api/src/modules/admin/web-session.js";
import {
  addCartItemSchema,
  patchCartItemSchema,
} from "../../api/src/modules/cart/schemas.js";

const seed = `INSERT INTO User(id,telegramId,updatedAt) VALUES('u',900071,1);
INSERT INTO Category(id,nameRu,nameUz,slug,requiresBuyerMeasurements,updatedAt) VALUES('c','Fixture','Fixture','c',0,1);
INSERT INTO Product(id,categoryId,nameRu,nameUz,slug,price,status,updatedAt) VALUES('p','c','Fixture','Fixture','p',100001,'ACTIVE',1);
INSERT INTO ProductVariant(id,productId,sku,size,stock,preorderEnabled,updatedAt) VALUES('v','p','FIXTURE','',5,1,1);`;
const recipient = {
  fullName: "Synthetic buyer",
  phone: "+998900000000",
  city: "Fixture",
  address: "Fixture street",
  apartment: null,
  comment: null,
};
const input = (saleMode?: "IN_STOCK" | "PREORDER", quantity = 1) =>
  addCartItemSchema.parse({
    productId: "p",
    variantId: "v",
    quantity,
    ...(saleMode ? { saleMode } : {}),
  });
const checkout = (key = randomUUID()) =>
  new D1OrderRepository().checkout({
    userId: "u",
    publicId: randomUUID(),
    idempotencyKey: key,
    recipient,
    prepare: prepareOrder,
  });
function fixture() {
  const f = isolatedD1();
  f.sqlite.exec(seed);
  return f;
}

test("0020 keeps all legacy cart columns/IDs and installs mode-scoped uniqueness", () => {
  const db = new DatabaseSync(":memory:");
  try {
    for (const file of readdirSync(new URL("../migrations/", import.meta.url))
      .sort()
      .filter((f) => f < "0020"))
      db.exec(
        readFileSync(new URL("../migrations/" + file, import.meta.url), "utf8"),
      );
    db.exec(
      seed +
        "INSERT INTO Cart(id,userId,updatedAt) VALUES('cart','u',1); INSERT INTO CartItem(id,cartId,productId,variantId,quantity,heightCm,weightKg,updatedAt) VALUES('i','cart','p','v',2,180,75,1);",
    );
    const before = { ...db.prepare("SELECT * FROM CartItem").get()! };
    db.exec(
      readFileSync(
        new URL("../migrations/0020_cart_sale_modes.sql", import.meta.url),
        "utf8",
      ),
    );
    const { saleMode, ...after } = {
      ...db.prepare("SELECT * FROM CartItem").get()!,
    };
    assert.deepEqual(after, before);
    assert.equal(saleMode, "LEGACY");
    for (const mode of ["IN_STOCK", "PREORDER"]) {
      db.prepare(
        "INSERT INTO CartItem(id,cartId,productId,variantId,quantity,saleMode,updatedAt) VALUES(?,'cart','p','v',1,?,1)",
      ).run(mode, mode);
      assert.throws(
        () =>
          db
            .prepare(
              "INSERT INTO CartItem(id,cartId,productId,variantId,quantity,saleMode,updatedAt) VALUES(?,'cart','p','v',1,?,1)",
            )
            .run(mode + "duplicate", mode),
        /UNIQUE/,
      );
    }
    for (const invalid of [null, "", "UNKNOWN"])
      assert.throws(
        () =>
          db
            .prepare("UPDATE CartItem SET saleMode=? WHERE id='i'")
            .run(invalid),
        /CHECK|NOT NULL/,
      );
    assert.equal(db.prepare("PRAGMA foreign_key_check").all().length, 0);
  } finally {
    db.close();
  }
});

test("separate SKU modes merge only within their mode, preserve price, and cannot change mode through PATCH", async () => {
  const f = fixture();
  try {
    await f.run(async () => {
      const repo = new D1CartRepository();
      await repo.addItem("u", input("IN_STOCK", 2));
      await repo.addItem("u", input("PREORDER", 3));
      const cart = await repo.addItem("u", input("PREORDER", 1));
      assert.equal(cart.items.length, 2);
      assert.equal(
        cart.items.find((i) => i.saleMode === "PREORDER")!.quantity,
        4,
      );
      const dto = toCartDto(cart);
      assert.equal(dto.subtotal, 600006);
      assert.ok(
        dto.items.every(
          (i) => i.isAvailable && !i.checkoutEnabled && i.unitPrice === 100001,
        ),
      );
      assert.equal(
        patchCartItemSchema.safeParse({ saleMode: "IN_STOCK" }).success,
        false,
      );
      assert.equal(
        addCartItemSchema.safeParse({ ...input(), saleMode: "LEGACY" }).success,
        false,
      );
      assert.equal(
        (await prisma.productVariant.findUniqueOrThrow({ where: { id: "v" } }))
          .stock,
        5,
      );
    });
  } finally {
    f.sqlite.close();
  }
});

test("stock=0 allows permitted preorder only; revoked preorder permission blocks add/update and DTO availability", async () => {
  const f = fixture();
  try {
    await f.run(async () => {
      const repo = new D1CartRepository();
      f.sqlite.exec("UPDATE ProductVariant SET stock=0 WHERE id='v'");
      const cart = await repo.addItem("u", input("PREORDER"));
      await assert.rejects(repo.addItem("u", input("IN_STOCK")));
      await assert.rejects(repo.addItem("u", input()));
      f.sqlite.exec("UPDATE ProductVariant SET preorderEnabled=0 WHERE id='v'");
      await assert.rejects(repo.addItem("u", input("PREORDER")));
      await assert.rejects(
        repo.updateItem("u", cart.items[0]!.id, { quantity: 2 }),
      );
      assert.equal(
        toCartDto(await repo.getOrCreate("u")).items[0]!.isAvailable,
        false,
      );
      assert.equal(await prisma.cartItem.count(), 1);
    });
  } finally {
    f.sqlite.close();
  }
});

test("SKU-wide 99 limit and aggregate stock cannot be bypassed with legacy/explicit rows", async () => {
  const f = fixture();
  try {
    await f.run(async () => {
      const repo = new D1CartRepository();
      await repo.addItem("u", input(undefined, 3));
      await assert.rejects(repo.addItem("u", input("IN_STOCK", 3)));
      await repo.addItem("u", input("IN_STOCK", 2));
      await repo.addItem("u", input("PREORDER", 94));
      await assert.rejects(repo.addItem("u", input("PREORDER")));
      const cart = await repo.getOrCreate("u");
      await assert.rejects(
        repo.updateItem(
          "u",
          cart.items.find((i) => i.saleMode === "IN_STOCK")!.id,
          { quantity: 3 },
        ),
      );
      assert.equal(
        cart.items.reduce((n, i) => n + i.quantity, 0),
        99,
      );
      assert.equal(await prisma.order.count(), 0);
    });
  } finally {
    f.sqlite.close();
  }
});

test("stock=null stays legacy unlimited and never implicitly becomes a preorder", async () => {
  const f = fixture();
  try {
    await f.run(async () => {
      f.sqlite.exec("UPDATE ProductVariant SET stock=NULL WHERE id='v'");
      const repo = new D1CartRepository();
      const cart = await repo.addItem("u", input());
      assert.equal(cart.items[0]!.saleMode, "LEGACY");
      await assert.rejects(repo.addItem("u", input("IN_STOCK")));
      const key = randomUUID();
      await checkout(key);
      await checkout(key);
      assert.equal(await prisma.order.count(), 1);
      assert.equal(
        (await prisma.productVariant.findUniqueOrThrow({ where: { id: "v" } }))
          .stock,
        null,
      );
    });
  } finally {
    f.sqlite.close();
  }
});

for (const modes of [
  ["IN_STOCK"],
  ["PREORDER"],
  ["LEGACY", "PREORDER"],
  ["IN_STOCK", "PREORDER"],
]) {
  test(`checkout blocks ${modes.join("+")} atomically without reserving any stock`, async () => {
    const f = fixture();
    try {
      await f.run(async () => {
        const repo = new D1CartRepository();
        for (const mode of modes)
          await repo.addItem(
            "u",
            input(
              mode === "LEGACY" ? undefined : (mode as "IN_STOCK" | "PREORDER"),
            ),
          );
        await assert.rejects(
          checkout(),
          (e: unknown) => (e as { statusCode: number }).statusCode === 409,
        );
        assert.equal(await prisma.order.count(), 0);
        assert.equal(await prisma.orderItem.count(), 0);
        assert.equal(await prisma.auditLog.count(), 0);
        assert.equal(await prisma.cartItem.count(), modes.length);
        assert.equal(
          (
            await prisma.productVariant.findUniqueOrThrow({
              where: { id: "v" },
            })
          ).stock,
          5,
        );
        for (const mode of ["IN_STOCK", "PREORDER"])
          await assert.rejects(
            new ManualOrderService().create(WEB_ADMIN_ACTOR, randomUUID(), {
              userId: "u",
              recipient,
              items: [{ ...input(), saleMode: mode }],
            }),
          );
      });
    } finally {
      f.sqlite.close();
    }
  });
}

test("concurrent mode additions obey aggregate limits, and a late SQL error rolls back a new cart", async () => {
  const f = fixture();
  try {
    await f.run(async () => {
      f.sqlite.exec("UPDATE ProductVariant SET stock=99 WHERE id='v'");
      const repo = new D1CartRepository();
      const results = await Promise.allSettled([
        repo.addItem("u", input("IN_STOCK", 60)),
        repo.addItem("u", input("PREORDER", 60)),
      ]);
      assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
      assert.equal(await prisma.cartItem.count(), 1);
      await repo.clear("u");
      f.sqlite.exec(
        "DELETE FROM Cart; CREATE TRIGGER reject_mode BEFORE INSERT ON CartItem BEGIN SELECT RAISE(ABORT,'fixture-failure'); END",
      );
      await assert.rejects(
        repo.addItem("u", input("PREORDER")),
        /fixture-failure/,
      );
      assert.equal(await prisma.cart.count(), 0);
      assert.equal(await prisma.cartItem.count(), 0);
    });
  } finally {
    f.sqlite.close();
  }
});

test("actual Worker accepts explicit cart modes but old checkout/manual APIs cannot purchase them", async () => {
  const f = await marketingRuntime();
  try {
    await f.db.exec(seed);
    const user = await runtimeUser(f, 900072);
    const headers = {
      authorization: "Bearer " + user.token,
      "idempotency-key": randomUUID(),
    };
    const call = (path: string, method: string, body?: unknown) =>
      f.call(path, method, body, headers, "https://preview.invalid");
    for (const mode of ["IN_STOCK", "PREORDER"] as const)
      assert.equal(
        (await call("/cart/items", "POST", input(mode))).status,
        201,
      );
    assert.equal((await call("/checkout", "POST", recipient)).status, 409);
    assert.equal(
      (await call("/cart/items", "POST", { ...input(), saleMode: "LEGACY" }))
        .status,
      400,
    );
    const body = { userId: user.id, recipient, items: [input("PREORDER")] };
    assert.equal(
      (await f.admin("/orders/manual/preview", "POST", body)).status,
      400,
    );
    assert.equal(
      (
        await f.call("/admin/orders/manual", "POST", body, {
          ...f.signed,
          "idempotency-key": randomUUID(),
        })
      ).status,
      400,
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
