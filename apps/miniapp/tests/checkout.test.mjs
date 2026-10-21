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
const { Headers, AbortController, setTimeout, clearTimeout } = globalThis;
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
  runInNewContext(code, {
    exports,
    require: (name) => {
      if (name === "@stenzo/shared") return shared;
      throw Error(name);
    },
    URLSearchParams,
    Headers,
    AbortController,
    setTimeout,
    clearTimeout,
    ...globals,
  });
  return exports;
}
const cartLib = load("lib/cart.ts"),
  checkoutLib = load("lib/checkout.ts"),
  catalog = load("lib/catalog.ts");
const product = load("lib/product.ts", { require: () => catalog });
const { CartResource } = load("lib/cart-resource.ts");
const { CheckoutFlow } = load("lib/checkout-flow.ts", {
  require: () => checkoutLib,
});
const item = {
  id: "fixture-item",
  quantity: 1,
  heightCm: 180,
  weightKg: 75,
  unitPrice: 850001,
  lineTotal: 850001,
  currency: "UZS",
  isAvailable: true,
  product: {
    id: "product",
    nameRu: "Тестовое худи",
    nameUz: "Test hudi",
    slug: "test-hudi",
    imageUrl: null,
  },
  variant: {
    id: "variant",
    sku: "PRIVATE-SKU",
    size: "L",
    color: "Black",
    stock: 3,
  },
};
const cart = {
  id: "fixture-cart",
  items: [item],
  subtotal: 850001,
  currency: "UZS",
  updatedAt: "2026-10-01T00:00:00Z",
};
const empty = { ...cart, items: [], subtotal: 0 };
const draft = {
  fullName: " Ali Valiyev ",
  phone: " +998 (90) 123-45-67 ",
  city: " Tashkent ",
  address: " Amir Temur 1 ",
  apartment: " ",
  comment: " ",
};
const recipient = checkoutLib.recipientPayload(draft);
const order = {
  publicId: "STZ-TEST-000001",
  currency: "UZS",
  status: "AWAITING_PREPAYMENT",
  total: 850001,
  requiredPrepayment: 425001,
  remainingAmount: 425000,
  items: [
    {
      productNameRu: item.product.nameRu,
      productNameUz: item.product.nameUz,
      quantity: 1,
      size: "L",
      color: "Black",
      unitPrice: 850001,
      lineTotal: 850001,
      heightCm: 180,
      weightKg: 75,
    },
  ],
};
function store() {
  let saved;
  return {
    read: (id) => (saved?.cartId === id ? { ...saved } : null),
    write: (attempt) => {
      saved = { ...attempt };
    },
    clear: () => {
      saved = undefined;
    },
    value: () => saved,
  };
}
function resource(get = async () => cart) {
  return new CartResource(
    {
      get,
      update: async () => cart,
      remove: async () => empty,
      clear: async () => empty,
    },
    () => "test-token",
  );
}
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function client(fetch) {
  return load("lib/api-client.ts", {
    fetch,
    require: (name) =>
      name === "./checkout"
        ? checkoutLib
        : name === "./cart"
          ? cartLib
          : name === "./product"
            ? product
            : catalog,
  });
}
test("recipient payload matches existing field limits, phone format, trimming and nullable optional fields", () => {
  assert.equal(Object.keys(checkoutLib.recipientErrors(draft)).length, 0);
  assert.equal(recipient.fullName, "Ali Valiyev");
  assert.equal(recipient.apartment, null);
  assert.equal(recipient.comment, null);
  for (const [key, value] of [
    ["fullName", " "],
    ["phone", "hello!!"],
    ["phone", "++998901234567"],
    ["city", ""],
    ["address", "ab"],
    ["comment", "x".repeat(1001)],
    ["apartment", "x".repeat(101)],
  ])
    assert.equal(
      checkoutLib.recipientErrors({ ...draft, [key]: value })[key],
      true,
    );
  for (const phone of [
    "998901234567",
    "+998 90 123 45 67",
    "(998)901234567",
    "1234567",
  ])
    assert.equal(
      !!checkoutLib.recipientErrors({ ...draft, phone }).phone,
      phone.startsWith("("),
    );
});
test("checkout needs every measurement and available stock; formatting follows existing odd-sum policy", () => {
  assert.equal(checkoutLib.checkoutCartIssue(cart), undefined);
  assert.equal(checkoutLib.checkoutCartIssue(empty), "empty");
  for (const patch of [
    { heightCm: null },
    { weightKg: null },
    { heightCm: 99 },
    { weightKg: 301 },
    { weightKg: 75.5 },
  ])
    assert.equal(
      checkoutLib.checkoutCartIssue({
        ...cart,
        items: [item, { ...item, id: "second", ...patch }],
      }),
      "measurements",
    );
  assert.equal(
    checkoutLib.checkoutCartIssue({
      ...cart,
      items: [{ ...item, isAvailable: false }],
    }),
    "unavailable",
  );
  assert.equal(cartLib.displayedPrepayment(850001), 425001);
  assert.equal(cartLib.formatCartAmount(850001, "сум"), "850 001 сум");
});
test("Checkout client sends only recipient fields, real JWT, key, proxy POST and validates public order acknowledgement", async () => {
  let call;
  const api = client(async (url, init) => {
    call = { url, init };
    return { ok: true, json: async () => ({ order }) };
  });
  const signal = new AbortController().signal;
  const result = await api.submitCheckout(
    recipient,
    "fixture-key-000001",
    "test-token",
    signal,
  );
  assert.equal(result, order);
  assert.equal(call.url, "/api/checkout");
  assert.equal(call.init.method, "POST");
  assert.equal(call.init.headers.get("Idempotency-Key"), "fixture-key-000001");
  assert.equal(call.init.headers.get("Authorization"), "Bearer test-token");
  assert.equal(call.init.signal, signal);
  assert.equal(call.init.cache, "no-store");
  assert.deepEqual(
    JSON.parse(call.init.body),
    JSON.parse(JSON.stringify(recipient)),
  );
  const bad = client(async () => ({
    ok: true,
    json: async () => ({ order: { ...order, total: "fake" } }),
  }));
  await assert.rejects(() =>
    bad.submitCheckout(recipient, "fixture-key-000001", "test-token"),
  );
  await assert.rejects(() =>
    api.submitCheckout(recipient, "short", "test-token"),
  );
  await assert.rejects(() =>
    api.submitCheckout(recipient, "fixture-key-000001", ""),
  );
  await api.getCheckoutOrder(order.publicId, "test-token");
  assert.equal(call.url, "/api/orders/STZ-TEST-000001");
  assert.equal(
    checkoutLib.paymentHref("STZ-TEST-000001"),
    "/orders/STZ-TEST-000001/payment",
  );
});
test("Checkout errors map existing endpoint messages without exposing raw service text", async () => {
  for (const [status, detail, kind] of [
    [401, "", "auth"],
    [403, "", "access"],
    [400, "Invalid checkout payload", "contacts"],
    [409, "Cart is empty", "empty"],
    [
      409,
      "Every cart item requires height (100–250 cm) and weight (30–300 kg)",
      "measurements",
    ],
    [409, "Product is unavailable", "product"],
    [409, "Product variant is unavailable", "variant"],
    [409, "Requested quantity exceeds available stock (0)", "stock"],
    [409, "Checkout could not be completed safely", "conflict"],
    [500, "", "request"],
  ]) {
    const api = client(async () => ({
      ok: false,
      status,
      json: async () => ({ error: detail }),
    }));
    await assert.rejects(
      () => api.submitCheckout(recipient, "fixture-key-000001", "test-token"),
      (error) => checkoutLib.checkoutFailure(error) === kind,
    );
  }
});

test("commerce-disabled code survives API errors and only its exact 503 is a definite unavailable failure", async () => {
  for (const [status, payload, failure] of [
    [
      503,
      { code: "COMMERCE_DISABLED", error: "Gate refused checkout" },
      "unavailable",
    ],
    [
      503,
      {
        error:
          "Preview commerce is disabled until separate credentials are configured",
      },
      "request",
    ],
    [500, { code: "COMMERCE_DISABLED" }, "request"],
    [503, { code: { value: "COMMERCE_DISABLED" } }, "request"],
    [503, null, "request"],
    [503, { code: "UNKNOWN_FAILURE" }, "request"],
  ]) {
    const api = client(async () => ({
      ok: false,
      status,
      json: async () => payload,
    }));
    await assert.rejects(
      api.submitCheckout(recipient, "fixture-key-000001", "test-token"),
      (error) => {
        assert.equal(error.status, status);
        assert.equal(error.detail, payload?.error);
        if (failure === "unavailable")
          assert.equal(error.code, "COMMERCE_DISABLED");
        return checkoutLib.checkoutFailure(error) === failure;
      },
    );
  }
});

test("commerce-disabled checkout is not recoverable and preserves cart and idempotency key", async () => {
  const res = resource();
  await res.load();
  const journal = store();
  const flow = new CheckoutFlow(
    res,
    async () => {
      throw { status: 503, code: "COMMERCE_DISABLED" };
    },
    () => "token",
    journal,
    () => "disabled-fixture-key-0001",
  );
  await flow.submit(cart, recipient);
  assert.equal(flow.snapshot().failure, "unavailable");
  assert.equal(flow.snapshot().recoverable, false);
  assert.equal(journal.value().uncertain, false);
  assert.equal(res.snapshot().cart, cart);
  const restored = new CheckoutFlow(
    res,
    async () => order,
    () => "token",
    journal,
    () => {
      throw Error("Must retain the original idempotency key");
    },
  );
  restored.restore(cart.id);
  assert.equal(restored.snapshot().recoverable, false);
});

test("unknown 5xx keeps duplicate protection; commerce-disabled replay keeps the same key without false warning", async () => {
  const res = resource();
  await res.load();
  const journal = store(),
    keys = [];
  let phase = 0;
  const flow = new CheckoutFlow(
    res,
    async (body, key) => {
      keys.push(key);
      if (phase === 0) throw { status: 503 };
      if (phase === 1) throw { status: 503, code: "COMMERCE_DISABLED" };
      return order;
    },
    () => "token",
    journal,
    () => "unknown-fixture-key-0001",
  );
  await flow.submit(cart, recipient);
  assert.equal(flow.snapshot().recoverable, true);
  assert.equal(journal.value().uncertain, true);
  phase = 1;
  await flow.submit(cart, recipient);
  assert.equal(flow.snapshot().failure, "unavailable");
  assert.equal(flow.snapshot().recoverable, false);
  assert.equal(journal.value().uncertain, false);
  phase = 2;
  await flow.submit(cart, recipient);
  assert.equal(new Set(keys).size, 1);
  assert.equal(flow.snapshot().order, order);
});
test("preflight updates changed server prices and asks for review without POST; next confirmation uses current cart", async () => {
  let snapshot = cart,
    calls = 0;
  const res = resource(async () => snapshot);
  await res.load();
  const journal = store();
  const flow = new CheckoutFlow(
    res,
    async () => {
      calls++;
      return order;
    },
    () => "token",
    journal,
    () => "fixture-key-000001",
  );
  snapshot = {
    ...cart,
    subtotal: 900001,
    items: [{ ...item, unitPrice: 900001, lineTotal: 900001 }],
  };
  await flow.submit(cart, recipient);
  assert.equal(calls, 0);
  assert.equal(flow.snapshot().failure, "changed");
  assert.equal(res.snapshot().cart.subtotal, 900001);
  assert.equal(journal.value(), undefined);
  await flow.submit(snapshot, recipient);
  assert.equal(calls, 1);
  assert.equal(flow.snapshot().order, order);
});
test("double submit during preflight/POST creates one attempt and cannot show success before acknowledgement", async () => {
  const res = resource();
  await res.load();
  const pending = deferred();
  let posts = 0,
    keys = 0;
  const journal = store();
  const flow = new CheckoutFlow(
    res,
    () => {
      posts++;
      return pending.promise;
    },
    () => "token",
    journal,
    () => {
      keys++;
      return "fixture-key-000001";
    },
  );
  const first = flow.submit(cart, recipient);
  await flow.submit(cart, recipient);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(posts, 1);
  assert.equal(keys, 1);
  assert.equal(flow.snapshot().phase, "submitting");
  assert.equal(flow.snapshot().order, undefined);
  assert.equal(journal.value().uncertain, true);
  await flow.submit(cart, recipient);
  pending.resolve(order);
  await first;
  assert.equal(flow.snapshot().phase, "success");
  assert.equal(journal.value(), undefined);
  await flow.submit(cart, recipient);
  assert.equal(posts, 1);
});
test("lost response can be replayed after reload with same key even when checkout cleared the cart", async () => {
  let currentCart = cart,
    gets = 0;
  const res = resource(async () => {
    gets++;
    return currentCart;
  });
  await res.load();
  const journal = store();
  const keys = [];
  const flow = new CheckoutFlow(
    res,
    async (body, key) => {
      keys.push(key);
      currentCart = empty;
      throw Error("Lost reply after commit");
    },
    () => "token",
    journal,
    () => "fixture-key-000001",
  );
  await flow.submit(cart, recipient);
  assert.equal(flow.snapshot().recoverable, true);
  assert.equal(flow.snapshot().order, undefined);
  await res.load();
  assert.equal(res.snapshot().cart.items.length, 0);
  const restored = new CheckoutFlow(
    res,
    async (body, key) => {
      keys.push(key);
      return order;
    },
    () => "token",
    journal,
    () => {
      throw Error("Must not make a new key");
    },
  );
  restored.restore(empty.id);
  const before = gets;
  await restored.submit(empty, recipient);
  assert.equal(gets, before);
  assert.equal(keys.length, 2);
  assert.equal(keys[0], keys[1]);
  assert.equal(restored.snapshot().order, order);
  assert.equal(journal.value(), undefined);
});
test("definitive stock/measurement errors refresh cart and preserve key; cancellation and timeout never claim success", async () => {
  let currentCart = cart;
  const res = resource(async () => currentCart);
  await res.load();
  const journal = store();
  const flow = new CheckoutFlow(
    res,
    async () => {
      currentCart = {
        ...cart,
        items: [
          {
            ...item,
            isAvailable: false,
            variant: { ...item.variant, stock: 0 },
          },
        ],
      };
      throw {
        status: 409,
        detail: "Requested quantity exceeds available stock (0)",
      };
    },
    () => "token",
    journal,
    () => "fixture-key-000001",
  );
  await flow.submit(cart, recipient);
  assert.equal(flow.snapshot().failure, "stock");
  assert.equal(flow.snapshot().recoverable, false);
  assert.equal(res.snapshot().cart.items[0].variant.stock, 0);
  assert.equal(journal.value().key, "fixture-key-000001");
  const timeoutResource = resource();
  await timeoutResource.load();
  const timeoutStore = store();
  const timed = new CheckoutFlow(
    timeoutResource,
    (body, key, token, signal) =>
      new Promise((resolve, reject) =>
        signal.addEventListener("abort", () => reject(Error("Timeout"))),
      ),
    () => "token",
    timeoutStore,
    () => "timeout-fixture-key-0001",
    5,
  );
  await timed.submit(cart, recipient);
  assert.equal(timed.snapshot().failure, "request");
  assert.equal(timed.snapshot().recoverable, true);
  const pending = deferred(),
    cancelResource = resource();
  await cancelResource.load();
  const cancelStore = store();
  const cancelled = new CheckoutFlow(
    cancelResource,
    () => pending.promise,
    () => "token",
    cancelStore,
    () => "cancel-fixture-key-0001",
  );
  const work = cancelled.submit(cart, recipient);
  await new Promise((resolve) => setTimeout(resolve, 0));
  cancelled.cancel();
  pending.resolve(order);
  await work;
  assert.equal(cancelled.snapshot().order, undefined);
  assert.equal(cancelStore.value().uncertain, true);
});
test("attempt journal stores only a random cart-scoped key, ignores other users' carts and malformed storage", () => {
  let value;
  const { checkoutAttemptStore } = load("lib/checkout.ts", {
    sessionStorage: {
      getItem: () => value,
      setItem: (key, next) => {
        value = next;
      },
      removeItem: () => {
        value = null;
      },
    },
  });
  checkoutAttemptStore.write({
    cartId: cart.id,
    key: "fixture-key-000001",
    uncertain: true,
  });
  assert.equal(checkoutAttemptStore.read("other-cart"), null);
  assert.equal(checkoutAttemptStore.read(cart.id).key, "fixture-key-000001");
  assert.ok(!value.includes(recipient.phone));
  assert.ok(!value.includes("token"));
  value = "garbage";
  assert.equal(checkoutAttemptStore.read(cart.id), null);
});
test("auth rejection of an uncertain replay does not discard recovery for an already created order", async () => {
  const res = resource(async () => empty);
  await res.load();
  const journal = store();
  journal.write({
    cartId: cart.id,
    key: "fixture-key-auth-replay-0001",
    uncertain: true,
  });
  let authorized = false;
  const usedKeys = [];
  const flow = new CheckoutFlow(
    res,
    async (body, key) => {
      usedKeys.push(key);
      if (!authorized) throw { status: 401 };
      return order;
    },
    () => "test-token",
    journal,
    () => {
      throw Error("Do not generate another attempt key");
    },
  );
  await flow.submit(empty, recipient);
  assert.equal(flow.snapshot().failure, "auth");
  assert.equal(flow.snapshot().recoverable, true);
  assert.equal(journal.value().uncertain, true);
  authorized = true;
  await flow.submit(empty, recipient);
  assert.equal(flow.snapshot().order, order);
  assert.equal(usedKeys[0], usedKeys[1]);
  assert.equal(journal.value(), undefined);
});

function render(
  locale,
  state,
  checkout = { phase: "idle", recoverable: false },
) {
  const i18n = load("lib/i18n.ts"),
    modules = new Map();
  function require(name) {
    if (name === "react") return React;
    if (name === "react/jsx-runtime") return jsxRuntime;
    if (name === "next/link")
      return {
        default: ({ href, children, ...props }) =>
          React.createElement("a", { href, ...props }, children),
      };
    if (name === "next/image")
      return {
        default: ({ src, alt }) => React.createElement("img", { src, alt }),
      };
    if (name.endsWith("PreferencesProvider"))
      return {
        usePreferences: () => ({
          t: (key, values) => i18n.translate(locale, key, values),
          localizedText: (values) => i18n.localizedText(locale, values),
        }),
      };
    if (name.endsWith("ui/Icon"))
      return { Icon: () => React.createElement("svg") };
    if (name.endsWith("ui/ShellActionBar"))
      return {
        ShellActionBar: ({ children }) =>
          React.createElement("aside", {}, children),
      };
    if (name.endsWith("lib/cart")) return cartLib;
    if (name.endsWith("lib/checkout")) return checkoutLib;
    if (name.endsWith("lib/product")) return product;
    if (name.endsWith("cart/CartView"))
      return { cartFailureKey: () => "cart.authHint" };
    return modules.get(name.split("/").at(-1));
  }
  for (const [key, file] of [
    ["foundation", "components/ui/foundation.tsx"],
    ["CartItemCard", "components/cart/CartItemCard.tsx"],
    ["CheckoutMeasurements", "components/checkout/CheckoutMeasurements.tsx"],
    ["CheckoutSummary", "components/checkout/CheckoutSummary.tsx"],
  ])
    modules.set(key, load(file, { require }));
  const { CheckoutView } = load("components/checkout/CheckoutView.tsx", {
    require,
  });
  return renderToStaticMarkup(
    React.createElement(CheckoutView, {
      state,
      checkout,
      cartResource: { load() {}, update() {} },
      flow: { submit() {} },
    }),
  );
}
for (const locale of ["ru", "uz"])
  test(`commerce-disabled ${locale} UI shows unavailable text, normal submit label and no recovery notice`, async () => {
    const res = resource();
    await res.load();
    const flow = new CheckoutFlow(
      res,
      async () => {
        throw { status: 503, code: "COMMERCE_DISABLED" };
      },
      () => "token",
      store(),
      () => "ui-disabled-key-0001",
    );
    await flow.submit(cart, recipient);
    const t = (key) => load("lib/i18n.ts").translate(locale, key);
    const html = render(locale, res.snapshot(), flow.snapshot());
    assert.ok(
      html.includes(
        locale === "ru"
          ? "Оформление заказов временно недоступно. Корзина сохранена — попробуйте позже."
          : "Buyurtmani rasmiylashtirish vaqtincha mavjud emas. Savatingiz saqlandi — keyinroq qayta urinib ko‘ring.",
      ),
    );
    assert.ok(!html.includes(t("checkout.recovery")));
    assert.ok(!html.includes(t("checkout.retryAttempt")));
    assert.ok(html.includes(t("cart.checkout")));
  });
test("Checkout renders bilingual real cart fields, required measurements, summary/remaining, empty/auth and recovery states", () => {
  for (const locale of ["ru", "uz"]) {
    const i18n = load("lib/i18n.ts"),
      t = (key) => i18n.translate(locale, key);
    const html = render(locale, { status: "success", refreshing: false, cart });
    assert.ok(
      html.includes(
        locale === "ru" ? item.product.nameRu : item.product.nameUz,
      ),
    );
    assert.ok(html.includes(`425 001 ${t("cart.currency")}`));
    assert.ok(html.includes(`425 000 ${t("cart.currency")}`));
    assert.ok(html.includes('name="phone"'));
    assert.ok(html.includes('min="100"'));
    assert.ok(html.includes('max="300"'));
    assert.ok(!html.includes("PRIVATE-SKU"));
    assert.ok(
      render(locale, {
        status: "success",
        refreshing: false,
        cart: empty,
      }).includes(t("cart.empty")),
    );
    assert.ok(
      render(locale, {
        status: "error",
        refreshing: false,
        failure: { kind: "auth" },
      }).includes(t("cart.authTitle")),
    );
    assert.ok(
      render(
        locale,
        { status: "success", refreshing: false, cart: empty },
        { phase: "idle", recoverable: true },
      ).includes(t("checkout.recovery")),
    );
    assert.ok(
      render(locale, {
        status: "success",
        refreshing: false,
        cart: { ...cart, items: [{ ...item, heightCm: null }] },
      }).includes(t("checkout.error.measurements")),
    );
  }
});

test("promo validation client is JWT/current-cart only and rejects malformed quote amounts", async () => {
  const quote = {
    valid: true,
    code: "STENZO10",
    cartVersion: checkoutLib.checkoutCartVersion(cart),
    subtotal: 250001,
    discountAmount: 25000,
    total: 225001,
  };
  let request;
  const api = client(async (url, init) => {
    request = { url, init };
    return { ok: true, json: async () => quote };
  });
  assert.equal(await api.validatePromoCode("STENZO10", "fixture-token"), quote);
  assert.equal(request.url, "/api/promo-codes/validate");
  assert.equal(
    request.init.headers.get("Authorization"),
    "Bearer fixture-token",
  );
  assert.deepEqual(JSON.parse(request.init.body), { code: "STENZO10" });
  assert.equal(request.init.cache, "no-store");
  await assert.rejects(api.validatePromoCode("STENZO10", ""));
  const invalid = client(async () => ({
    ok: true,
    json: async () => ({ ...quote, total: 1 }),
  }));
  await assert.rejects(invalid.validatePromoCode("STENZO10", "fixture-token"));
});
test("checkout sends code but never accepts client discount, total or percent", async () => {
  let payload;
  const api = client(async (url, init) => {
    payload = JSON.parse(init.body);
    return { ok: true, json: async () => ({ order }) };
  });
  await api.submitCheckout(
    {
      ...recipient,
      promoCode: "STENZO10",
      discountAmount: 900000,
      newTotal: 1,
      percent: 90,
    },
    "fixture-promo-key-0001",
    "fixture-token",
  );
  assert.deepEqual(payload, {
    ...JSON.parse(JSON.stringify(recipient)),
    promoCode: "STENZO10",
  });
});
test("uncertain checkout retry after remount retains original promo code and key; definite rejection permits removal", async () => {
  const res = resource();
  await res.load();
  const journal = store(),
    calls = [];
  const first = new CheckoutFlow(
    res,
    async (body, key) => {
      calls.push([body.promoCode, key]);
      throw Error("lost acknowledgement");
    },
    () => "token",
    journal,
    () => "promo-recovery-key-0001",
  );
  await first.submit(cart, { ...recipient, promoCode: "STENZO10" });
  assert.equal(journal.value().promoCode, "STENZO10");
  const second = new CheckoutFlow(
    res,
    async (body, key) => {
      calls.push([body.promoCode, key]);
      return order;
    },
    () => "token",
    journal,
    () => {
      throw Error("must reuse key");
    },
  );
  second.restore(cart.id);
  assert.equal(second.snapshot().promoCode, "STENZO10");
  await second.submit(cart, { ...recipient, promoCode: "DIFFERENT" });
  assert.deepEqual(calls[0], calls[1]);
  const rejectedJournal = store(),
    rejectedCalls = [];
  const rejected = new CheckoutFlow(
    res,
    async (body) => {
      rejectedCalls.push(body.promoCode);
      if (body.promoCode) throw { status: 409, detail: "PROMO_LIMIT" };
      return order;
    },
    () => "token",
    rejectedJournal,
    () => "promo-rejected-key-0001",
  );
  await rejected.submit(cart, { ...recipient, promoCode: "USED" });
  assert.equal(rejected.snapshot().failure, "promo");
  assert.equal(rejected.snapshot().recoverable, false);
  await rejected.submit(cart, recipient);
  assert.deepEqual(rejectedCalls, ["USED", undefined]);
});
function promoViewHarness(locale) {
  const state = [],
    refs = [];
  let cursor = 0,
    rc = 0;
  const i18n = load("lib/i18n.ts"),
    submitted = [],
    checks = [];
  let currentCart = cart,
    serverCart = cart,
    refreshGate,
    refreshes = 0,
    valid = true;
  const dependencies = {
    react: {
      useState: (initial) => {
        const i = cursor++;
        if (!(i in state))
          state[i] = initial === checkoutLib.emptyRecipient ? draft : initial;
        return [
          state[i],
          (v) => {
            state[i] = typeof v === "function" ? v(state[i]) : v;
          },
        ];
      },
      useRef: (initial) => {
        const i = rc++;
        return (refs[i] ??= { current: initial });
      },
      useEffect() {},
      useCallback: (f) => f,
      useId: () => "fixture",
    },
    "react/jsx-runtime": jsxRuntime,
    "next/link": { default: "a" },
    "../../lib/api-client": {
      validatePromoCode: async (code) => {
        checks.push(code);
        return valid
          ? {
              valid: true,
              code,
              cartVersion: checkoutLib.checkoutCartVersion(serverCart),
              subtotal: serverCart.subtotal,
              discountAmount: 25000,
              total: serverCart.subtotal - 25000,
            }
          : {
              valid: false,
              reason: "PROMO_LIMIT",
              cartVersion: checkoutLib.checkoutCartVersion(serverCart),
            };
      },
    },
    "../../lib/auth-storage": { readAccessToken: () => "fixture-token" },
    "../../lib/cart": cartLib,
    "../../lib/checkout": checkoutLib,
    "../cart/CartView": { cartFailureKey: () => "cart.authHint" },
    "../PreferencesProvider": {
      usePreferences: () => ({ t: (k, v) => i18n.translate(locale, k, v) }),
    },
    "../ui/foundation": { Button: "button", Card: "section", Page: "main" },
    "../ui/ShellActionBar": { ShellActionBar: "aside" },
    "../ui/Icon": { Icon: "svg" },
    "./CheckoutMeasurements": { CheckoutMeasurements: "measurements" },
    "./CheckoutSummary": { CheckoutSummary: "summary-fixture" },
  };
  const { CheckoutView } = load("components/checkout/CheckoutView.tsx", {
    require: (name) => {
      if (!(name in dependencies)) throw Error(name);
      return dependencies[name];
    },
  });
  const nodes = (n) =>
    n && typeof n === "object"
      ? [n, ...[n.props?.children].flat(Infinity).flatMap(nodes)]
      : [];
  return {
    checks,
    submitted,
    setValid: (v) => (valid = v),
    changeCart: () =>
      (serverCart = currentCart = { ...cart, subtotal: cart.subtotal + 1 }),
    changeServer: (next) => {
      serverCart = next;
    },
    holdRefresh: (promise) => {
      refreshGate = promise;
    },
    refreshCount: () => refreshes,
    render: () => {
      cursor = 0;
      rc = 0;
      return nodes(
        CheckoutView({
          state: { status: "success", cart: currentCart },
          cartResource: {
            load: async () => {
              refreshes++;
              await refreshGate;
              currentCart = serverCart;
              return true;
            },
          },
          checkout: { phase: "idle", recoverable: false },
          flow: { submit: (...args) => submitted.push(args) },
        }),
      );
    },
    t: (k) => i18n.translate(locale, k),
  };
}
for (const locale of ["ru", "uz"])
  test(`promo ${locale} UI requires apply, shows server quote, invalidates changed cart, and localizes rejection`, async () => {
    const f = promoViewHarness(locale);
    const input = (tree) =>
      tree.find((n) => n.type === "input" && n.props.id === "fixture-promo");
    const apply = (tree) =>
      tree.find(
        (n) => n.type === "button" && n.props.children === f.t("promo.apply"),
      );
    const submit = (tree) =>
      tree.find((n) => n.type === "button" && n.props.type === "submit");
    let tree = f.render();
    input(tree).props.onChange({ target: { value: "STENZO10" } });
    tree = f.render();
    assert.equal(submit(tree).props.disabled, true);
    apply(tree).props.onClick();
    await new Promise((resolve) => setTimeout(resolve, 0));
    tree = f.render();
    assert.equal(f.checks.length, 1);
    assert.equal(submit(tree).props.disabled, false);
    assert.equal(
      tree.find((n) => n.type === "summary-fixture").props.promo.discountAmount,
      25000,
    );
    tree.find((n) => n.type === "form").props.onSubmit({ preventDefault() {} });
    assert.equal(f.submitted[0][1].promoCode, "STENZO10");
    f.changeCart();
    tree = f.render();
    assert.equal(submit(tree).props.disabled, true);
    assert.equal(
      tree.find((n) => n.type === "summary-fixture").props.promo,
      undefined,
    );
    f.setValid(false);
    apply(tree).props.onClick();
    await new Promise((resolve) => setTimeout(resolve, 0));
    tree = f.render();
    assert.equal(submit(tree).props.disabled, true);
    assert.ok(tree.some((n) => n.props?.children === f.t("promo.PROMO_LIMIT")));
  });

test("checkout summary uses server quote for net total/rounded prepayment and retains product subtotal", () => {
  for (const locale of ["ru", "uz"]) {
    const i18n = load("lib/i18n.ts");
    const { CheckoutSummary } = load(
      "components/checkout/CheckoutSummary.tsx",
      {
        require: (name) =>
          ({
            "react/jsx-runtime": jsxRuntime,
            "../../lib/cart": cartLib,
            "../cart/CartItemCard": {
              CartPhoto: () => React.createElement("span"),
            },
            "../PreferencesProvider": {
              usePreferences: () => ({
                t: (k) => i18n.translate(locale, k),
                localizedText: (v) => v[locale],
              }),
            },
            "../ui/foundation": {
              Card: ({ children }) =>
                React.createElement("section", {}, children),
            },
          })[name],
      },
    );
    const html = renderToStaticMarkup(
      React.createElement(CheckoutSummary, {
        cart,
        promo: { code: "SAVED10", discountAmount: 85000, total: 765001 },
      }),
    );
    for (const amount of ["850 001", "85 000", "765 001", "382 501", "382 500"])
      assert.ok(html.includes(amount));
    assert.ok(html.includes("SAVED10"));
  }
});

for (const locale of ["ru", "uz"])
  for (const sameTotal of [false, true])
    test(`QA-001 ${locale}: cross-tab ${sameTotal ? "same-total composition" : "quantity"} change clears quote before cart refresh`, async () => {
      const f = promoViewHarness(locale);
      const input = (tree) =>
        tree.find((n) => n.type === "input" && n.props.id === "fixture-promo");
      const summary = (tree) =>
        tree.find((n) => n.type === "summary-fixture").props;
      const submit = (tree) =>
        tree.find((n) => n.type === "button" && n.props.type === "submit");
      const apply = (tree) =>
        tree.find(
          (n) => n.type === "button" && n.props.children === f.t("promo.apply"),
        );
      input(f.render()).props.onChange({ target: { value: "STENZO10" } });
      // Tab B changes only the server cart; tab A retains its old displayed lines.
      const next = sameTotal
        ? {
            ...cart,
            items: [
              {
                ...item,
                id: "replacement-line",
                product: { ...item.product, id: "replacement-product" },
                variant: { ...item.variant, id: "replacement-variant" },
              },
            ],
          }
        : {
            ...cart,
            subtotal: cart.subtotal * 2,
            items: [{ ...item, quantity: 2, lineTotal: item.lineTotal * 2 }],
          };
      f.changeServer(next);
      let release;
      f.holdRefresh(
        new Promise((resolve) => {
          release = resolve;
        }),
      );
      apply(f.render()).props.onClick();
      await new Promise((resolve) => setTimeout(resolve, 0));
      let tree = f.render();
      assert.equal(summary(tree).cart, cart);
      assert.equal(
        summary(tree).promo,
        undefined,
        "never show new quote beside old lines",
      );
      assert.equal(submit(tree).props.disabled, true);
      assert.equal(f.refreshCount(), 1);
      assert.ok(tree.some((n) => n.props?.children === f.t("promo.changed")));
      release();
      await new Promise((resolve) => setTimeout(resolve, 0));
      tree = f.render();
      assert.equal(summary(tree).cart, next);
      assert.equal(summary(tree).promo, undefined);
      assert.equal(input(tree).props.value, "STENZO10");
      tree
        .find((n) => n.type === "form")
        .props.onSubmit({ preventDefault() {} });
      assert.equal(f.submitted.length, 0, "stale quote cannot reach checkout");
      apply(tree).props.onClick();
      await new Promise((resolve) => setTimeout(resolve, 0));
      tree = f.render();
      assert.equal(
        summary(tree).promo.cartVersion,
        checkoutLib.checkoutCartVersion(next),
      );
      assert.equal(summary(tree).promo.subtotal, next.subtotal);
      assert.equal(submit(tree).props.disabled, false);
      assert.equal(f.refreshCount(), 1);
    });

test("promo client fails closed when snapshot identity is absent or malformed", async () => {
  for (const cartVersion of [undefined, null, 123, ""]) {
    const api = client(async () => ({
      ok: true,
      json: async () => ({
        valid: true,
        code: "STENZO10",
        subtotal: 100000,
        discountAmount: 10000,
        total: 90000,
        cartVersion,
      }),
    }));
    await assert.rejects(api.validatePromoCode("STENZO10", "fixture-token"));
  }
});

for (const sameTotal of [false, true])
  test(`QA-001 checkout preflight still rejects stale ${sameTotal ? "same-total composition" : "quantity"} before any Order POST`, async () => {
    let serverCart = cart;
    const res = resource(async () => serverCart);
    await res.load();
    const journal = store();
    let posts = 0;
    const flow = new CheckoutFlow(
      res,
      async () => {
        posts++;
        throw Error("stale checkout must not POST");
      },
      () => "fixture-token",
      journal,
      () => "fixture-attempt-000001",
    );
    serverCart = sameTotal
      ? {
          ...cart,
          items: [
            { ...item, variant: { ...item.variant, id: "other-variant" } },
          ],
        }
      : {
          ...cart,
          subtotal: cart.subtotal * 2,
          items: [{ ...item, quantity: 2, lineTotal: item.lineTotal * 2 }],
        };
    await flow.submit(cart, { ...recipient, promoCode: "STENZO10" });
    assert.equal(posts, 0);
    assert.equal(flow.snapshot().failure, "changed");
    assert.equal(flow.snapshot().order, undefined);
    assert.equal(res.snapshot().cart, serverCart);
    assert.equal(journal.value(), undefined);
  });
