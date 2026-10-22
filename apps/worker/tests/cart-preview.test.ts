import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { createHmac, randomBytes } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Miniflare, Log, LogLevel, convertV4MiniflareOptions } from "miniflare";

// All identities, products and cart writes exist only in this disposable local D1.
const botToken = "123456:" + randomBytes(32).toString("base64url");
let mf: Miniflare;
let owner: string;
let other: string;
type Cart = {
  id: string;
  subtotal: number;
  items: { id: string; quantity: number; product: { id: string } }[];
};
const call = (path: string, init: RequestInit = {}, token?: string) =>
  mf.dispatchFetch("https://preview.invalid/api" + path, {
    ...init,
    headers: {
      ...(init.body ? { "content-type": "application/json" } : {}),
      ...Object.fromEntries(new Headers(init.headers)),
      ...(token ? { authorization: "Bearer " + token } : {}),
    },
  } as never);
const cartBody = async (response: Awaited<ReturnType<typeof call>>) => {
  assert.ok(
    response.ok,
    `Cart HTTP ${response.status}: ${await response.clone().text()}`,
  );
  return ((await response.json()) as { cart: Cart }).cart;
};
async function login(id: number) {
  const params = new URLSearchParams({
    auth_date: String(Math.floor(Date.now() / 1000)),
    user: JSON.stringify({
      id,
      first_name: "Isolated cart fixture",
      language_code: "uz",
    }),
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
const item = {
  productId: "cart-fixture-product",
  variantId: "cart-fixture-variant",
  quantity: 1,
};
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
      // Cart requires only normal auth configuration, no Admin/payment credentials.
      bindings: {
        PREVIEW_ONLY: "1",
        COMMERCE_ENABLED: "0",
        PUBLIC_ORIGIN: "https://preview.invalid",
        JWT_SECRET: randomBytes(32).toString("hex"),
        TELEGRAM_BOT_TOKEN: botToken,
      },
      outboundService: async () => {
        throw new Error("Cart must not call external services");
      },
      log: new Log(LogLevel.NONE),
    }),
  );
  const db = await mf.getD1Database("DB");
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
      "INSERT INTO Category(id,nameRu,nameUz,slug,sortOrder,isActive,createdAt,updatedAt) VALUES('cart-fixture-category','Test','Sinov','cart-fixture-category',0,1,1,1)",
    )
    .run();
  await db
    .prepare(
      "INSERT INTO Product(id,categoryId,nameRu,nameUz,slug,price,currency,status,isFeatured,createdAt,updatedAt) VALUES('cart-fixture-product','cart-fixture-category','Test','Sinov','cart-fixture-product',290000,'UZS','ACTIVE',0,1,1)",
    )
    .run();
  await db
    .prepare(
      "INSERT INTO ProductVariant(id,productId,sku,size,color,stock,isActive,createdAt,updatedAt) VALUES('cart-fixture-variant','cart-fixture-product','CART-FIXTURE-M','M',NULL,NULL,1,1,1)",
    )
    .run();
  owner = await login(710001);
  other = await login(710002);
});
after(async () => {
  await mf?.dispose();
});

test("commerce=0: authenticated GET /cart uses current D1 User without Admin/payment config", async () => {
  const response = await call("/cart", {}, owner);
  assert.equal(response.status, 200);
  const cart = await cartBody(response);
  assert.ok(cart.id);
  assert.deepEqual(cart.items, []);
  assert.equal(response.headers.get("cache-control"), "no-store");
});
test("commerce=0: POST confirms cart item; PATCH/DELETE/clear remain authenticated and owner-scoped", async () => {
  const added = await call(
    "/cart/items",
    { method: "POST", body: JSON.stringify(item) },
    owner,
  );
  assert.equal(added.status, 201);
  const cart = await cartBody(added);
  assert.equal(cart.items.length, 1);
  assert.equal(cart.items[0]!.product.id, item.productId);
  assert.equal(cart.subtotal, 290000);
  const id = cart.items[0]!.id;
  assert.deepEqual((await cartBody(await call("/cart", {}, other))).items, []);
  assert.equal(
    (
      await call(
        `/cart/items/${id}`,
        { method: "PATCH", body: JSON.stringify({ quantity: 9 }) },
        other,
      )
    ).status,
    404,
  );
  assert.equal(
    (await call(`/cart/items/${id}`, { method: "DELETE" }, other)).status,
    404,
  );
  await call("/cart", { method: "DELETE" }, other);
  assert.equal(
    (await cartBody(await call("/cart", {}, owner))).items[0]!.quantity,
    1,
  );
  const patched = await cartBody(
    await call(
      `/cart/items/${id}`,
      { method: "PATCH", body: JSON.stringify({ quantity: 2 }) },
      owner,
    ),
  );
  assert.equal(patched.items[0]!.quantity, 2);
  assert.equal(patched.subtotal, 580000);
  assert.deepEqual(
    (
      await cartBody(
        await call(`/cart/items/${id}`, { method: "DELETE" }, owner),
      )
    ).items,
    [],
  );
  await cartBody(
    await call(
      "/cart/items",
      { method: "POST", body: JSON.stringify(item) },
      owner,
    ),
  );
  assert.deepEqual(
    (await cartBody(await call("/cart", { method: "DELETE" }, owner))).items,
    [],
  );
});
test("all Cart routes reject missing/forged JWT and never create anonymous carts", async () => {
  const db = await mf.getD1Database("DB");
  const count = async () =>
    db.prepare("SELECT count(*) AS n FROM Cart").first<{ n: number }>();
  const initial = await count();
  for (const [path, method, body] of [
    ["/cart", "GET"],
    ["/cart/items", "POST", item],
    ["/cart/items/missing", "PATCH", { quantity: 1 }],
    ["/cart/items/missing", "DELETE"],
    ["/cart", "DELETE"],
  ] as const) {
    for (const token of [undefined, "forged"])
      assert.equal(
        (
          await call(
            path,
            { method, ...(body ? { body: JSON.stringify(body) } : {}) },
            token,
          )
        ).status,
        401,
        `${method} ${path}`,
      );
  }
  assert.deepEqual(await count(), initial);
});
test("Cart rejects client-supplied userId and sees current User status on cached requests", async () => {
  assert.equal(
    (
      await call(
        "/cart/items",
        {
          method: "POST",
          body: JSON.stringify({ ...item, userId: "another-user" }),
        },
        owner,
      )
    ).status,
    400,
  );
  const db = await mf.getD1Database("DB");
  await db
    .prepare("UPDATE User SET status='BLOCKED' WHERE telegramId='710002'")
    .run();
  assert.equal((await call("/cart", {}, other)).status, 403);
});
for (const [label, path, method] of [
  ["checkout", "/checkout", "POST"],
  ["orders list", "/orders", "GET"],
  ["order mutation", "/orders/example/status", "PATCH"],
  ["payments", "/payments", "POST"],
  ["order payment", "/orders/example/payments", "POST"],
  ["payment instructions", "/payment-instructions", "GET"],
  ["order payment instructions", "/orders/example/payment-instructions", "GET"],
  ["payment proof upload", "/payments/example/proof", "POST"],
] as const)
  test(`commerce=0: ${label} stays blocked even with valid JWT`, async () => {
    const response = await call(path, { method }, owner);
    assert.equal(response.status, 503);
    assert.equal(
      ((await response.json()) as { code: string }).code,
      "COMMERCE_DISABLED",
    );
  });
test("preview configuration and runtime retain commerce=0; no order/payment fixtures are created", async () => {
  const config = JSON.parse(
    readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8"),
  );
  assert.equal(config.name, "voyey-local");
  assert.equal(config.vars.COMMERCE_ENABLED, "0");
  const health = await mf.dispatchFetch("https://preview.invalid/health");
  assert.equal(
    ((await health.json()) as { commerceEnabled: boolean }).commerceEnabled,
    false,
  );
  const db = await mf.getD1Database("DB");
  for (const table of ["Order", "Payment", "TelegramAdmin"])
    assert.equal(
      (await db
        .prepare(`SELECT count(*) AS n FROM "${table}"`)
        .first<{ n: number }>())!.n,
      0,
    );
});
