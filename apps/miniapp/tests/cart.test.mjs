import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import { URL, URLSearchParams } from "node:url";
import ts from "typescript";
import * as React from "react";
import * as jsxRuntime from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";
const { AbortController, Headers, setTimeout, clearTimeout } = globalThis;
function load(file, globals = {}) {
  const code = ts.transpileModule(
    readFileSync(new URL(`../src/${file}`, import.meta.url), "utf8"),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        jsx: ts.JsxEmit.ReactJSX,
      },
    },
  ).outputText;
  const exports = {};
  runInNewContext(code, {
    exports,
    URLSearchParams,
    Headers,
    AbortController,
    setTimeout,
    clearTimeout,
    ...globals,
  });
  return exports;
}
const cartLib = load("lib/cart.ts");
const catalog = load("lib/catalog.ts");
const productLib = load("lib/product.ts", { require: () => catalog });
const navigation = load("lib/product-navigation.ts", {
  require: () => catalog,
});
const i18n = load("lib/i18n.ts");
const { CartResource } = load("lib/cart-resource.ts");
const item = {
  id: "test-item",
  quantity: 2,
  heightCm: null,
  weightKg: 75,
  unitPrice: 425000,
  lineTotal: 850000,
  currency: "UZS",
  isAvailable: true,
  product: {
    id: "test-product",
    nameRu: "Тестовое худи",
    nameUz: "Test hudi",
    slug: "test-hudi",
    imageUrl: null,
  },
  variant: {
    id: "test-variant",
    sku: "TEST-ONLY",
    size: "M",
    color: "Black",
    stock: 3,
  },
};
const cart = {
  id: "test-cart",
  items: [item],
  subtotal: 850000,
  currency: "UZS",
  updatedAt: "2026-09-30T00:00:00Z",
};
const empty = { ...cart, items: [], subtotal: 0 };
const transport = (overrides = {}) => ({
  get: async () => cart,
  update: async () => cart,
  remove: async () => empty,
  clear: async () => empty,
  ...overrides,
});
function client(fetch) {
  return load("lib/api-client.ts", {
    fetch,
    require: (name) =>
      name === "./catalog"
        ? catalog
        : name === "./product"
          ? productLib
          : cartLib,
  });
}
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

test("Cart DTO accepts missing measurements and unavailable lines but rejects malformed money/stock/IDs", () => {
  assert.equal(cartLib.isCart(cart), true);
  assert.equal(cartLib.isCart(empty), true);
  assert.equal(
    cartLib.isCart({
      ...cart,
      items: [
        { ...item, isAvailable: false, variant: { ...item.variant, stock: 0 } },
      ],
    }),
    true,
  );
  for (const bad of [
    { ...cart, subtotal: NaN },
    { ...cart, currency: "USD" },
    { ...cart, items: [item, item] },
    { ...cart, items: [{ ...item, heightCm: 99 }] },
    { ...cart, items: [{ ...item, variant: { ...item.variant, stock: -1 } }] },
  ])
    assert.equal(cartLib.isCart(bad), false);
  for (const patch of [
    { quantity: 1 },
    { quantity: 99 },
    { heightCm: 100, weightKg: 300 },
    { heightCm: null, weightKg: null },
  ])
    assert.equal(cartLib.validCartPatch(patch), true);
  for (const patch of [
    {},
    { quantity: 100 },
    { quantity: 1.5 },
    { heightCm: 251 },
    { weightKg: 29 },
    { sourceUrl: "private" },
    { quantity: undefined },
  ])
    assert.equal(cartLib.validCartPatch(patch), false);
});

test("stock caps increase at 99, supports null stock and allows repairing a line after stock decreases", () => {
  assert.equal(cartLib.cartQuantityLimit(item), 3);
  assert.equal(cartLib.cartDecreasedQuantity(item), 1);
  assert.equal(
    cartLib.cartDecreasedQuantity({
      ...item,
      quantity: 8,
      isAvailable: false,
      variant: { ...item.variant, stock: 2 },
    }),
    2,
  );
  assert.equal(
    cartLib.cartQuantityLimit({
      ...item,
      variant: { ...item.variant, stock: null },
    }),
    99,
  );
  assert.equal(
    cartLib.cartQuantityLimit({
      ...item,
      variant: { ...item.variant, stock: 150 },
    }),
    99,
  );
  assert.equal(cartLib.cartCanDecrease(item), true);
  assert.equal(cartLib.cartCanDecrease({ ...item, quantity: 1 }), false);
  assert.equal(
    cartLib.cartCanDecrease({
      ...item,
      isAvailable: false,
      variant: { ...item.variant, stock: 1 },
    }),
    true,
  );
  assert.equal(
    cartLib.cartCanDecrease({
      ...item,
      isAvailable: false,
      variant: { ...item.variant, stock: 0 },
    }),
    false,
  );
  assert.equal(
    cartLib.cartCanDecrease({
      ...item,
      isAvailable: false,
      variant: { ...item.variant, stock: null },
    }),
    false,
  );
});

test("displayed totals use server amounts, no decimals, space grouping and rounded 50% estimate", () => {
  assert.equal(cartLib.formatCartAmount(cart.subtotal, "сум"), "850 000 сум");
  assert.equal(cartLib.formatCartAmount(cart.subtotal, "so‘m"), "850 000 so‘m");
  assert.equal(cartLib.displayedPrepayment(850000), 425000);
  assert.equal(cartLib.displayedPrepayment(850001), 425001);
  assert.equal(cartLib.displayedPrepayment(0), 0);
  assert.equal(cartLib.formatCartAmount(100.5, "сум"), "101 сум");
});

test("Cart client uses authenticated existing GET/PATCH/DELETE proxy endpoints and validates acknowledgement", async () => {
  const calls = [];
  const signal = new AbortController().signal;
  const api = client(async (url, options) => {
    calls.push({ url, options });
    return {
      ok: true,
      json: async () => ({
        cart:
          options.method === "DELETE"
            ? empty
            : {
                ...cart,
                items: [{ ...item, quantity: 3, heightCm: 180, weightKg: 70 }],
                subtotal: 1275000,
              },
      }),
    };
  });
  await api.getCart("fixture-token", signal);
  const updated = await api.updateCartItem(
    "test-item",
    { quantity: 3, heightCm: 180, weightKg: 70 },
    "fixture-token",
    signal,
  );
  assert.equal(updated.subtotal, 1275000);
  await api.deleteCartItem("test-item", "fixture-token", signal);
  await api.clearCart("fixture-token", signal);
  assert.deepEqual(
    calls.map((call) => call.url),
    [
      "/api/cart",
      "/api/cart/items/test-item",
      "/api/cart/items/test-item",
      "/api/cart",
    ],
  );
  assert.deepEqual(
    calls.map((call) => call.options.method),
    [undefined, "PATCH", "DELETE", "DELETE"],
  );
  for (const call of calls) {
    assert.equal(
      call.options.headers.get("Authorization"),
      "Bearer fixture-token",
    );
    assert.equal(call.options.signal, signal);
    assert.equal(call.options.cache, "no-store");
  }
  assert.deepEqual(JSON.parse(calls[1].options.body), {
    quantity: 3,
    heightCm: 180,
    weightKg: 70,
  });
  const unconfirmed = client(async () => ({
    ok: true,
    json: async () => ({ cart }),
  }));
  await assert.rejects(() =>
    unconfirmed.updateCartItem(item.id, { quantity: 3 }, "fixture-token"),
  );
  await assert.rejects(() =>
    unconfirmed.deleteCartItem(item.id, "fixture-token"),
  );
  await assert.rejects(() => unconfirmed.clearCart("fixture-token"));
  await assert.rejects(() =>
    client(() => {
      throw Error("No request permitted");
    }).getCart(""),
  );
  await assert.rejects(() =>
    client(() => {
      throw Error("No request permitted");
    }).updateCartItem(item.id, { quantity: 0 }, "fixture-token"),
  );
  await assert.rejects(() =>
    client(async () => ({
      ok: true,
      json: async () => ({ cart: null }),
    })).getCart("fixture-token"),
  );
});

test("client preserves auth, stock and missing-item HTTP statuses and safely encodes item IDs", async () => {
  for (const status of [401, 403, 404, 409, 500]) {
    const api = client(async () => ({ ok: false, status }));
    await assert.rejects(
      () => api.updateCartItem(item.id, { heightCm: null }, "fixture-token"),
      (error) => error.status === status,
    );
  }
  let path;
  await client(async (url) => {
    path = url;
    return { ok: true, json: async () => ({ cart: empty }) };
  }).deleteCartItem("id/with &?", "fixture-token");
  assert.equal(path, "/api/cart/items/id%2Fwith%20%26%3F");
});

test("mutation keeps confirmed quantity/prices until response, serialises operations and then replaces the whole snapshot", async () => {
  const pending = deferred();
  const calls = [];
  const resource = new CartResource(
    transport({
      update: (...args) => {
        calls.push(args);
        return pending.promise;
      },
    }),
    () => "fixture-token",
  );
  await resource.load();
  const mutation = resource.update(item.id, { quantity: 3 });
  assert.equal(resource.snapshot().cart, cart);
  assert.equal(resource.snapshot().cart.items[0].quantity, 2);
  assert.equal(resource.snapshot().cart.subtotal, 850000);
  assert.equal(resource.snapshot().operation.itemId, item.id);
  assert.equal(await resource.remove(item.id), false);
  assert.equal(await resource.clear(), false);
  assert.equal(await resource.load(), false);
  assert.equal(calls.length, 1);
  const confirmed = {
    ...cart,
    subtotal: 1234567,
    items: [{ ...item, quantity: 3, lineTotal: 1234567, unitPrice: 411522 }],
  };
  pending.resolve(confirmed);
  assert.equal(await mutation, true);
  assert.equal(resource.snapshot().cart, confirmed);
  assert.equal(resource.snapshot().operation, undefined);
  assert.equal(resource.snapshot().success.type, "update");
});

test("failed quantity/remove/clear keeps the previous cart and exposes the correct operation error", async () => {
  for (const type of ["update", "remove", "clear"]) {
    const failing = async () => {
      throw { status: 409 };
    };
    const resource = new CartResource(
      transport({ [type]: failing }),
      () => "fixture-token",
    );
    await resource.load();
    assert.equal(
      await (type === "update"
        ? resource.update(item.id, { quantity: 3 })
        : type === "remove"
          ? resource.remove(item.id)
          : resource.clear()),
      false,
    );
    assert.equal(resource.snapshot().cart, cart);
    assert.equal(resource.snapshot().failure.kind, "stock");
    assert.equal(resource.snapshot().failure.operation.type, type);
    assert.equal(resource.snapshot().success, undefined);
    assert.equal(resource.snapshot().operation, undefined);
  }
});

test("measurements patch sends only entered fields; removal/clear become empty only on confirmation", async () => {
  const pending = deferred();
  let body;
  const resource = new CartResource(
    transport({
      update: async (id, patch) => {
        body = patch;
        return { ...cart, items: [{ ...item, ...patch }] };
      },
      remove: () => pending.promise,
    }),
    () => "fixture-token",
  );
  await resource.load();
  await resource.update(item.id, { heightCm: 180, weightKg: 70 });
  assert.equal(body.heightCm, 180);
  assert.equal(Object.hasOwn(body, "quantity"), false);
  assert.equal(resource.snapshot().cart.items[0].quantity, 2);
  const removal = resource.remove(item.id);
  assert.equal(resource.snapshot().cart.items.length, 1);
  pending.resolve(empty);
  await removal;
  assert.equal(resource.snapshot().cart.items.length, 0);
  assert.equal(resource.snapshot().success.type, "remove");
  await resource.clear();
  assert.equal(resource.snapshot().success.type, "clear");
});

test("session pending does not load cart, missing token and transport errors have retryable states", async () => {
  let calls = 0;
  let token = null;
  const resource = new CartResource(
    transport({
      get: async () => {
        calls++;
        return empty;
      },
    }),
    () => token,
  );
  assert.equal(resource.snapshot().status, "loading");
  assert.equal(calls, 0);
  await resource.load();
  assert.equal(calls, 0);
  assert.equal(resource.snapshot().failure.kind, "auth");
  token = "fixture-token";
  await resource.load();
  assert.equal(resource.snapshot().status, "success");
  assert.equal(resource.snapshot().cart.items.length, 0);
  for (const [status, kind] of [
    [401, "auth"],
    [403, "access"],
    [404, "missing"],
    [409, "stock"],
    [500, "request"],
  ]) {
    const broken = new CartResource(
      transport({
        get: async () => {
          throw { status };
        },
      }),
      () => token,
    );
    await broken.load();
    assert.equal(broken.snapshot().failure.kind, kind);
    assert.equal(broken.snapshot().status, "error");
    assert.equal(broken.snapshot().cart, undefined);
  }
});

test("cancellation/session change cannot commit a stale mutation; request timeout stays an error", async () => {
  const pending = deferred();
  const resource = new CartResource(
    transport({ update: () => pending.promise }),
    () => "fixture-token",
  );
  await resource.load();
  const mutation = resource.update(item.id, { quantity: 3 });
  resource.sessionFailure();
  pending.resolve(cart);
  assert.equal(await mutation, false);
  assert.equal(resource.snapshot().failure.kind, "auth");
  assert.equal(resource.snapshot().cart, undefined);
  const timed = new CartResource(
    transport({
      get: (token, signal) =>
        new Promise((resolve, reject) =>
          signal.addEventListener("abort", () => reject(Error("Timeout")), {
            once: true,
          }),
        ),
    }),
    () => "fixture-token",
    5,
  );
  await timed.load();
  assert.equal(timed.snapshot().failure.kind, "request");
  assert.equal(timed.snapshot().status, "error");
});

function renderCart(locale, state) {
  let exports;
  const preferences = {
    usePreferences: () => ({
      t: (key, values) => i18n.translate(locale, key, values),
      localizedText: (values) => i18n.localizedText(locale, values),
    }),
  };
  const modules = new Map();
  function require(name) {
    if (name === "react") return React;
    if (name === "react/jsx-runtime") return jsxRuntime;
    if (name === "next/navigation") return { useRouter: () => ({ push() {} }) };
    if (name === "next/link")
      return {
        default: ({ href, children, ...props }) =>
          React.createElement("a", { href, ...props }, children),
      };
    if (name === "next/image")
      return {
        default: ({ src, alt }) => React.createElement("img", { src, alt }),
      };
    if (name.endsWith("/PreferencesProvider")) return preferences;
    if (name.endsWith("/ui/Icon"))
      return { Icon: () => React.createElement("svg") };
    if (name.endsWith("/ui/ShellActionBar"))
      return {
        ShellActionBar: ({ children }) =>
          React.createElement("aside", {}, children),
      };
    if (name === "../../lib/cart") return cartLib;
    if (name === "../../lib/product") return productLib;
    if (name === "../../lib/product-navigation") return navigation;
    if (name === "../ui/foundation") return modules.get("foundation");
    if (name === "./CartItemCard") return modules.get("item");
    if (name === "./CartClearDialog") return { CartClearDialog: () => null };
    throw Error(`Unexpected import ${name}`);
  }
  modules.set("foundation", load("components/ui/foundation.tsx", { require }));
  modules.set("item", load("components/cart/CartItemCard.tsx", { require }));
  exports = load("components/cart/CartView.tsx", { require });
  const resource = { load() {}, update() {}, remove() {}, clear() {} };
  return renderToStaticMarkup(
    React.createElement(exports.CartView, { state, resource }),
  );
}

test("Cart renders localized public data, missing measurements, price estimate, skeleton/empty/auth/error states", () => {
  for (const locale of ["ru", "uz"]) {
    const state = {
      status: "success",
      refreshing: false,
      cart: {
        ...cart,
        sourceUrl: "https://private.invalid",
        items: [{ ...item, sourceUrl: "https://private.invalid" }],
      },
    };
    const html = renderCart(locale, state);
    assert.ok(
      html.includes(
        locale === "ru" ? item.product.nameRu : item.product.nameUz,
      ),
    );
    assert.ok(
      html.includes(`850 000 ${i18n.translate(locale, "cart.currency")}`),
    );
    assert.ok(
      html.includes(`425 000 ${i18n.translate(locale, "cart.currency")}`),
    );
    assert.ok(
      html.includes(i18n.translate(locale, "cart.measurementsMissing")),
    );
    assert.ok(!html.includes("https://private.invalid"));
    assert.ok(!html.includes(item.variant.sku));
    assert.ok(html.includes(i18n.translate(locale, "cart.checkout")));
    const emptyHtml = renderCart(locale, { ...state, cart: empty });
    assert.ok(emptyHtml.includes(i18n.translate(locale, "cart.empty")));
    assert.ok(emptyHtml.includes('href="/catalog"'));
    assert.ok(!emptyHtml.includes(i18n.translate(locale, "cart.checkout")));
    assert.ok(
      renderCart(locale, { status: "loading", refreshing: true }).includes(
        "cart-skeleton",
      ),
    );
    assert.ok(
      renderCart(locale, {
        status: "error",
        refreshing: false,
        failure: { kind: "auth" },
      }).includes(i18n.translate(locale, "cart.authTitle")),
    );
    assert.ok(
      renderCart(locale, {
        status: "error",
        refreshing: false,
        failure: { kind: "request" },
      }).includes(i18n.translate(locale, "cart.error")),
    );
  }
});
