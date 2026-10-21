import { URL } from "node:url";
const { AbortController } = globalThis;
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import * as shared from "@stenzo/shared";
import ts from "typescript";
const require = createRequire(import.meta.url);
function load(file, deps = {}) {
  const exports = {};
  runInNewContext(
    ts.transpileModule(
      readFileSync(new URL("../src/" + file, import.meta.url), "utf8"),
      {
        compilerOptions: {
          module: ts.ModuleKind.CommonJS,
          target: ts.ScriptTarget.ES2022,
          jsx: ts.JsxEmit.ReactJSX,
        },
      },
    ).outputText,
    {
      exports,
      AbortController,
      Intl,
      require: (name) => {
        if (name in deps) return deps[name];
        if (name === "@stenzo/shared") return shared;
        if (name === "react/jsx-runtime") return require(name);
        throw Error(name);
      },
    },
  );
  return exports;
}
const { messages } = load("lib/i18n.ts"),
  products = load("lib/products.ts");
const nodes = (n) =>
  n && typeof n === "object"
    ? [n, ...[n.props?.children].flat(Infinity).flatMap(nodes)]
    : [];
function fixture(locale) {
  const state = [],
    calls = [],
    category = {
      id: "category",
      nameRu: "Тест",
      nameUz: "Sinov",
      isActive: true,
    };
  const product = {
    id: "product",
    nameRu: "Тест",
    nameUz: "Sinov",
    slug: "fixture",
    categoryId: "category",
    category,
    price: 250000,
    status: "DRAFT",
    sourceUrl: null,
    descriptionRu: null,
    descriptionUz: null,
    salePrice: null,
    saleStartsAt: null,
    saleEndsAt: null,
    images: [],
    variants: [],
  };
  let index = 0;
  const { ProductEditor } = load("components/products/ProductEditor.tsx", {
    react: {
      useState: (initial) => {
        const slot = index++;
        if (!(slot in state)) state[slot] = initial;
        return [
          state[slot],
          (next) => {
            state[slot] = typeof next === "function" ? next(state[slot]) : next;
          },
        ];
      },
      useEffect() {},
      useCallback: (fn) => fn,
    },
    "next/navigation": { useRouter: () => ({ replace() {} }) },
    "../AdminFrame": { AdminFrame: "frame" },
    "../Preferences": {
      usePreferences: () => ({ t: (key) => messages[locale][key] }),
    },
    "../../lib/api": {
      api: async (path, init) => {
        calls.push({ path, init });
        return { product: { ...product, status: "ACTIVE" } };
      },
      errorKey: () => "error",
    },
    "../../lib/products": products,
    "./ProductBasics": { ProductBasics: "basics" },
    "./ProductImages": { ProductImages: "images" },
    "./ProductVariants": { ProductVariants: "variants" },
    "./useUnsavedChanges": { useUnsavedChanges() {} },
    "./TelegramChannel": { TelegramChannel: "channel-choice" },
  });
  const render = () => {
    index = 0;
    return nodes(
      ProductEditor({ csrfToken: "fixture-csrf", productId: "product" }),
    );
  };
  render();
  state[0] = product;
  state[1] = [category];
  state[2] = products.productDraft(product);
  state[3] = state[2];
  state[4] = false;
  return { render, calls, t: (key) => messages[locale][key] };
}
for (const locale of ["ru", "uz"])
  for (const save of [false, true])
    for (const enabled of [false, true])
      test(`editor ${locale}: ${save ? "status save" : "activate"} forwards channel choice ${enabled}`, async () => {
        const f = fixture(locale);
        let tree = f.render();
        const choice = tree.find((n) => n.type === "channel-choice");
        assert.equal(choice.props.publishToChannel, false);
        if (enabled) choice.props.onPublishToChannelChange(true);
        tree = f.render();
        if (save) {
          const basics = tree.find((n) => n.type === "basics");
          basics.props.setDraft({ ...basics.props.draft, status: "ACTIVE" });
          const changedTree = f.render();
          const changedChoice = changedTree.find(
            (n) => n.type === "channel-choice",
          );
          assert.equal(
            changedChoice.props.disabled,
            true,
            "unsaved edits block a standalone post",
          );
          assert.equal(
            changedChoice.props.choiceDisabled,
            false,
            "channel choice remains editable before saving activation",
          );
          await changedTree
            .find((n) => n.type === "form")
            .props.onSubmit({ preventDefault() {} });
        } else {
          await tree
            .find(
              (n) =>
                n.type === "button" && n.props.children === f.t("activate"),
            )
            .props.onClick();
        }
        assert.equal(f.calls.length, 1);
        const { path, init } = f.calls[0];
        assert.equal(
          path,
          save
            ? "catalog/products/product"
            : "catalog/products/product/activate",
        );
        assert.equal(init.method, save ? "PATCH" : "POST");
        assert.equal(JSON.parse(init.body).publishToChannel, enabled);
        assert.equal(init.headers["x-csrf-token"], "fixture-csrf");
      });
