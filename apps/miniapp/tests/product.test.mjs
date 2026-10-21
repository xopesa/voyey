import * as shared from "@stenzo/shared";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import { URL, URLSearchParams } from "node:url";
import ts from "typescript";
import * as React from "react";
import * as jsxRuntime from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";
const { Headers, AbortController } = globalThis;

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
  runInNewContext(code, { exports, URLSearchParams, Headers, ...globals });
  return exports;
}
const catalog = load("lib/catalog.ts");
const productLib = load("lib/product.ts", { require: () => catalog });
const cartLib = load("lib/cart.ts");
const nav = load("lib/product-navigation.ts", { require: () => catalog });
const i18n = load("lib/i18n.ts");
const product = {
  id: "fixture-only",
  slug: "fixture-only",
  nameRu: "Тестовая вещь",
  nameUz: "Test kiyim",
  descriptionRu: "Тестовое описание",
  descriptionUz: "Test tavsif",
  price: 125000,
  currency: "UZS",
  category: {
    id: "fixture-category",
    nameRu: "Тест",
    nameUz: "Test",
    slug: "test",
    sortOrder: 0,
  },
  images: [],
  variants: [
    {
      id: "m-black",
      sku: "TEST-M",
      size: "M",
      color: "Black",
      stock: 2,
      isAvailable: true,
    },
    {
      id: "l-black",
      sku: "TEST-L",
      size: "L",
      color: "Black",
      stock: 0,
      isAvailable: false,
    },
    {
      id: "l-white",
      sku: "TEST-W",
      size: "L",
      color: "White",
      stock: null,
      isAvailable: true,
    },
  ],
  sourceUrl: "https://private.invalid/do-not-expose",
};
const input = {
  productId: product.id,
  variantId: "m-black",
  quantity: 2,
  heightCm: 180,
  weightKg: 75,
};
const confirmation = (overrides = {}) => ({
  cart: {
    id: "fixture-cart",
    currency: "UZS",
    subtotal: (overrides.quantity ?? 2) * product.price,
    updatedAt: "2026-10-17T00:00:00Z",
    items: [
      {
        id: "fixture-cart-item",
        product: {
          id: product.id,
          nameRu: product.nameRu,
          nameUz: product.nameUz,
          slug: product.slug,
          imageUrl: null,
        },
        variant: {
          id: "m-black",
          sku: "TEST-M",
          size: "M",
          color: "Black",
          stock: null,
        },
        unitPrice: product.price,
        lineTotal: (overrides.quantity ?? 2) * product.price,
        currency: "UZS",
        isAvailable: true,
        quantity: 2,
        heightCm: 180,
        weightKg: 75,
        ...overrides,
      },
    ],
  },
});
function client(fetch) {
  return load("lib/api-client.ts", {
    fetch,
    require: (name) =>
      name === "./catalog" ? catalog : name === "./cart" ? cartLib : productLib,
  });
}

test("variant selection needs an actual available size/color combination and respects stock/99", () => {
  assert.equal(
    productLib.selectedVariant(product, undefined, "Black"),
    undefined,
  );
  assert.equal(productLib.selectedVariant(product, "M", undefined), undefined);
  assert.equal(productLib.selectedVariant(product, "L", "Black"), undefined);
  assert.equal(productLib.selectedVariant(product, "M", "White"), undefined);
  assert.equal(
    productLib.quantityLimit(productLib.selectedVariant(product, "M", "Black")),
    2,
  );
  assert.equal(
    productLib.quantityLimit(productLib.selectedVariant(product, "L", "White")),
    99,
  );
  assert.equal(
    productLib.quantityLimit({ ...product.variants[0], stock: 150 }),
    99,
  );
  assert.equal(productLib.quantityLimit(product.variants[1]), 0);
  assert.equal(productLib.quantityLimit(), 0);
  assert.equal(
    productLib.selectedVariant(
      { ...product, variants: [{ ...product.variants[0], color: null }] },
      "M",
      null,
    ).id,
    "m-black",
  );
});

test("measurements may be deferred at detail but entered values follow the existing cart contract", () => {
  assert.equal(productLib.measurement("", 100, 250), null);
  for (const value of ["99", "251", "180.5", "1e2", "-180", "hello"])
    assert.equal(productLib.measurement(value, 100, 250), undefined);
  for (const value of ["100", "180", "250"])
    assert.equal(productLib.measurement(value, 100, 250), Number(value));
  assert.equal(productLib.measurement("30", 30, 300), 30);
  assert.equal(productLib.measurement("301", 30, 300), undefined);
  assert.equal(productLib.validCartInput(input), true);
  assert.equal(
    productLib.validCartInput({ ...input, heightCm: null, weightKg: null }),
    true,
  );
  for (const overrides of [
    { quantity: 0 },
    { quantity: 100 },
    { quantity: 1.5 },
    { variantId: "" },
    { heightCm: 99 },
    { weightKg: 301 },
  ])
    assert.equal(productLib.validCartInput({ ...input, ...overrides }), false);
});

test("gallery primary ordering, missing/unsafe images and horizontal swipe preserve vertical scrolling", () => {
  const images = [
    { id: "a", url: "/a.jpg", sortOrder: 0, isPrimary: false },
    {
      id: "b",
      url: "https://test.invalid/b.jpg",
      sortOrder: 3,
      isPrimary: true,
    },
    { id: "c", url: "javascript:bad", sortOrder: 1, isPrimary: false },
    { id: "d", url: "//unsafe.invalid/a", sortOrder: 2, isPrimary: false },
  ];
  assert.equal(productLib.galleryImages(product).length, 0);
  assert.equal(
    productLib
      .galleryImages({ ...product, images })
      .map((image) => image.id)
      .join(","),
    "b,a",
  );
  assert.equal(productLib.swipeDirection(-70, 10), 1);
  assert.equal(productLib.swipeDirection(70, -10), -1);
  assert.equal(productLib.swipeDirection(20, 0), 0);
  assert.equal(productLib.swipeDirection(60, 90), 0);
});

test("detail GET uses the real slug endpoint, validates the DTO and preserves 404", async () => {
  let call;
  const signal = new AbortController().signal;
  const api = client(async (url, options) => {
    call = { url, options };
    return { ok: true, json: async () => ({ product }) };
  });
  assert.equal(
    (await api.getCatalogProduct("item & тест", signal)).id,
    product.id,
  );
  assert.equal(
    call.url,
    "/api/catalog/products/item%20%26%20%D1%82%D0%B5%D1%81%D1%82",
  );
  assert.equal(call.options.signal, signal);
  assert.equal(call.options.headers.has("Authorization"), false);
  for (const status of [404, 500]) {
    const failing = client(async () => ({ ok: false, status }));
    await assert.rejects(
      () => failing.getCatalogProduct("gone"),
      (error) =>
        error instanceof failing.ApiRequestError && error.status === status,
    );
  }
  await assert.rejects(() =>
    client(async () => ({
      ok: true,
      json: async () => ({ product: { ...product, descriptionRu: 1 } }),
    })).getCatalogProduct("bad"),
  );
});

test("cart POST reuses JWT/proxy and only succeeds after the server confirms the selected line and measurements", async () => {
  let call;
  const signal = new AbortController().signal;
  const confirmed = await client(async (url, options) => {
    call = { url, options };
    return { ok: true, json: async () => confirmation({ quantity: 4 }) };
  }).addCartItem(input, "test-only-token", signal);
  assert.equal(confirmed.items[0].quantity, 4);
  assert.equal(cartLib.isCart(confirmed), true);
  assert.equal(call.url, "/api/cart/items");
  assert.equal(call.options.method, "POST");
  assert.equal(
    call.options.headers.get("Authorization"),
    "Bearer test-only-token",
  );
  assert.equal(call.options.headers.get("Content-Type"), "application/json");
  assert.deepEqual(JSON.parse(call.options.body), input);
  assert.equal(call.options.signal, signal);
  for (const response of [
    null,
    { cart: { items: [] } },
    confirmation({ quantity: 1 }),
    confirmation({ heightCm: null }),
    confirmation({ variant: { id: "different" } }),
  ]) {
    await assert.rejects(() =>
      client(async () => ({
        ok: true,
        json: async () => response,
      })).addCartItem(input, "test-only-token"),
    );
  }
  for (const status of [401, 403, 409, 500]) {
    const failing = client(async () => ({ ok: false, status }));
    await assert.rejects(
      () => failing.addCartItem(input, "test-only-token"),
      (error) => error.status === status,
    );
  }
  await assert.rejects(() =>
    client(() => {
      throw Error("Must not request");
    }).addCartItem({ ...input, quantity: 0 }, "test-only-token"),
  );
});

test("product routes encode slugs and retain only safe Home/Catalog return filters", () => {
  const href = nav.productHref(
    "item/а",
    "/catalog?category=test&search=A%26B&cursor=internal",
  );
  const url = new URL(href, "https://test.invalid");
  assert.equal(url.pathname, "/catalog/item%2F%D0%B0");
  const back = new URL(url.searchParams.get("from"), "https://test.invalid");
  assert.equal(back.searchParams.get("category"), "test");
  assert.equal(back.searchParams.get("search"), "A&B");
  assert.equal(back.searchParams.has("cursor"), false);
  assert.equal(nav.productReturnHref("/"), "/");
  for (const unsafe of [
    "//evil.invalid",
    "https://evil.invalid",
    "/cart",
    "/catalogue",
    "/catalog/item",
  ])
    assert.equal(nav.productReturnHref(unsafe), "/catalog");
});

test("Telegram BackButton installs one handler, returns through history or safe filters and cleans up", () => {
  const effects = [];
  const calls = [];
  let saved = null;
  const button = {
    show: () => calls.push("show"),
    hide: () => calls.push("hide"),
    onClick: (fn) => calls.push(fn),
    offClick: (fn) => calls.push(fn),
  };
  const globals = {
    window: {
      Telegram: {
        WebApp: { BackButton: button, isVersionAtLeast: () => true },
      },
      location: {
        search: "?from=%2Fcatalog%3Fcategory%3Dhoodies%26search%3Dtest",
      },
    },
    history: { length: 3 },
    require(name) {
      if (name === "@stenzo/shared") return shared;
      if (name === "react")
        return {
          ...React,
          useEffect: (fn) => effects.push(fn),
          useCallback: (fn) => fn,
        };
      if (name === "react/jsx-runtime") return jsxRuntime;
      if (name === "next/navigation")
        return {
          usePathname: () => "/catalog/fixture-only",
          useRouter: () => ({
            back: () => calls.push("back"),
            push: (href) => calls.push(href),
          }),
        };
      if (name === "../../lib/product-navigation")
        return { ...nav, readProductReturn: () => saved };
      if (name === "../PreferencesProvider")
        return {
          usePreferences: () => ({ t: (key) => i18n.translate("ru", key) }),
        };
      if (name === "../ui/foundation") return { IconButton: () => null };
      if (name === "../ui/Icon") return { Icon: () => null };
      throw Error(name);
    },
  };
  const { ProductBackButton } = load(
    "components/product/ProductBackButton.tsx",
    globals,
  );
  renderToStaticMarkup(React.createElement(ProductBackButton));
  const cleanup = effects[0]();
  assert.equal(calls[0], "show");
  const handler = calls[1];
  handler();
  assert.equal(calls[2], "/catalog?category=hoodies&search=test");
  saved = { slug: "fixture-only", historyLength: 2 };
  handler();
  assert.equal(calls[3], "back");
  cleanup();
  assert.equal(calls[4], handler);
  assert.equal(calls[5], "hide");
  effects.length = 0;
  globals.window.Telegram.WebApp.isVersionAtLeast = () => false;
  renderToStaticMarkup(React.createElement(ProductBackButton));
  assert.equal(effects[0](), undefined);
  assert.equal(calls.length, 6);
});

test("detail renders only real localized fields, unavailable variants, delivery and deferred required measurements", () => {
  for (const locale of ["ru", "uz"]) {
    const components = load("components/ui/foundation.tsx", {
      require: (name) => (name === "react" ? React : jsxRuntime),
    });
    const { ProductView } = load("components/product/ProductView.tsx", {
      require(name) {
        if (name === "@stenzo/shared") return shared;
        if (name === "react") return React;
        if (name === "react/jsx-runtime") return jsxRuntime;
        if (name === "next/navigation")
          return { useRouter: () => ({ push() {} }) };
        if (name === "next/link")
          return {
            default: ({ href, children }) =>
              React.createElement("a", { href }, children),
          };
        if (name === "../../lib/catalog") return catalog;
        if (name === "../../lib/product") return productLib;
        if (name === "../../lib/api-client") return {};
        if (name === "../../lib/auth-storage") return {};
        if (name === "../cart/useCart")
          return {
            useCart: () => ({ state: { refreshing: false }, resource: {} }),
          };
        if (name === "../ui/foundation") return components;
        if (name === "../ui/Icon")
          return { Icon: () => React.createElement("svg") };
        if (name === "./ProductActions")
          return {
            ProductActions: ({ children }) =>
              React.createElement(
                "div",
                { className: "actions-fixture" },
                children,
              ),
          };
        if (name === "./ProductGallery")
          return { ProductGallery: () => React.createElement("div") };
        if (name === "../PreferencesProvider")
          return {
            usePreferences: () => ({
              locale,
              localizedText: (values) => i18n.localizedText(locale, values),
              t: (key, values) => i18n.translate(locale, key, values),
            }),
          };
        throw new Error(`Unexpected import ${name}`);
      },
    });
    const html = renderToStaticMarkup(
      React.createElement(ProductView, { product, reload() {} }),
    );
    assert.ok(html.includes(locale === "ru" ? product.nameRu : product.nameUz));
    assert.ok(
      html.includes(
        locale === "ru" ? product.descriptionRu : product.descriptionUz,
      ),
    );
    assert.ok(html.includes(i18n.translate(locale, "product.deliveryTime")));
    assert.ok(html.includes(i18n.translate(locale, "product.cargo")));
    assert.ok(
      html.includes(i18n.translate(locale, "product.measurementsHint")),
    );
    assert.ok(!html.includes(product.sourceUrl));
    assert.ok(!html.includes("TEST-M"));
    assert.match(
      html,
      /disabled=""[^>]*>.*?Купить|disabled=""[^>]*>.*?Sotib olish/s,
    );
    const soldOut = renderToStaticMarkup(
      React.createElement(ProductView, {
        product: { ...product, variants: [] },
        reload() {},
      }),
    );
    assert.ok(soldOut.includes(i18n.translate(locale, "catalog.unavailable")));
  }
});
