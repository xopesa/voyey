import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { URL, URLSearchParams } from "node:url";
import ts from "typescript";
function load(url, globals = {}) {
  const exports = {};
  runInNewContext(
    ts.transpileModule(readFileSync(url, "utf8"), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        jsx: ts.JsxEmit.ReactJSX,
      },
    }).outputText,
    { exports, URLSearchParams, ...globals },
  );
  return exports;
}
const shared = load(
  new URL("../../../packages/shared/src/telegram-product.ts", import.meta.url),
);
const launch = load(new URL("../src/lib/product-launch.ts", import.meta.url), {
  require: () => shared,
});
test("safe deterministic product start parameters round-trip to the exact local catalog route", () => {
  assert.equal(shared.productStartParam("stenzo-hudi"), "product_stenzo-hudi");
  assert.equal(
    shared.productPathFromStartParam("product_stenzo-hudi"),
    "/catalog/stenzo-hudi",
  );
  for (const value of [
    null,
    "",
    "product_",
    "product_../admin",
    "product_https://evil.invalid",
    "product_a/b",
    "product_%2Fadmin",
    "product_RU",
    "product_" + "a".repeat(101),
  ])
    assert.equal(shared.productPathFromStartParam(value), null);
});
test("Telegram initData start_param wins over unsafe metadata and query fallback", () => {
  assert.equal(
    launch.productLaunchPath(
      {
        initData: "start_param=product_signed-hudi",
        initDataUnsafe: { start_param: "product_other" },
      },
      "?tgWebAppStartParam=product_other",
    ),
    "/catalog/signed-hudi",
  );
  assert.equal(
    launch.productLaunchPath(
      { initDataUnsafe: { start_param: "product_metadata" } },
      "",
    ),
    "/catalog/metadata",
  );
  assert.equal(
    launch.productLaunchPath(undefined, "?tgWebAppStartParam=product_fallback"),
    "/catalog/fallback",
  );
});
test("malformed/duplicate launch parameters are ignored without external redirects", () => {
  for (const initData of [
    "start_param=product_a&start_param=product_b",
    "start_param=https%3A%2F%2Fevil.invalid",
    "start_param=product_..%2Fadmin",
  ])
    assert.equal(
      launch.productLaunchPath(
        { initData },
        "?tgWebAppStartParam=product_good",
      ),
      null,
    );
  assert.equal(
    launch.productLaunchPath(
      undefined,
      "?tgWebAppStartParam=product_a&tgWebAppStartParam=product_b",
    ),
    null,
  );
  assert.equal(
    launch.productLaunchPath(undefined, "?startapp=product_hudi"),
    null,
  );
});
test("actual ProductLaunch component routes once, independently of UZ/RU or cached session", () => {
  for (const locale of ["uz", "ru"])
    for (const cached of [false, true]) {
      const targets = [];
      const applied = { current: false };
      const window = {
        Telegram: {
          WebApp: {
            initData: "start_param=product_exact-hudi",
            initDataUnsafe: { user: { language_code: locale } },
          },
        },
        location: { pathname: "/", search: "" },
        sessionStorage: { getItem: () => (cached ? "synthetic-only" : null) },
      };
      const { ProductLaunch } = load(
        new URL("../src/components/ProductLaunch.tsx", import.meta.url),
        {
          window,
          require: (name) =>
            name === "react"
              ? { useRef: () => applied, useEffect: (fn) => fn() }
              : name === "next/navigation"
                ? {
                    useRouter: () => ({
                      replace: (path) => targets.push(path),
                    }),
                  }
                : launch,
        },
      );
      ProductLaunch();
      ProductLaunch();
      assert.deepEqual(targets, ["/catalog/exact-hudi"]);
    }
});
test("ProductLaunch preserves Home for invalid input and does not hijack an already-open product", () => {
  for (const [pathname, param] of [
    ["/", "product_../admin"],
    ["/catalog/current", "product_other"],
  ]) {
    const targets = [];
    const { ProductLaunch } = load(
      new URL("../src/components/ProductLaunch.tsx", import.meta.url),
      {
        window: {
          location: {
            pathname,
            search: "?tgWebAppStartParam=" + encodeURIComponent(param),
          },
        },
        require: (name) =>
          name === "react"
            ? { useRef: () => ({ current: false }), useEffect: (fn) => fn() }
            : name === "next/navigation"
              ? { useRouter: () => ({ replace: (path) => targets.push(path) }) }
              : launch,
      },
    );
    ProductLaunch();
    assert.deepEqual(targets, []);
  }
});
