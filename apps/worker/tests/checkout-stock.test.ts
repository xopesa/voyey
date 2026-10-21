import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Miniflare, Log, LogLevel, convertV4MiniflareOptions } from "miniflare";
import {
  D1CartRepository,
  D1OrderRepository,
} from "../../api/src/d1/repositories.js";
import { prepareOrder } from "../../api/src/modules/checkout/domain.js";
import { CartStockExceededError } from "../../api/src/modules/cart/errors.js";
import type { OrderDto } from "../../api/src/modules/orders/types.js";
import { isolatedD1 } from "./helpers/sqlite.js";

// Commerce is enabled ONLY in disposable local D1. No live credentials or network calls.
const botToken = "123456:" + randomBytes(32).toString("base64url");
const recipient = {
  fullName: "Isolated Stock Buyer",
  phone: "+998900000000",
  city: "Test city",
  address: "Test address 1",
  apartment: null,
  comment: null,
};
const measurements = { heightCm: 180, weightKg: 75 };
let mf: Miniflare;
let db: Awaited<ReturnType<Miniflare["getD1Database"]>>;
let telegramId = 720000;
let outboundCalls = 0;
const call = (path: string, init: RequestInit = {}, token?: string) =>
  mf.dispatchFetch("https://preview.invalid/api" + path, {
    ...init,
    headers: {
      ...(init.body ? { "content-type": "application/json" } : {}),
      ...Object.fromEntries(new Headers(init.headers)),
      ...(token ? { authorization: "Bearer " + token } : {}),
    },
  } as never);

async function login() {
  const params = new URLSearchParams({
    auth_date: String(Math.floor(Date.now() / 1000)),
    user: JSON.stringify({ id: ++telegramId, first_name: "Stock fixture" }),
  });
  const text = [...params]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");
  const key = createHmac("sha256", "WebAppData").update(botToken).digest();
  params.set("hash", createHmac("sha256", key).update(text).digest("hex"));
  const response = await call("/auth/telegram", {
    method: "POST",
    body: JSON.stringify({ initData: params.toString() }),
  });
  assert.equal(response.status, 200);
  return ((await response.json()) as { accessToken: string }).accessToken;
}

async function product(stocks: (number | null)[]) {
  const id = randomUUID();
  await db
    .prepare(
      "INSERT INTO Product(id,categoryId,nameRu,nameUz,slug,price,status,updatedAt) VALUES(?,'stock-category','Fixture RU','Fixture UZ',?,100001,'ACTIVE',1)",
    )
    .bind(id, id)
    .run();
  const variants: string[] = [];
  for (const stock of stocks) {
    const variant = randomUUID();
    await db
      .prepare(
        "INSERT INTO ProductVariant(id,productId,sku,size,color,stock,isActive,updatedAt) VALUES(?,?,?,'M','gray',?,1,1)",
      )
      .bind(variant, id, variant, stock)
      .run();
    variants.push(variant);
  }
  return { id, variants };
}
async function add(
  token: string,
  productId: string,
  variantId: string,
  quantity: number,
) {
  const response = await call(
    "/cart/items",
    {
      method: "POST",
      body: JSON.stringify({ productId, variantId, quantity, ...measurements }),
    },
    token,
  );
  assert.equal(response.status, 201, await response.clone().text());
}
const checkout = (token: string, key = randomUUID()) =>
  call(
    "/checkout",
    {
      method: "POST",
      headers: { "idempotency-key": key },
      body: JSON.stringify(recipient),
    },
    token,
  );
async function order(response: Awaited<ReturnType<typeof call>>) {
  assert.equal(response.status, 201, await response.clone().text());
  return ((await response.json()) as { order: OrderDto }).order;
}
async function stock(variantId: string) {
  return (await db
    .prepare("SELECT stock FROM ProductVariant WHERE id=?")
    .bind(variantId)
    .first<{ stock: number | null }>())!.stock;
}
async function cartItems(token: string) {
  const response = await call("/cart", {}, token);
  assert.equal(response.status, 200);
  return (
    (await response.json()) as {
      cart: { items: { quantity: number; variant: { id: string } }[] };
    }
  ).cart.items;
}
async function orderCount(productId: string) {
  return (await db
    .prepare("SELECT count(*) AS n FROM OrderItem WHERE productId=?")
    .bind(productId)
    .first<{ n: number }>())!.n;
}
async function stockConflict(response: Awaited<ReturnType<typeof call>>) {
  assert.equal(response.status, 409, await response.clone().text());
  assert.match(
    await response.text(),
    /Requested quantity exceeds available stock/,
  );
}

before(async () => {
  mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      scriptPath: fileURLToPath(new URL("../dist/index.js", import.meta.url)),
      compatibilityDate: "2026-10-15",
      compatibilityFlags: ["nodejs_compat"],
      d1Databases: ["DB"],
      serviceBindings: {
        ASSETS: async () => new Response("missing", { status: 404 }),
      },
      bindings: {
        PREVIEW_ONLY: "1",
        COMMERCE_ENABLED: "1",
        PUBLIC_ORIGIN: "https://preview.invalid",
        ADMIN_ORIGIN: "https://admin.preview.invalid",
        JWT_SECRET: randomBytes(32).toString("hex"),
        ADMIN_PROXY_SECRET: randomBytes(32).toString("hex"),
        TELEGRAM_BOT_TOKEN: botToken,
        MANUAL_PAYMENT_CARD_HOLDER: "LOCAL TEST ONLY",
        MANUAL_PAYMENT_CARD_NUMBER: "LOCAL TEST ONLY",
        MANUAL_PAYMENT_INSTRUCTIONS_RU: "LOCAL TEST ONLY",
        MANUAL_PAYMENT_INSTRUCTIONS_UZ: "LOCAL TEST ONLY",
      },
      outboundService: async () => {
        outboundCalls++;
        throw new Error("Stock tests must not call external services");
      },
      log: new Log(LogLevel.NONE),
    }),
  );
  db = await mf.getD1Database("DB");
  for (const name of readdirSync(
    new URL("../migrations/", import.meta.url),
  ).sort())
    for (const sql of readFileSync(
      new URL("../migrations/" + name, import.meta.url),
      "utf8",
    )
      .split(/;\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean))
      await db.prepare(sql).run();
  await db
    .prepare(
      "INSERT INTO Category(id,nameRu,nameUz,slug,updatedAt) VALUES('stock-category','Test','Sinov','stock-category',1)",
    )
    .run();
});
after(async () => {
  await mf?.dispose();
});

test("stock=1: two authenticated users concurrently checkout -> 201/409, one order, stock=0", async () => {
  const {
    id,
    variants: [variant],
  } = await product([1]);
  const a = await login(),
    b = await login();
  await add(a, id, variant!, 1);
  await add(b, id, variant!, 1);
  const responses = await Promise.all([checkout(a), checkout(b)]);
  assert.deepEqual(responses.map((r) => r.status).sort(), [201, 409]);
  await stockConflict(responses.find((r) => r.status === 409)!);
  assert.equal(await stock(variant!), 0);
  assert.equal(await orderCount(id), 1);
  const winner = responses[0]!.status === 201 ? a : b;
  const loser = winner === a ? b : a;
  assert.equal((await cartItems(winner)).length, 0);
  assert.equal((await cartItems(loser))[0]!.quantity, 1);
});

test("finite stock=5 quantity=2 -> stock=3 and successful checkout clears cart", async () => {
  const {
    id,
    variants: [variant],
  } = await product([5]);
  const token = await login();
  await add(token, id, variant!, 2);
  await order(await checkout(token));
  assert.equal(await stock(variant!), 3);
  assert.deepEqual(await cartItems(token), []);
});

test("unlimited stock=null stays null after checkout", async () => {
  const {
    id,
    variants: [variant],
  } = await product([null]);
  const token = await login();
  await add(token, id, variant!, 3);
  assert.equal((await order(await checkout(token))).items[0]!.quantity, 3);
  assert.equal(await stock(variant!), null);
});

test("same user/key concurrent checkout and later retry never decrement twice", async () => {
  const {
    id,
    variants: [variant],
  } = await product([5]);
  const token = await login(),
    key = randomUUID();
  await add(token, id, variant!, 2);
  const [first, second] = await Promise.all([
    checkout(token, key),
    checkout(token, key),
  ]);
  const created = await order(first);
  assert.deepEqual(await order(second), created);
  assert.equal(await stock(variant!), 3);
  // A retry must not consume a newly populated cart either.
  await add(token, id, variant!, 1);
  assert.deepEqual(await order(await checkout(token, key)), created);
  assert.equal(await stock(variant!), 3);
  assert.equal(await orderCount(id), 1);
  assert.equal((await cartItems(token))[0]!.quantity, 1);
});

test("stock changed after cart: insufficient stock returns typed 409 with no order and cart retained", async () => {
  const {
    id,
    variants: [variant],
  } = await product([2]);
  const token = await login();
  await add(token, id, variant!, 2);
  await db
    .prepare("UPDATE ProductVariant SET stock=1 WHERE id=?")
    .bind(variant)
    .run();
  await stockConflict(await checkout(token));
  assert.equal(await stock(variant!), 1);
  assert.equal(await orderCount(id), 0);
  assert.equal((await cartItems(token))[0]!.quantity, 2);
});

test("multi-item insufficient stock rolls back the whole checkout and preserves every cart line", async () => {
  const {
    id,
    variants: [a, b],
  } = await product([2, 2]);
  const token = await login();
  await add(token, id, a!, 1);
  await add(token, id, b!, 2);
  await db
    .prepare("UPDATE ProductVariant SET stock=1 WHERE id=?")
    .bind(b)
    .run();
  await stockConflict(await checkout(token));
  assert.equal(await stock(a!), 2);
  assert.equal(await stock(b!), 1);
  assert.equal(await orderCount(id), 0);
  assert.equal((await cartItems(token)).length, 2);
});

test("multi-item sufficient stock decrements all finite variants and leaves unlimited unchanged", async () => {
  const {
    id,
    variants: [a, b, c],
  } = await product([2, 5, null]);
  const token = await login();
  await add(token, id, a!, 1);
  await add(token, id, b!, 2);
  await add(token, id, c!, 3);
  const created = await order(await checkout(token));
  assert.equal(created.items.length, 3);
  assert.equal(await stock(a!), 1);
  assert.equal(await stock(b!), 3);
  assert.equal(await stock(c!), null);
  assert.deepEqual(await cartItems(token), []);
  assert.equal(
    (await db
      .prepare('SELECT count(*) AS n FROM "Order" WHERE publicId=?')
      .bind(created.publicId)
      .first<{ n: number }>())!.n,
    1,
  );
});

test("checkout uses current price and preserves all order item snapshots after catalog changes", async () => {
  const {
    id,
    variants: [variant],
  } = await product([5]);
  const token = await login(),
    key = randomUUID();
  await add(token, id, variant!, 2);
  await db
    .prepare(
      "UPDATE Product SET price=210001,nameRu='Current RU',nameUz='Current UZ' WHERE id=?",
    )
    .bind(id)
    .run();
  const created = await order(await checkout(token, key));
  assert.equal(created.total, 420002);
  assert.equal(created.requiredPrepayment, 210001);
  assert.deepEqual(created.items, [
    {
      productId: id,
      variantId: variant,
      productNameRu: "Current RU",
      productNameUz: "Current UZ",
      productSlug: id,
      imageUrl: null,
      sku: variant,
      size: "M",
      color: "gray",
      originalUnitPrice: 210001,
      unitPrice: 210001,
      quantity: 2,
      lineTotal: 420002,
      ...measurements,
    },
  ]);
  await db
    .prepare(
      "UPDATE Product SET price=999,nameRu='Changed RU',nameUz='Changed UZ' WHERE id=?",
    )
    .bind(id)
    .run();
  await db
    .prepare(
      "UPDATE ProductVariant SET sku=?,size='XL',color='black' WHERE id=?",
    )
    .bind(randomUUID(), variant)
    .run();
  assert.deepEqual(await order(await checkout(token, key)), created);
  assert.equal(await stock(variant!), 3);
});

// In-memory SQLite lets us force a write exactly between reading stock and the CAS commit.
async function repositoryFixture(f: ReturnType<typeof isolatedD1>) {
  f.sqlite.exec(`
    INSERT INTO User(id,telegramId,updatedAt) VALUES('buyer','720999',1);
    INSERT INTO Category(id,nameRu,nameUz,slug,updatedAt) VALUES('category','Test','Test','category',1);
    INSERT INTO Product(id,categoryId,nameRu,nameUz,slug,price,status,updatedAt) VALUES('product','category','Test','Test','product',100,'ACTIVE',1);
    INSERT INTO ProductVariant(id,productId,sku,size,stock,updatedAt) VALUES('variant','product','TEST','M',2,1);
  `);
  await new D1CartRepository().addItem("buyer", {
    productId: "product",
    variantId: "variant",
    quantity: 2,
    ...measurements,
  });
  return {
    userId: "buyer",
    publicId: "STZ-STOCK-TEST",
    idempotencyKey: "checkout-stock-test-key",
    recipient,
    prepare: prepareOrder,
  };
}

test("CAS rejects stock changed after validation but before commit, then returns stock conflict", async () => {
  const f = isolatedD1();
  try {
    await f.run(async () => {
      const input = await repositoryFixture(f);
      let validations = 0;
      await assert.rejects(
        new D1OrderRepository().checkout({
          ...input,
          prepare(cart) {
            validations++;
            const prepared = prepareOrder(cart);
            // Simulate a concurrent transaction, without creating any live records.
            f.sqlite.exec(
              "UPDATE ProductVariant SET stock=1 WHERE id='variant'",
            );
            return prepared;
          },
        }),
        CartStockExceededError,
      );
      assert.equal(
        validations,
        2,
        "CAS must retry against the new stock snapshot",
      );
      assert.equal(
        f.sqlite.prepare("SELECT stock FROM ProductVariant").get()!.stock,
        1,
      );
      assert.equal(
        f.sqlite.prepare('SELECT count(*) AS n FROM "Order"').get()!.n,
        0,
      );
      assert.equal(
        f.sqlite.prepare("SELECT quantity FROM CartItem").get()!.quantity,
        2,
      );
    });
  } finally {
    f.sqlite.close();
  }
});

test("a late SQL failure rolls back the stock decrement, order, audit and cart deletion together", async () => {
  const f = isolatedD1();
  try {
    await f.run(async () => {
      const input = await repositoryFixture(f);
      const revision = f.sqlite.prepare("SELECT version FROM _Revision").get()!
        .version;
      f.sqlite.exec(
        "CREATE TRIGGER fail_order_item BEFORE INSERT ON OrderItem BEGIN SELECT RAISE(ABORT,'isolated late failure'); END;",
      );
      await assert.rejects(
        new D1OrderRepository().checkout(input),
        /isolated late failure/,
      );
      assert.equal(
        f.sqlite.prepare("SELECT stock FROM ProductVariant").get()!.stock,
        2,
      );
      assert.equal(
        f.sqlite.prepare('SELECT count(*) AS n FROM "Order"').get()!.n,
        0,
      );
      assert.equal(
        f.sqlite.prepare("SELECT count(*) AS n FROM AuditLog").get()!.n,
        0,
      );
      assert.equal(
        f.sqlite.prepare("SELECT quantity FROM CartItem").get()!.quantity,
        2,
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

test("unique cart/variant constraint prevents splitting one variant across multiple cart lines", async () => {
  const f = isolatedD1();
  try {
    await f.run(async () => {
      await repositoryFixture(f);
      assert.throws(
        () =>
          f.sqlite.exec(`
        INSERT INTO CartItem(id,cartId,productId,variantId,quantity,heightCm,weightKg,updatedAt)
        SELECT 'duplicate',cartId,productId,variantId,1,heightCm,weightKg,1 FROM CartItem;
      `),
        /UNIQUE constraint failed: CartItem.cartId, CartItem.variantId/,
      );
      await assert.rejects(
        new D1CartRepository().addItem("buyer", {
          productId: "product",
          variantId: "variant",
          quantity: 1,
          ...measurements,
        }),
        CartStockExceededError,
      );
      assert.equal(
        f.sqlite.prepare("SELECT count(*) AS n FROM CartItem").get()!.n,
        1,
      );
      assert.equal(
        f.sqlite.prepare("SELECT quantity FROM CartItem").get()!.quantity,
        2,
      );
    });
  } finally {
    f.sqlite.close();
  }
});

test("live preview config remains commerce=0 and isolated stock tests make no external calls", () => {
  const config = JSON.parse(
    readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8"),
  );
  assert.equal(config.name, "stenzo-free-preview");
  assert.equal(config.vars.COMMERCE_ENABLED, "0");
  assert.equal(outboundCalls, 0);
});
