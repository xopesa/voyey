import * as shared from "@stenzo/shared";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { URL, URLSearchParams } from "node:url";
import { setTimeout, clearTimeout, setImmediate } from "node:timers";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import * as React from "react";
import * as jsx from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";
const { Headers, AbortController } = globalThis;

// Component/transport harness only: never opens a live app or writes business data.
function load(file, globals = {}) {
  const exports = {};
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
  runInNewContext(code, {
    exports,
    Headers,
    URL,
    URLSearchParams,
    AbortController,
    setTimeout,
    clearTimeout,
    ...globals,
  });
  return exports;
}
const cartLib = load("lib/cart.ts"),
  routes = load("lib/routes.ts"),
  catalog = load("lib/catalog.ts");
const productLib = load("lib/product.ts", { require: () => catalog });
const { CartResource } = load("lib/cart-resource.ts");
const tick = () => new Promise((resolve) => setImmediate(resolve));
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function cart(quantities = []) {
  return {
    id: "cart",
    currency: "UZS",
    updatedAt: "2026-10-17T00:00:00Z",
    subtotal: quantities.reduce((sum, q) => sum + q * 100000, 0),
    items: quantities.map((quantity, index) => ({
      id: "line-" + index,
      quantity,
      heightCm: 180,
      weightKg: 75,
      unitPrice: 100000,
      lineTotal: quantity * 100000,
      currency: "UZS",
      isAvailable: true,
      product: {
        id: "product-" + index,
        nameRu: "Test",
        nameUz: "Sinov",
        slug: "product-" + index,
        imageUrl: null,
      },
      variant: {
        id: "variant-" + index,
        sku: "TEST-" + index,
        size: "M",
        color: "Black",
        stock: null,
      },
    })),
  };
}
const input = {
  productId: "product-0",
  variantId: "variant-0",
  quantity: 1,
  heightCm: 180,
  weightKg: 75,
};
function api(fetch) {
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
const Link = ({ href, children, ...props }) =>
  React.createElement("a", { href, ...props }, children);
const prefs = {
  usePreferences: () => ({
    ready: true,
    t: (key, values) => (values?.count ? `${key}:${values.count}` : key),
  }),
};
function shell(useCart, getPath = () => "/catalog") {
  const navigation = { usePathname: getPath };
  const bottom = load("components/BottomNavigation.tsx", {
    require: (name) => {
      if (name === "react/jsx-runtime") return jsx;
      if (name === "next/link") return { default: Link };
      if (name === "next/navigation") return navigation;
      if (name.endsWith("PreferencesProvider")) return prefs;
      if (name.endsWith("Icon")) return { Icon: () => null };
      throw Error(name);
    },
  });
  const app = load("components/AppShell.tsx", {
    require: (name) => {
      if (name === "react") return React;
      if (name === "react/jsx-runtime") return jsx;
      if (name === "next/link") return { default: Link };
      if (name === "next/navigation") return navigation;
      if (name.endsWith("PreferencesProvider")) return prefs;
      if (name.endsWith("BottomNavigation")) return bottom;
      if (name.endsWith("foundation"))
        return {
          Page: ({ children, ...props }) =>
            React.createElement("div", props, children),
        };
      if (name.endsWith("Brand"))
        return { Brand: () => React.createElement("strong", {}, "STENZO") };
      return new Proxy({}, { get: () => () => null });
    },
  });
  return load("components/cart/CartShell.tsx", {
    require: (name) =>
      name === "react/jsx-runtime"
        ? jsx
        : name.endsWith("AppShell")
          ? app
          : name.endsWith("useCart")
            ? { useCart }
            : cartLib,
  }).CartShell;
}
function badge(resource) {
  const Shell = shell(() => ({ resource, state: resource.snapshot() }));
  return renderToStaticMarkup(
    React.createElement(
      Shell,
      {},
      React.createElement("p", {}, "Fixture content"),
    ),
  );
}
function badgeValue(html) {
  return (
    /class="bottom-navigation__badge"[^>]*>([^<]+)</.exec(html)?.[1] ?? "0"
  );
}

function renderRoute(path) {
  const Shell = shell(
    () => ({ state: { status: "error", refreshing: false } }),
    () => path,
  );
  const leaf = (kind) => (props) =>
    React.createElement(
      "p",
      { "data-route": kind },
      props.slug ?? props.publicId ?? kind,
    );
  const { Routes } = load("spa.tsx", {
    document: { getElementById: () => ({}) },
    require(name) {
      if (name === "react/jsx-runtime") return jsx;
      if (name === "react-dom/client")
        return { createRoot: () => ({ render() {} }) };
      if (name === "./spa/navigation") return { usePathname: () => path };
      if (name === "./lib/routes") return routes;
      if (name.endsWith("CartShell")) return { CartShell: Shell };
      if (name.endsWith("CartProvider"))
        return { CartProvider: ({ children }) => children };
      if (name.endsWith("PreferencesProvider"))
        return { PreferencesProvider: ({ children }) => children };
      if (name.endsWith("TelegramSession"))
        return { TelegramSessionProvider: ({ children }) => children };
      if (name === "./lib/preferences")
        return {
          applyPreferences() {},
          readPreferences() {},
          preferenceKeys: {},
        };
      if (name.endsWith("ProductDetail"))
        return { ProductDetail: leaf("product") };
      if (name.endsWith("OrderDetailContent"))
        return { OrderDetailContent: leaf("order") };
      if (name.endsWith("PaymentPageContent"))
        return { PaymentPageContent: leaf("payment") };
      return name.endsWith(".css") ? {} : { default: leaf("page") };
    },
  });
  return renderToStaticMarkup(React.createElement(Routes));
}
for (const path of [
  "/catalog/%",
  "/orders/%",
  "/orders/%/payment",
  "/catalog/%E0%A4%A",
  "/orders/%C0%AF",
  "/orders/%ED%A0%80/payment",
  "/catalog/" + "a".repeat(101),
  "/orders/" + "x".repeat(100000) + "/payment",
])
  test(`malformed/oversized route ${path.slice(0, 40)} renders safe 404 inside live shell`, () => {
    const html = renderRoute(path);
    assert.ok(html.includes('role="alert">404'));
    assert.ok(html.includes('class="app-shell"'));
    assert.ok(html.includes("STENZO"));
    assert.ok(!html.includes('data-route="product"'));
    assert.ok(!html.includes('data-route="order"'));
    assert.ok(!html.includes('data-route="payment"'));
  });
test("valid URI decoding preserves exact slug and order/payment IDs, without double decoding", () => {
  for (const [path, kind, value] of [
    ["/catalog/sport%2Dshim", "product", "sport-shim"],
    ["/catalog/%D1%82%D0%B5%D1%81%D1%82", "product", "тест"],
    ["/orders/%53TZ%2D123", "order", "STZ-123"],
    ["/orders/%53TZ%2D123/payment", "payment", "STZ-123"],
  ]) {
    const html = renderRoute(path);
    assert.ok(html.includes(`data-route="${kind}">${value}`));
    assert.ok(!html.includes('role="alert">404'));
  }
  assert.equal(routes.safeDecodeURIComponent("%2525"), "%25");
  assert.equal(routes.safeDecodeURIComponent("%"), null);
  assert.equal(routes.safeDecodeURIComponent("%20"), null);
  assert.equal(routes.safeDecodeURIComponent("a".repeat(100)), "a".repeat(100));
});
for (const [quantities, expected] of [
  [[], "0"],
  [[1], "1"],
  [[2, 3], "5"],
  [[99, 2], "99+"],
])
  test(`shell badge sums confirmed quantities ${quantities} -> ${expected}`, async () => {
    const resource = new CartResource(
      { get: async () => cart(quantities) },
      () => "fixture-token",
    );
    await resource.load();
    assert.equal(badgeValue(badge(resource)), expected);
  });

test("add and merged variants replace the backend snapshot; badge never increments optimistically", async () => {
  let pending = deferred(),
    confirmed = cart([2]);
  const resource = new CartResource(
    { get: async () => confirmed, add: () => pending.promise },
    () => "fixture-token",
  );
  await resource.load();
  const first = resource.add(input);
  assert.equal(badgeValue(badge(resource)), "2");
  assert.equal(await resource.clear(), false);
  assert.equal(await resource.load(), false);
  assert.equal(await resource.add(input), false);
  pending.resolve(cart([4, 3]));
  assert.equal(await first, true);
  assert.equal(badgeValue(badge(resource)), "7");
  confirmed = cart([4, 3]);
  pending = deferred();
  const second = resource.add(input);
  pending.reject(Error("Network failure"));
  assert.equal(await second, false);
  assert.equal(badgeValue(badge(resource)), "7");
});
test("PATCH, DELETE and CLEAR update the same badge only after backend confirmation", async () => {
  let pending = deferred();
  const resource = new CartResource(
    {
      get: async () => cart([3, 4]),
      update: () => pending.promise,
      remove: () => pending.promise,
      clear: () => pending.promise,
    },
    () => "fixture-token",
  );
  await resource.load();
  const patch = resource.update("line-0", { quantity: 1 });
  assert.equal(badgeValue(badge(resource)), "7");
  pending.resolve(cart([1, 4]));
  await patch;
  assert.equal(badgeValue(badge(resource)), "5");
  pending = deferred();
  const remove = resource.remove("line-1");
  assert.equal(badgeValue(badge(resource)), "5");
  pending.resolve(cart([1]));
  await remove;
  assert.equal(badgeValue(badge(resource)), "1");
  pending = deferred();
  const clear = resource.clear();
  assert.equal(badgeValue(badge(resource)), "1");
  pending.resolve(cart());
  await clear;
  assert.equal(badgeValue(badge(resource)), "0");
});
for (const method of ["add", "update", "remove", "clear"])
  test(`failed ${method} leaves the confirmed cart and badge unchanged`, async () => {
    const resource = new CartResource(
      {
        get: async () => cart([2, 3]),
        [method]: async () => {
          throw { status: 409 };
        },
      },
      () => "fixture-token",
    );
    await resource.load();
    const previous = resource.snapshot().cart;
    await (method === "add"
      ? resource.add(input)
      : method === "update"
        ? resource.update("line-0", { quantity: 1 })
        : method === "remove"
          ? resource.remove("line-1")
          : resource.clear());
    assert.equal(resource.snapshot().cart, previous);
    assert.equal(badgeValue(badge(resource)), "5");
  });
test("initial GET, refresh and reopened resource restore actual backend count", async () => {
  let current = cart([2, 3]);
  const transport = { get: async () => current };
  const resource = new CartResource(transport, () => "fixture-token");
  assert.equal(badgeValue(badge(resource)), "0");
  await resource.load();
  assert.equal(badgeValue(badge(resource)), "5");
  current = cart([1]);
  await resource.load();
  assert.equal(badgeValue(badge(resource)), "1");
  const reopened = new CartResource(transport, () => "fixture-token");
  await reopened.load();
  assert.equal(badgeValue(badge(reopened)), "1");
});
test("unauthenticated/expired sessions clear badge and ignore in-flight stale responses", async () => {
  let token = "fixture-token",
    pending = deferred();
  const resource = new CartResource(
    { get: async () => cart([5]), add: () => pending.promise },
    () => token,
  );
  await resource.load();
  const add = resource.add(input);
  token = null;
  resource.sessionFailure();
  pending.resolve(cart([8]));
  assert.equal(await add, false);
  assert.equal(badgeValue(badge(resource)), "0");
  await resource.load();
  assert.equal(badgeValue(badge(resource)), "0");
  const expired = new CartResource(
    {
      get: async () => {
        throw { status: 401 };
      },
    },
    () => "expired-token",
  );
  await expired.load();
  assert.equal(badgeValue(badge(expired)), "0");
});

function providerHarness() {
  let status = "loading",
    memo,
    memoKey,
    effectKey,
    pendingEffect,
    cleanup;
  let current = cart([2, 3]),
    gets = 0;
  const listeners = new Map(),
    captures = [];
  const events = {
    addEventListener: (type, listener) => listeners.set(type, listener),
    removeEventListener: (type) => listeners.delete(type),
  };
  const provider = load("components/cart/CartProvider.tsx", {
    document: { ...events, visibilityState: "visible" },
    window: events,
    require(name) {
      if (name === "react/jsx-runtime") return jsx;
      if (name === "react")
        return {
          ...React,
          useMemo: (fn, [key]) => {
            if (memoKey !== key) {
              memo = fn();
              memoKey = key;
            }
            return memo;
          },
          useEffect: (fn, [resource]) => {
            if (effectKey !== resource) {
              effectKey = resource;
              pendingEffect = () => {
                cleanup?.();
                cleanup = fn();
              };
            }
          },
          useSyncExternalStore: (_subscribe, snapshot) => snapshot(),
        };
      if (name.endsWith("api-client"))
        return {
          getCart: async () => {
            gets++;
            return current;
          },
        };
      if (name.endsWith("auth-storage"))
        return { readAccessToken: () => "fixture-token" };
      if (name.endsWith("cart-resource")) return { CartResource };
      if (name.endsWith("TelegramSession"))
        return { useTelegramSession: () => ({ status }) };
      throw Error(name);
    },
  });
  const Shell = shell(provider.useCart);
  function Consumer() {
    captures.push(provider.useCart().resource);
    return null;
  }
  return {
    setStatus: (value) => {
      status = value;
    },
    setCart: (value) => {
      current = value;
    },
    gets: () => gets,
    listeners,
    captures,
    render() {
      captures.length = 0;
      return renderToStaticMarkup(
        React.createElement(
          provider.CartProvider,
          {},
          React.createElement(
            Shell,
            {},
            React.createElement(Consumer),
            React.createElement(Consumer),
          ),
        ),
      );
    },
    effect() {
      pendingEffect?.();
      pendingEffect = undefined;
    },
    dispose() {
      cleanup?.();
    },
  };
}
test("one provider shares its resource across consumers, loads after auth and refreshes on reopen", async () => {
  const h = providerHarness();
  try {
    assert.equal(badgeValue(h.render()), "0");
    h.effect();
    assert.equal(h.gets(), 0);
    h.setStatus("authenticated");
    h.render();
    h.effect();
    await tick();
    assert.equal(badgeValue(h.render()), "5");
    assert.equal(h.captures[0], h.captures[1]);
    const resource = h.captures[0];
    h.render();
    h.effect();
    assert.equal(h.gets(), 1);
    assert.equal(h.captures[0], resource);
    h.setCart(cart([1]));
    h.listeners.get("visibilitychange")();
    await tick();
    assert.equal(badgeValue(h.render()), "1");
    h.setCart(cart([4]));
    h.listeners.get("pageshow")({ persisted: true });
    await tick();
    assert.equal(badgeValue(h.render()), "4");
    h.setStatus("outside-telegram");
    assert.equal(badgeValue(h.render()), "0");
    h.effect();
    assert.equal(h.listeners.size, 0);
  } finally {
    h.dispose();
  }
});
test("addCartItem validates complete Cart as well as selected line before sharing it", async () => {
  const response = cart([4]);
  const client = api(async () => ({
    ok: true,
    json: async () => ({ cart: response }),
  }));
  assert.equal(await client.addCartItem(input, "fixture-token"), response);
  for (const malformed of [
    { items: response.items },
    { ...response, subtotal: NaN },
    { ...response, items: [response.items[0], response.items[0]] },
    { ...response, items: [{ ...response.items[0], heightCm: null }] },
  ])
    await assert.rejects(
      api(async () => ({
        ok: true,
        json: async () => ({ cart: malformed }),
      })).addCartItem(input, "fixture-token"),
    );
});

for (const buy of [false, true])
  for (const success of [true, false])
    test(`${buy ? "Sotib olish" : "Savatga"} ${success ? "confirmed" : "failed"}: real ProductView uses the shared cart and routes only on success`, async () => {
      const pending = deferred(),
        navigation = [],
        actions = [];
      const client = api(async () => {
        await pending.promise;
        return { ok: true, json: async () => ({ cart: cart([4]) }) };
      });
      const resource = new CartResource(
        { get: async () => cart([2]), add: client.addCartItem },
        () => "fixture-token",
      );
      await resource.load();
      const values = ["M", "Black", 1, "180", "75", false, undefined],
        refs = [];
      let stateIndex = 0,
        refIndex = 0;
      const product = {
        id: "product-0",
        slug: "product-0",
        nameRu: "Test",
        nameUz: "Sinov",
        descriptionRu: null,
        descriptionUz: null,
        price: 100000,
        salePrice: null,
        saleStartsAt: null,
        saleEndsAt: null,
        currency: "UZS",
        images: [],
        category: { nameRu: "Test", nameUz: "Sinov" },
        variants: [
          {
            id: "variant-0",
            sku: "TEST",
            size: "M",
            color: "Black",
            stock: null,
            isAvailable: true,
          },
        ],
      };
      const { ProductView } = load("components/product/ProductView.tsx", {
        require(name) {
          if (name === "react")
            return {
              ...React,
              useState: () => {
                const index = stateIndex++;
                return [
                  values[index],
                  (next) => {
                    values[index] = next;
                  },
                ];
              },
              useRef: (initial) =>
                refs[refIndex++] ?? (refs[refIndex - 1] = { current: initial }),
              useEffect() {},
            };
          if (name === "@stenzo/shared") return shared;
          if (name === "react/jsx-runtime") return jsx;
          if (name === "next/link") return { default: Link };
          if (name === "next/navigation")
            return {
              useRouter: () => ({ push: (path) => navigation.push(path) }),
            };
          if (name.endsWith("/cart/useCart"))
            return {
              useCart: () => ({ resource, state: resource.snapshot() }),
            };
          if (name.endsWith("/catalog")) return catalog;
          if (name.endsWith("/product")) return productLib;
          if (name.endsWith("PreferencesProvider"))
            return {
              usePreferences: () => ({
                locale: "uz",
                t: (key) => key,
                localizedText: (value) => value.uz ?? value.ru,
              }),
            };
          if (name.endsWith("foundation"))
            return {
              Button: (props) => {
                actions.push(props);
                return React.createElement(
                  "button",
                  { onClick: props.onClick },
                  props.children,
                );
              },
              IconButton: () => null,
              Divider: () => null,
              Card: ({ children }) => React.createElement("div", {}, children),
            };
          if (name.endsWith("ProductActions"))
            return {
              ProductActions: ({ children }) =>
                React.createElement("div", {}, children),
            };
          return new Proxy({}, { get: () => () => null });
        },
      });
      renderToStaticMarkup(
        React.createElement(ProductView, { product, reload() {} }),
      );
      actions[buy ? 1 : 0].onClick();
      await tick();
      assert.equal(badgeValue(badge(resource)), "2");
      if (success) pending.resolve();
      else pending.reject(Error("Network failure"));
      await tick();
      assert.equal(badgeValue(badge(resource)), success ? "4" : "2");
      assert.equal(
        values[6],
        success ? "product.saved" : "product.submitError",
      );
      assert.deepEqual(navigation, success && buy ? ["/cart"] : []);
    });
