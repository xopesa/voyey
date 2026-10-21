import { URL, URLSearchParams } from "node:url";
import * as shared from "@stenzo/shared";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";

function load(file, globals = {}) {
  const exports = {};
  runInNewContext(
    ts.transpileModule(readFileSync(new URL(file, import.meta.url), "utf8"), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
    }).outputText,
    {
      exports,
      URL,
      URLSearchParams,
      require: (name) => {
        if (name === "@stenzo/shared") return shared;
        throw new Error(name);
      },
      ...globals,
    },
  );
  return exports;
}
const products = load("../src/lib/products.ts");
const valid = {
  ...products.emptyDraft,
  nameRu: "Худи",
  nameUz: "Hudi",
  slug: "core-hoodie",
  categoryId: "category",
  price: "850000",
  sourceUrl: "https://example.com/product",
};

test("manual UZS prices and stock reject decimals, conversion notation and int overflow", () => {
  assert.equal(products.productInput(valid).price, 850000);
  assert.equal(products.productInput(valid).currency, "UZS");
  for (const price of [
    "850000.5",
    "850 000",
    "850,000",
    "1e6",
    "0",
    "-1",
    "2147483648",
    "",
  ]) {
    assert.throws(
      () => products.productInput({ ...valid, price }),
      /invalidInteger/,
    );
  }
  assert.equal(products.integer("0"), 0);
  assert.equal(products.integer("2147483647"), 2147483647);
});
test("source links permit only HTTP(S), are optional, and nullable editor fields round trip", () => {
  for (const sourceUrl of [
    "ftp://example.com",
    "javascript:alert(1)",
    "file:///photo",
    "invalid",
  ])
    assert.throws(
      () => products.productInput({ ...valid, sourceUrl }),
      /invalidSource/,
    );
  assert.equal(
    products.productInput({ ...valid, sourceUrl: "" }).sourceUrl,
    null,
  );
  assert.equal(
    products.productInput({ ...valid, sourceUrl: "http://example.com" })
      .sourceUrl,
    "http://example.com",
  );
  const draft = products.productDraft({
    ...valid,
    sourceUrl: null,
    descriptionRu: null,
    descriptionUz: "Tavsif",
    price: 850000,
  });
  assert.equal(draft.descriptionRu, "");
  assert.equal(draft.descriptionUz, "Tavsif");
  assert.equal(draft.sourceUrl, "");
  assert.equal(draft.price, "850000");
});
test("RU/UZ catalog filters are encoded and both translations cover every message", () => {
  const query = new URL(
    products.productQuery(
      { search: " Чёрное худи ", category: "hoodies", status: "ACTIVE" },
      "cursor",
    ),
    "http://localhost/",
  ).searchParams;
  assert.equal(query.get("search"), "Чёрное худи");
  assert.equal(query.get("category"), "hoodies");
  assert.equal(query.get("status"), "ACTIVE");
  assert.equal(query.get("cursor"), "cursor");
  const { messages } = load("../src/lib/i18n.ts");
  assert.deepEqual(
    Object.keys(messages.ru).sort(),
    Object.keys(messages.uz).sort(),
  );
  for (const locale of ["ru", "uz"])
    for (const message of Object.values(messages[locale]))
      assert.ok(message.trim());
});
test("unsaved changes block leaving when confirmation is declined and clean up listeners", () => {
  const listeners = new Map();
  let cleanup;
  class Element {
    closest() {
      return this;
    }
    getAttribute(key) {
      return key === "href" ? "/products" : null;
    }
  }
  const scope = {
    addEventListener: (event, listener) => listeners.set(event, listener),
    removeEventListener: (event) => listeners.delete(event),
  };
  const hook = load("../src/components/products/useUnsavedChanges.ts", {
    Element,
    window: { ...scope, confirm: () => false },
    document: scope,
    require: () => ({
      useEffect: (effect) => {
        cleanup = effect();
      },
    }),
  });
  hook.useUnsavedChanges(true, "Unsaved changes");
  let prevented = false;
  listeners.get("click")({
    target: new Element(),
    button: 0,
    preventDefault: () => {
      prevented = true;
    },
    stopPropagation() {},
  });
  assert.equal(prevented, true);
  const event = { preventDefault() {}, returnValue: null };
  listeners.get("beforeunload")(event);
  assert.equal(event.returnValue, "");
  cleanup();
  assert.equal(listeners.size, 0);
});

for (const [name, sale, expected] of [
  ["active", { salePrice: "700000", saleStartsAt: "", saleEndsAt: "" }, 700000],
  [
    "scheduled in Tashkent",
    {
      salePrice: "700000",
      saleStartsAt: "2026-11-01T09:00",
      saleEndsAt: "2026-11-02T09:00",
    },
    700000,
  ],
  ["clear", { salePrice: "", saleStartsAt: "", saleEndsAt: "" }, null],
])
  test(`promotion editor serializes ${name}`, () => {
    const input = products.productInput({ ...valid, ...sale });
    assert.equal(input.salePrice, expected);
    if (sale.saleStartsAt)
      assert.equal(input.saleStartsAt, "2026-11-01T04:00:00.000Z");
    const roundtrip = products.productDraft({ ...input, id: "fixture" });
    assert.equal(roundtrip.salePrice, sale.salePrice);
    assert.equal(roundtrip.saleStartsAt, sale.saleStartsAt);
  });
test("promotion editor rejects equal/base-conflicting prices and orphan/reversed schedules", () => {
  for (const patch of [
    { salePrice: "850000" },
    { salePrice: "900000" },
    { salePrice: "0" },
    { saleStartsAt: "2026-11-01T09:00" },
    {
      salePrice: "700000",
      saleStartsAt: "2026-11-02T09:00",
      saleEndsAt: "2026-11-01T09:00",
    },
  ])
    assert.throws(() => products.productInput({ ...valid, ...patch }));
});

test("private per-unit cost round-trips in Admin draft, rejects invalid money, blank remains unknown", () => {
  assert.equal(
    products.productInput({ ...valid, costPrice: "73001" }).costPrice,
    73001,
  );
  assert.equal(
    products.productInput({ ...valid, costPrice: "" }).costPrice,
    null,
  );
  for (const value of ["0", "-1", "1.5", "1e5", "2147483648"])
    assert.throws(
      () => products.productInput({ ...valid, costPrice: value }),
      /invalidInteger/,
    );
  const draft = products.productDraft({
    ...valid,
    price: 200000,
    costPrice: 73001,
  });
  assert.equal(draft.costPrice, "73001");
});
