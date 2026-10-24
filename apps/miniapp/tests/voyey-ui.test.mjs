import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath, URL } from "node:url";
import { dirname, resolve } from "node:path";
import { runInNewContext } from "node:vm";
import { test } from "node:test";
import ts from "typescript";
import * as shared from "@stenzo/shared";
const require = createRequire(import.meta.url),
  base = fileURLToPath(new URL("../src/voyey/", import.meta.url)),
  cache = new Map();
function load(path) {
  const file = resolve(path);
  if (cache.has(file)) return cache.get(file);
  const exports = {};
  cache.set(file, exports);
  const source = readFileSync(file, "utf8");
  const code = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  runInNewContext(code, {
    exports,
    require: (name) =>
      name === "@stenzo/shared"
        ? shared
        : name.startsWith(".")
          ? load(resolve(dirname(file), name + ".ts"))
          : require(name),
  });
  return exports;
}
const d = load(resolve(base, "domain.ts")),
  f = load(resolve(base, "fixtures.ts")),
  i = load(resolve(base, "messages.ts"));
const recipient = {
  fullName: "Demo User",
  phone: "+998000000000",
  city: "Demo city",
  address: "Demo location",
  apartment: null,
  comment: null,
};
const err = (code) => (e) => e.code === code;
const order = (mode = "PREORDER", percent = 50) =>
  d.checkout(d.initialState(), mode, recipient, "pickup", percent, true, 1000)
    .order;
test("UI cart supports both modes of one SKU and zero-stock permitted preorder", () => {
  let s = d.initialState();
  s = d.addToCart(s, "planner", "planner-pink", "PREORDER", 2);
  assert.equal(s.cart.filter((r) => r.variantId === "planner-pink").length, 2);
  s = d.addToCart(s, "markers", "markers-12", "PREORDER", 1);
  assert.equal(s.stock["markers-12"], 0);
  assert.throws(
    () => d.addToCart(s, "markers", "markers-12", "IN_STOCK", 1),
    err("stock"),
  );
  assert.throws(
    () => d.addToCart(s, "soap", "soap-300", "PREORDER", 1),
    err("variant"),
  );
});
test("UI aggregate quantity cannot be bypassed through sale modes", () => {
  let s = d.initialState();
  s = d.addToCart(s, "planner", "planner-pink", "PREORDER", 98);
  assert.throws(
    () => d.addToCart(s, "planner", "planner-pink", "PREORDER", 1),
    err("quantity"),
  );
  assert.throws(
    () => d.addToCart(s, "planner", "planner-pink", "IN_STOCK", 1),
    err("quantity"),
  );
  assert.equal(
    s.cart.find((r) => r.id === "planner-pink:IN_STOCK").quantity,
    1,
  );
});
test("UI finite stock and legacy null never become preorder implicitly", () => {
  const s = d.initialState(),
    v = f.products[0].variants[0];
  assert.equal(
    d.modes({ ...v, preorderEnabled: false }, { [v.id]: null }).PREORDER,
    false,
  );
  assert.equal(d.modes(v, { [v.id]: null }).IN_STOCK, false);
  assert.throws(
    () => d.addToCart(s, "planner", v.id, "IN_STOCK", 8),
    err("stock"),
  );
});
test("UI clothing measurements are validated while stationery does not need them", () => {
  let s = d.initialState();
  assert.throws(
    () => d.addToCart(s, "hoodie", "hoodie-m", "IN_STOCK", 1),
    err("measurements"),
  );
  s = d.addToCart(s, "hoodie", "hoodie-m", "IN_STOCK", 1, 170, 65);
  assert.equal(s.cart.at(-1).heightCm, 170);
  assert.equal(order("IN_STOCK").percent, 100);
});
test("UI discounts cap at floor 99%, reject free/tiny/invalid discounts", () => {
  assert.equal(d.promoDiscount(101, "FIXED", 50000), 99);
  assert.equal(d.promoDiscount(101, "PERCENT", 99), 99);
  assert.throws(() => d.promoDiscount(1, "FIXED", 1), err("tiny"));
  assert.throws(() => d.promoDiscount(100, "PERCENT", 100), err("promo"));
  assert.throws(() => d.promoDiscount(100, "PERCENT", 0), err("promo"));
});
test("UI promo and checkout preserve the other tab, PRE does not reserve stock", () => {
  let s = d.applyPromo(d.initialState(), "IN_STOCK", " ready10 ");
  assert.throws(() => d.applyPromo(s, "PREORDER", "READY10"), err("promoMode"));
  s = d.applyPromo(s, "PREORDER", "PRE15");
  const before = JSON.stringify(
      s.cart.filter((r) => r.saleMode === "IN_STOCK"),
    ),
    stock = JSON.stringify(s.stock);
  const result = d.checkout(s, "PREORDER", recipient, "local", 50, true, 1000);
  assert.equal(JSON.stringify(result.state.stock), stock);
  assert.equal(JSON.stringify(result.state.cart), before);
  assert.equal(result.state.promos.IN_STOCK.applied, "READY10");
  assert.equal(result.order.firstAmount, 30600);
  assert.equal(result.order.remaining, 30600);
  assert.equal(result.order.cargo, null);
  assert.equal(result.order.lines.length, 1);
  assert.equal(result.order.lines[0].attributes.pack_quantity, 12);
  assert.notEqual(result.order.recipient, recipient);
});
test("UI failed checkout is atomic and successful IN checkout consumes finite stock once", () => {
  let s = d.initialState(),
    copy = JSON.stringify(s);
  assert.throws(
    () => d.checkout(s, "IN_STOCK", recipient, "pickup", 100, false, 1000),
    err("terms"),
  );
  assert.equal(JSON.stringify(s), copy);
  s = { ...s, stock: { ...s.stock, "planner-pink": 0 } };
  copy = JSON.stringify(s);
  assert.throws(
    () => d.checkout(s, "IN_STOCK", recipient, "pickup", 100, true, 1000),
    err("stock"),
  );
  assert.equal(JSON.stringify(s), copy);
  const result = d.checkout(
    d.initialState(),
    "IN_STOCK",
    recipient,
    "pickup",
    100,
    true,
    1000,
  );
  assert.equal(result.state.stock["planner-pink"], 7);
  assert.equal(result.state.cart.length, 1);
  assert.equal(result.order.firstAmount, 138000);
  assert.throws(
    () =>
      d.checkout(
        result.state,
        "IN_STOCK",
        recipient,
        "pickup",
        100,
        true,
        1001,
      ),
    err("empty"),
  );
});
test("UI filters search both locales, categories, price, size, modes and sort", () => {
  const s = d.initialState(),
    base = { ...d.defaultFilters };
  assert.equal(
    d.filterProducts({ ...base, query: "sovuni" }, s.stock)[0].id,
    "soap",
  );
  assert.equal(
    d.filterProducts(
      { ...base, category: "clothing", size: "L", mode: "PREORDER" },
      s.stock,
    ).length,
    1,
  );
  assert.equal(
    d.filterProducts(
      { ...base, category: "clothing", size: "L", mode: "IN_STOCK" },
      s.stock,
    ).length,
    0,
  );
  assert.equal(
    d.filterProducts({ ...base, max: 50000, sort: "priceAsc" }, s.stock)[0].id,
    "pouch",
  );
  assert.equal(
    d.filterProducts({ ...base, query: "never-match" }, s.stock).length,
    0,
  );
  assert.equal(
    d.filterProducts({ ...base, sort: "priceDesc" }, s.stock)[0].id,
    "hoodie",
  );
});
const file = { name: "test.png", type: "image/png", size: 100 };
test("UI FIRST 24h, pending reservation and idempotent receipt replay", () => {
  let o = order();
  assert.equal(d.deadline(o) - o.createdAt, 86400000);
  assert.throws(
    () => d.submitReceipt(o, "late", file, o.expiresAt),
    err("expired"),
  );
  assert.throws(
    () => d.submitReceipt(o, "bad", { ...file, type: "text/plain" }, 2000),
    err("file"),
  );
  assert.equal(o.claims.length, 0);
  o = d.submitReceipt(o, "one", file, 2000);
  assert.equal(d.submitReceipt(o, "one", file, o.expiresAt + 1), o);
  assert.throws(() => d.submitReceipt(o, "two", file, 3000), err("pending"));
  o = d.reviewReceipt(o, "APPROVED", o.expiresAt + 100);
  assert.equal(o.claims[0].status, "APPROVED");
  assert.throws(() => d.submitReceipt(o, "two", file, 3000), err("paid"));
});
test("UI one 2h late rejection extension and at most 3 accepted attempts", () => {
  let o = d.submitReceipt(order(), "one", file, 2000);
  const late = o.expiresAt + 1000;
  o = d.reviewReceipt(o, "REJECTED", late);
  assert.equal(d.deadline(o), late + 7200000);
  o = d.submitReceipt(o, "two", file, late + 1000);
  o = d.reviewReceipt(o, "REJECTED", late + 2000);
  assert.equal(o.extensionAt, late);
  o = d.submitReceipt(o, "three", file, late + 3000);
  o = d.reviewReceipt(o, "REJECTED", late + 4000);
  assert.throws(
    () => d.submitReceipt(o, "four", file, late + 5000),
    err("attempts"),
  );
  assert.equal(o.claims.length, 3);
});
test("UI RU/UZ parity and isolated entry without production imports or gradients", () => {
  assert.deepEqual(
    Object.keys(i.dictionaries.ru).sort(),
    Object.keys(i.dictionaries.uz).sort(),
  );
  for (const dict of Object.values(i.dictionaries))
    for (const value of Object.values(dict)) assert.ok(value.trim());
  assert.match(i.translator("uz")("items", { n: 2 }), /2 dona/);
  const css = readFileSync(resolve(base, "styles.css"), "utf8");
  assert.doesNotMatch(css, /(?:linear|radial|conic)-gradient\s*\(/i);
  for (const name of ["App.tsx", "components.tsx", "domain.ts", "entry.tsx"])
    assert.doesNotMatch(
      readFileSync(resolve(base, name), "utf8"),
      /\bfetch\s*\(|XMLHttpRequest|sendBeacon|TelegramSessionProvider|from\s+["'].*api-client/,
    );
  const html = readFileSync(resolve(base, "../../voyey-demo.html"), "utf8");
  assert.match(html, /form-action 'none'/);
  assert.doesNotMatch(html, /telegram-web-app|spa\.tsx/);
});
