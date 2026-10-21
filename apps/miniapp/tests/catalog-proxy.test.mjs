import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";
import { URL, URLSearchParams } from "node:url";
import { runInNewContext } from "node:vm";
import ts from "typescript";

const source = readFileSync(
  new URL("../src/lib/api-proxy.ts", import.meta.url),
  "utf8",
);
const exports = {};
runInNewContext(
  ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText,
  { exports, URL },
);
const { apiRewrite } = exports;

test("Vercel proxy requires an explicit HTTPS API URL without embedded credentials", () => {
  for (const env of [
    { VERCEL: "1" },
    { VERCEL: "1", API_URL: "http://localhost:3001" },
    { API_URL: "https://user:password@api.example" },
  ])
    assert.throws(() => apiRewrite(env));
  assert.equal(
    apiRewrite({ VERCEL: "1", API_URL: "https://api.example" }).destination,
    "https://api.example/:path*",
  );
});

test("missing API_URL still registers a proxy to the existing local API port", () => {
  assert.equal(apiRewrite({}).source, "/api/:path*");
  assert.equal(apiRewrite({}).destination, "http://127.0.0.1:3001/:path*");
  assert.equal(
    apiRewrite({ API_PORT: "3101" }).destination,
    "http://127.0.0.1:3101/:path*",
  );
  assert.equal(
    apiRewrite({ API_URL: "  " }).destination,
    "http://127.0.0.1:3001/:path*",
  );
});

test("explicit API_URL takes priority and invalid upstream configuration fails clearly", () => {
  assert.equal(
    apiRewrite({
      API_URL: " https://api.test.invalid/base/// ",
      API_PORT: "invalid",
    }).destination,
    "https://api.test.invalid/base/:path*",
  );
  for (const environment of [
    { API_PORT: "0" },
    { API_PORT: "65536" },
    { API_PORT: "invalid" },
    { API_URL: "ftp://api.test.invalid" },
    { API_URL: "https://api.test.invalid?search=x" },
    { API_URL: "https://api.test.invalid#fragment" },
  ])
    assert.throws(() => apiRewrite(environment));
});

// Exercise the existing backend handlers and schema; no replacement API or products.
const apiRequire = createRequire(
  new URL("../../api/package.json", import.meta.url),
);
const Fastify = apiRequire("fastify");
const { tsImport } = apiRequire("tsx/esm/api");
const { registerCatalogRoutes } = await tsImport(
  "../../api/src/modules/catalog/route.ts",
  import.meta.url,
);
const { registerErrorHandler } = await tsImport(
  "../../api/src/plugins/error-handler.ts",
  import.meta.url,
);

test("existing Fastify catalog routes accept query values and distinguish service failures from 404", async () => {
  const app = Fastify();
  const calls = [];
  const unavailable = () => {
    throw new Error("Test service unavailable");
  };
  registerErrorHandler(app);
  registerCatalogRoutes(app, {
    listCategories: unavailable,
    listProducts: async (query) => {
      calls.push(query);
      unavailable();
    },
  });
  try {
    const params = new URLSearchParams({
      search: "Кроссовки & ko'ylak?",
      category: "men-streetwear",
      cursor: "item+id/=?&",
      limit: "6",
    });
    const response = await app.inject(`/catalog/products?${params}`);
    assert.equal(response.statusCode, 500);
    assert.equal(response.json().error, "Internal Server Error");
    assert.deepEqual(calls[0], {
      search: "Кроссовки & ko'ylak?",
      category: "men-streetwear",
      cursor: "item+id/=?&",
      limit: 6,
    });
    assert.equal((await app.inject("/catalog/categories")).statusCode, 500);
    for (const invalid of [
      "limit=0",
      "category=",
      "cursor=",
      "search=",
      "unexpected=1",
    ]) {
      assert.equal(
        (await app.inject(`/catalog/products?${invalid}`)).statusCode,
        400,
      );
    }
    assert.equal(calls.length, 1);
    assert.equal((await app.inject("/api/catalog/products")).statusCode, 404);
  } finally {
    await app.close();
  }
});
