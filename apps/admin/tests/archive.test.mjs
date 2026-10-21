import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import { URL } from "node:url";
import { setImmediate } from "node:timers";
import * as shared from "@stenzo/shared";
import ts from "typescript";
const require = createRequire(import.meta.url);
function load(file, deps = {}, globals = {}) {
  const exports = {};
  runInNewContext(
    ts.transpileModule(readFileSync(new URL(file, import.meta.url), "utf8"), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        jsx: ts.JsxEmit.ReactJSX,
      },
    }).outputText,
    {
      ...globals,
      exports,
      Intl,
      AbortController: globalThis.AbortController,
      require: (n) => {
        if (n in deps) return deps[n];
        if (n === "@stenzo/shared") return shared;
        if (n === "react/jsx-runtime") return require(n);
        throw Error(n);
      },
    },
  );
  return exports;
}
const { messages } = load("../src/lib/i18n.ts");
const nodes = (n) =>
  n && typeof n === "object"
    ? [n, ...[n.props?.children].flat(Infinity).flatMap(nodes)]
    : [];
const tick = () => new Promise((r) => setImmediate(r));

function fixture(kind, locale = "ru") {
  const state = [],
    refs = [],
    calls = [];
  let i = 0,
    r = 0,
    confirm = false,
    handle = async () => ({
      category: {
        ...category,
        archivedAt: "2026-10-20T00:00:00Z",
        isActive: false,
      },
    });
  const category = {
    id: "c",
    nameRu: "Брюки",
    nameUz: "Shim",
    slug: "c",
    isActive: true,
    sortOrder: 0,
  };
  const product = {
    id: "p",
    nameRu: "Брюки",
    nameUz: "Shim",
    slug: "p",
    category,
    status: "ACTIVE",
    price: 290000,
  };
  const deps = {
    react: {
      useEffect() {},
      useCallback: (fn) => fn,
      useRef(initial) {
        return refs[r++] ?? (refs[r - 1] = { current: initial });
      },
      useState(initial) {
        const slot = i++;
        if (!(slot in state)) state[slot] = initial;
        return [
          state[slot],
          (v) => {
            state[slot] = typeof v === "function" ? v(state[slot]) : v;
          },
        ];
      },
    },
    "../AdminFrame": { AdminFrame: "frame" },
    "./Header": { Header: "header" },
    "./AdminFrame": { AdminNav: "nav" },
    "../Preferences": {
      usePreferences: () => ({ locale, t: (k) => messages[locale][k] }),
    },
    "./Preferences": {
      usePreferences: () => ({ locale, t: (k) => messages[locale][k] }),
    },
    "../../lib/api": {
      api: async (...args) => {
        calls.push(args);
        return handle(...args);
      },
      errorKey: () => "error",
    },
    "../lib/api": {
      api: async (...args) => {
        calls.push(args);
        return handle(...args);
      },
      errorKey: () => "error",
    },
    "../../lib/products": { productQuery: () => "catalog/products" },
  };
  const mod = load(
    kind === "products"
      ? "../src/components/products/ProductsList.tsx"
      : "../src/components/Categories.tsx",
    deps,
    { window: { confirm: () => confirm } },
  );
  const render = () => {
    i = 0;
    r = 0;
    return nodes(
      (mod.ProductsList ?? mod.Categories)({ csrfToken: "fixture" }),
    );
  };
  render();
  if (kind === "products") {
    state[0] = [category];
    state[1] = [product];
    state[5] = false;
  } else {
    state[0] = [category];
    state[1] = false;
  }
  return {
    render,
    state,
    calls,
    product,
    category,
    t: (k) => messages[locale][k],
    allow: () => {
      confirm = true;
    },
    handle: (fn) => {
      handle = fn;
    },
  };
}
for (const kind of ["products", "categories"])
  for (const locale of ["ru", "uz"])
    test(
      kind +
        " " +
        locale +
        ": archive explicit confirm, CSRF and duplicate-click lock; archived view only restores",
      async () => {
        const f = fixture(kind, locale);
        const button = () =>
          f
            .render()
            .find(
              (n) =>
                n.type === "button" &&
                n.props.children === f.t("archiveAction"),
            );
        button().props.onClick();
        assert.equal(f.calls.length, 0);
        f.allow();
        const click = button().props.onClick;
        click();
        click();
        await tick();
        assert.equal(f.calls.length, 1);
        assert.equal(f.calls[0][1].method, "POST");
        assert.equal(f.calls[0][1].headers["x-csrf-token"], "fixture");
        assert.match(f.calls[0][0], /\/archive$/);
        if (kind === "products") {
          f.state[1] = [{ ...f.product, archivedAt: "2026-10-20" }];
        } else {
          f.state[0] = [{ ...f.category, archivedAt: "2026-10-20" }];
          f.state[7] = "archived";
        }
        const tree = f.render();
        assert.equal(
          tree.some(
            (n) => n.type === "button" && n.props.children === f.t("activate"),
          ),
          false,
        );
        assert.ok(
          tree.some(
            (n) =>
              n.type === "button" && n.props.children === f.t("archiveRestore"),
          ),
        );
        assert.ok(tree.some((n) => n.props.className === "archived-row"));
      },
    );

for (const locale of ["ru", "uz"])
  for (const enabled of [false, true])
    test(`product list ${locale}: channel choice ${enabled} is explicit in activation request`, async () => {
      const f = fixture("products", locale);
      f.product.status = "DRAFT";
      let tree = f.render();
      const option = tree.find(
        (n) => n.type === "input" && n.props.type === "checkbox",
      );
      assert.equal(option.props.checked, false);
      if (enabled) option.props.onChange({ target: { checked: true } });
      tree = f.render();
      assert.ok(
        tree.some(
          (n) =>
            Array.isArray(n.props?.children) &&
            n.props.children.includes(f.t("channelAlsoPublish")),
        ),
      );
      await tree
        .find(
          (n) => n.type === "button" && n.props.children === f.t("activate"),
        )
        .props.onClick();
      assert.equal(f.calls.length, 1);
      assert.equal(f.calls[0][0], "catalog/products/p/activate");
      assert.deepEqual(JSON.parse(f.calls[0][1].body), {
        publishToChannel: enabled,
      });
      assert.equal(f.calls[0][1].headers["x-csrf-token"], "fixture");
    });
