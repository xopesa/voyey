import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { createRequire } from "node:module";
import { URL } from "node:url";
import { setImmediate } from "node:timers";
import ts from "typescript";
import * as shared from "@stenzo/shared";

const require = createRequire(import.meta.url);
function load(path, dependencies = {}) {
  const exports = {};
  runInNewContext(
    ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        jsx: ts.JsxEmit.ReactJSX,
      },
    }).outputText,
    {
      exports,
      require: (name) => {
        if (name === "@stenzo/shared") return shared;
        if (name in dependencies) return dependencies[name];
        if (name === "react/jsx-runtime") return require(name);
        throw new Error("Unexpected dependency: " + name);
      },
    },
  );
  return exports;
}
const products = load("../src/lib/products.ts");
const { messages } = load("../src/lib/i18n.ts");
function nodes(node) {
  if (!node || typeof node !== "object") return [];
  return [node, ...[node.props?.children].flat(Infinity).flatMap(nodes)];
}
function harness(locale = "ru") {
  const state = [],
    calls = [],
    busy = [];
  let cursor = 0,
    refreshes = 0,
    conflicts = false;
  const component = load("../src/components/products/VariantGenerator.tsx", {
    react: {
      useState: (initial) => {
        const index = cursor++;
        if (index >= state.length) state[index] = initial;
        return [
          state[index],
          (value) => {
            state[index] = value;
          },
        ];
      },
    },
    "@stenzo/shared": shared,
    "../Preferences": {
      usePreferences: () => ({ t: (key) => messages[locale][key] }),
    },
    "../../lib/products": products,
    "../../lib/api": {
      errorKey: () => "error",
      api: async (path, options) => {
        calls.push({ path, options });
        return path.endsWith("generate-preview")
          ? {
              rows: shared
                .variantCombinations(JSON.parse(options.body))
                .map((r) => ({ ...r, status: conflicts ? "CONFLICT" : "NEW" })),
            }
          : { createdCount: calls.length > 3 ? 0 : 2 };
      },
    },
  }).VariantGenerator;
  const render = () => {
    cursor = 0;
    return component({
      productId: "fixture",
      csrfToken: "fixture-csrf",
      disabled: false,
      onBusyChange: (value) => busy.push(value),
      refresh: async () => {
        refreshes++;
      },
      onClose() {},
    });
  };
  const all = () => nodes(render());
  const button = (key) =>
    all().find(
      (n) => n.type === "button" && n.props.children === messages[locale][key],
    );
  const set = (index, value) => {
    const fields = all().filter(
      (n) => n.type === "input" || n.type === "textarea",
    );
    fields[index].props.onChange({ target: { value } });
  };
  const preview = async () => {
    render().props.onSubmit({ preventDefault() {} });
    await new Promise(setImmediate);
  };
  return {
    all,
    button,
    set,
    preview,
    calls,
    busy,
    refreshes: () => refreshes,
    conflict: () => {
      conflicts = true;
    },
  };
}
for (const locale of ["ru", "uz"])
  test(`${locale}: no request before Preview; Apply requires preview, refreshes and resets; edits invalidate preview`, async () => {
    const h = harness(locale);
    assert.equal(h.button("generatorApply").props.disabled, true);
    h.set(0, " sw-rise ");
    h.set(1, "s,m,s");
    h.set(2, "0");
    assert.equal(h.calls.length, 0);
    await h.preview();
    assert.equal(h.calls.length, 1);
    assert.ok(h.calls[0].path.endsWith("generate-preview"));
    const body = JSON.parse(h.calls[0].options.body);
    assert.deepEqual(body.sizes, ["S", "M"]);
    assert.equal(body.baseSku, "SW-RISE");
    assert.equal(body.stock, 0);
    assert.equal(h.calls[0].options.headers["x-csrf-token"], "fixture-csrf");
    assert.equal(h.button("generatorApply").props.disabled, false);
    h.set(0, "OTHER");
    assert.equal(h.button("generatorApply").props.disabled, true);
    await h.preview();
    h.button("generatorApply").props.onClick();
    await new Promise(setImmediate);
    assert.equal(h.refreshes(), 1);
    assert.equal(h.calls.filter((c) => c.path.endsWith("/generate")).length, 1);
    assert.equal(h.button("generatorApply").props.disabled, true);
    assert.ok(
      h
        .all()
        .some(
          (n) =>
            n.props?.role === "status" &&
            n.props.children ===
              messages[locale].generatedCount.replace("{count}", "2"),
        ),
    );
    assert.deepEqual(h.busy, [true, false, true, false, true, false]);
    await h.preview();
    h.button("generatorApply").props.onClick();
    await new Promise(setImmediate);
    assert.ok(
      h
        .all()
        .some(
          (n) =>
            n.props?.role === "status" &&
            n.props.children === messages[locale].noNewVariants,
        ),
    );
  });
test("conflicts disable Apply and keep preview visible", async () => {
  const h = harness();
  h.set(0, "BASE");
  h.set(1, "S");
  h.conflict();
  await h.preview();
  assert.equal(h.button("generatorApply").props.disabled, true);
  assert.ok(
    h
      .all()
      .some(
        (n) => n.type === "td" && n.props.children === messages.ru.skuConflict,
      ),
  );
});
test("unknown color proposals require review; manual code edit permits preview", async () => {
  const h = harness();
  h.set(0, "BASE");
  h.set(1, "S");
  h.button("generatorAddColor").props.onClick();
  // Base, sizes, stock, active checkbox, display color, color code, review checkbox.
  h.set(4, "Olive");
  await h.preview();
  assert.equal(h.calls.length, 0);
  assert.ok(
    h
      .all()
      .some(
        (n) =>
          n.props?.role === "alert" &&
          n.props.children === messages.ru.colorReviewRequired,
      ),
  );
  h.set(5, "olv");
  await h.preview();
  assert.equal(h.calls.length, 1);
  assert.deepEqual(JSON.parse(h.calls[0].options.body).colors, [
    { color: "Olive", code: "OLV", reviewed: true },
  ]);
});
test("generator is additive: original manual form and edit/toggle controls remain", () => {
  const module = load("../src/components/products/ProductVariants.tsx", {
    react: { useEffect() {}, useState: (initial) => [initial, () => {}] },
    "../Preferences": {
      usePreferences: () => ({ t: (key) => messages.ru[key] }),
    },
    "../../lib/api": {},
    "../../lib/products": products,
    "./VariantGenerator": { VariantGenerator: () => null },
  });
  const tree = module.ProductVariants({
    productId: "fixture",
    variants: [
      {
        id: "existing",
        size: "M",
        sku: "EXISTING",
        color: null,
        stock: 0,
        isActive: true,
      },
    ],
    csrfToken: "fixture",
    disabled: false,
    onBusyChange() {},
    onDirtyChange() {},
    refresh: async () => {},
  });
  const buttons = nodes(tree).filter((n) => n.type === "button");
  for (const key of ["generateVariants", "addVariant", "edit", "deactivate"])
    assert.ok(
      buttons.some(
        (b) => b.props.children === messages.ru[key] && !b.props.disabled,
      ),
    );
});
