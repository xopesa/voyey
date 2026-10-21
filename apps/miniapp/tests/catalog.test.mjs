import * as shared from "@stenzo/shared";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { URL, URLSearchParams } from "node:url";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import * as React from "react";
import * as jsxRuntime from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";

const { AbortController, Headers } = globalThis;

function load(file, globals = {}) {
  const source = readFileSync(
    new URL(`../src/lib/${file}`, import.meta.url),
    "utf8",
  );
  const code = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
    },
  }).outputText;
  const exports = {};
  runInNewContext(code, { exports, URLSearchParams, ...globals });
  return exports;
}

const catalog = load("catalog.ts");
const i18n = load("i18n.ts");
const navigation = load("product-navigation.ts", { require: () => catalog });
const category = {
  id: "test-category",
  slug: "test-clothing",
  nameRu: "Тестовая категория",
  nameUz: "Test toifa",
  sortOrder: 0,
};
const product = {
  id: "test-product",
  slug: "test-item",
  nameRu: "Тестовый товар",
  nameUz: "Test mahsulot",
  category,
  price: 125000,
  currency: "UZS",
  images: [],
  variants: [
    {
      id: "test-variant",
      sku: "TEST-ONLY",
      size: "M",
      color: null,
      stock: null,
      isAvailable: true,
    },
  ],
};

test("catalog links use the API's category slug and search contract", () => {
  assert.equal(catalog.catalogHref(), "/catalog");
  assert.equal(
    catalog.catalogHref({ category: "test-clothing" }),
    "/catalog?category=test-clothing",
  );
  const url = new URL(
    catalog.catalogHref({ search: "  Тест & test  " }),
    "https://test.invalid",
  );
  assert.equal(url.searchParams.get("search"), "Тест & test");
  assert.equal(
    new URL(
      catalog.catalogHref({ search: "x".repeat(300) }),
      "https://test.invalid",
    ).searchParams.get("search").length,
    200,
  );
});

test("media selection prefers the primary image and rejects unsupported URL schemes", () => {
  const images = [
    { id: "one", url: "/test/secondary.jpg", sortOrder: 0, isPrimary: false },
    {
      id: "two",
      url: "https://test.invalid/primary.jpg",
      sortOrder: 1,
      isPrimary: true,
    },
  ];
  assert.equal(
    catalog.productImageSource({ ...product, images }),
    "https://test.invalid/primary.jpg",
  );
  assert.equal(catalog.productImageSource(product), undefined);
  assert.equal(
    catalog.productImageSource({
      ...product,
      images: [{ ...images[0], url: "javascript:alert(1)" }],
    }),
    undefined,
  );
});

test("prices use actual UZS values and consumed DTO fields are validated", () => {
  assert.match(catalog.formatProductPrice(125000, "ru"), /125\D000 UZS/);
  assert.match(catalog.formatProductPrice(125000, "uz"), /125\D000 UZS/);
  assert.equal(catalog.isCatalogProduct(product), true);
  assert.equal(catalog.isCatalogProduct({ ...product, price: NaN }), false);
  assert.equal(
    catalog.isCatalogProduct({ ...product, images: [{ url: null }] }),
    false,
  );
  assert.equal(
    catalog.isCatalogProduct({ ...product, currency: "USD" }),
    false,
  );
});

test("availability follows variant stock, including unlimited stock and no variants", () => {
  assert.equal(catalog.productIsAvailable(product), true);
  assert.equal(catalog.productIsAvailable({ ...product, variants: [] }), false);
  const soldOut = {
    ...product,
    variants: [{ ...product.variants[0], stock: 0, isAvailable: false }],
  };
  assert.equal(catalog.isCatalogProduct(soldOut), true);
  assert.equal(catalog.productIsAvailable(soldOut), false);
  assert.equal(
    catalog.isCatalogProduct({
      ...soldOut,
      variants: [{ ...soldOut.variants[0], stock: -1 }],
    }),
    false,
  );
  assert.equal(
    catalog.isCatalogProduct({
      ...product,
      variants: [{ ...product.variants[0], stock: 0 }],
    }),
    false,
  );
});

test("public requests reuse the API client, preserve cancellation and accept empty results", async () => {
  const calls = [];
  const signal = new AbortController().signal;
  const client = load("api-client.ts", {
    Headers,
    require: () => catalog,
    fetch: async (url, options) => {
      calls.push({ url, options });
      return {
        ok: true,
        json: async () =>
          url.includes("categories")
            ? { categories: [] }
            : { products: [], nextCursor: null },
      };
    },
  });
  assert.equal((await client.getCatalogCategories(signal)).length, 0);
  assert.equal(
    (await client.getCatalogProducts({ limit: 6 }, signal)).products.length,
    0,
  );
  assert.equal(calls[0].url, "/api/catalog/categories");
  assert.equal(calls[1].url, "/api/catalog/products?limit=6");
  assert.equal(calls[1].options.signal, signal);
  assert.equal(calls[1].options.headers.has("Authorization"), false);
});

test("unavailable or malformed API data rejects instead of producing fallback products", async () => {
  for (const response of [
    { ok: false, status: 503 },
    {
      ok: true,
      json: async () => ({
        products: [{ ...product, price: "invalid" }],
        nextCursor: null,
      }),
    },
  ]) {
    const client = load("api-client.ts", {
      Headers,
      require: () => catalog,
      fetch: async () => response,
    });
    await assert.rejects(() => client.getCatalogProducts());
  }
});

test("product requests preserve search, category and cursor as query parameters", async () => {
  let requestedUrl;
  const client = load("api-client.ts", {
    Headers,
    require: () => catalog,
    fetch: async (url) => {
      requestedUrl = new URL(url, "https://test.invalid");
      return {
        ok: true,
        json: async () => ({ products: [], nextCursor: null }),
      };
    },
  });
  await client.getCatalogProducts({
    search: "  Кроссовки & ko'ylak?  ",
    category: "men-streetwear",
    cursor: "item+id/=?&",
    limit: 6,
  });
  assert.equal(requestedUrl.pathname, "/api/catalog/products");
  assert.equal(requestedUrl.searchParams.get("search"), "Кроссовки & ko'ylak?");
  assert.equal(requestedUrl.searchParams.get("category"), "men-streetwear");
  assert.equal(requestedUrl.searchParams.get("cursor"), "item+id/=?&");
  assert.equal(requestedUrl.searchParams.get("limit"), "6");
});

test("product cards render bilingual API content, real prices, media fallback and approved links", () => {
  for (const locale of ["ru", "uz"]) {
    const { ProductCard } = load("../components/catalog/ProductCard.tsx", {
      require(name) {
        if (name === "@stenzo/shared") return shared;
        if (name === "react") return React;
        if (name === "react/jsx-runtime") return jsxRuntime;
        if (name === "../../lib/catalog") return catalog;
        if (name === "../../lib/product-navigation") return navigation;
        if (name === "../PreferencesProvider")
          return {
            usePreferences: () => ({
              locale,
              localizedText: (values) => i18n.localizedText(locale, values),
              t: (key) => i18n.translate(locale, key),
            }),
          };
        if (name === "../ui/Icon")
          return { Icon: () => React.createElement("svg") };
        if (name === "next/link")
          return {
            default: ({ href, children, className }) =>
              React.createElement("a", { href, className }, children),
          };
        if (name === "next/image")
          return {
            default: ({ src, alt }) => React.createElement("img", { src, alt }),
          };
        throw new Error(`Unexpected test import: ${name}`);
      },
    });
    const name = locale === "ru" ? product.nameRu : product.nameUz;
    const html = renderToStaticMarkup(
      React.createElement(ProductCard, {
        product,
        from: catalog.catalogHref({ search: name }),
      }),
    );
    assert.ok(html.includes(name));
    assert.ok(html.includes(i18n.translate(locale, "home.productNoImage")));
    assert.match(html, /125\D000 UZS/);
    const href = html.match(/href="([^"]+)"/)[1];
    const url = new URL(href, "https://test.invalid");
    assert.equal(url.pathname, `/catalog/${product.slug}`);
    assert.equal(
      new URL(
        url.searchParams.get("from"),
        "https://test.invalid",
      ).searchParams.get("search"),
      name,
    );
    for (const sale of [
      { salePrice: 100000 },
      { salePrice: 100000, saleStartsAt: "2099-01-01T00:00:00Z" },
      { salePrice: 100000, saleEndsAt: "2020-01-01T00:00:00Z" },
    ]) {
      const onSale = shared.effectiveProductPrice({
        ...product,
        ...sale,
      }).isOnSale;
      const saleHtml = renderToStaticMarkup(
        React.createElement(ProductCard, { product: { ...product, ...sale } }),
      );
      assert.equal(saleHtml.includes("<del"), onSale);
      if (onSale) assert.match(saleHtml, /100\D000 UZS/);
    }
    const staticHtml = renderToStaticMarkup(
      React.createElement(ProductCard, {
        product: {
          ...product,
          variants: [{ ...product.variants[0], stock: 0, isAvailable: false }],
        },
      }),
    );
    assert.ok(staticHtml.includes(`/catalog/${product.slug}`));
    assert.ok(staticHtml.includes('data-unavailable="true"'));
    assert.ok(
      staticHtml.includes(i18n.translate(locale, "catalog.unavailable")),
    );
  }
});
