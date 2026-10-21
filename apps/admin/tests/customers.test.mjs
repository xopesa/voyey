import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import { randomUUID } from "node:crypto";
import ts from "typescript";
import { URL, URLSearchParams } from "node:url";
import { setImmediate } from "node:timers";
const { AbortController } = globalThis;
const require = createRequire(import.meta.url);
const storage = new Map();
const window = {
  sessionStorage: {
    getItem: (k) => storage.get(k) ?? null,
    setItem: (k, v) => storage.set(k, v),
    removeItem: (k) => storage.delete(k),
  },
};
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
      exports,
      window,
      Intl,
      URLSearchParams,
      AbortController,
      Error,
      crypto: { randomUUID },
      require: (name) => {
        if (name in deps) return deps[name];
        if (name === "react/jsx-runtime") return require(name);
        if (name.endsWith(".css")) return {};
        throw Error(name);
      },
      ...globals,
    },
  );
  return exports;
}
const { messages } = load("../src/lib/i18n.ts");
const manual = load("../src/lib/manual-orders.ts");
const nodes = (n) =>
  n && typeof n === "object"
    ? [n, ...[n.props?.children].flat(Infinity).flatMap(nodes)]
    : [];
const recipient = {
  fullName: " Fixture ",
  phone: " +998900000000 ",
  city: " Fixture ",
  address: " Fixture ",
  apartment: " ",
  comment: null,
};
const line = {
  productId: "p",
  variantId: "v",
  quantity: 1,
  heightCm: 180,
  weightKg: 75,
};
const customer = {
  id: "a",
  telegramId: "101",
  firstName: "Fixture",
  lastName: null,
  username: "fixture_user",
  status: "ACTIVE",
  preferredLocale: "uz",
  registeredAt: "2026-10-20T00:00:00Z",
  latestRecipient: recipient,
};
const quote = {
  subtotal: 101,
  discountAmount: 10,
  total: 91,
  requiredPrepayment: 46,
  remainingAmount: 45,
  promoCodeSnapshot: "OPS10",
  items: [
    {
      productNameRu: "Брюки",
      productNameUz: "Shim",
      size: "M",
      color: null,
      quantity: 1,
      unitPrice: 101,
      lineTotal: 101,
    },
  ],
};
class ApiError extends Error {
  constructor(status, code) {
    super("fixture");
    this.status = status;
    this.code = code;
  }
}
function harness(file, component, locale = "ru", props = {}) {
  const state = [],
    refs = [],
    calls = [],
    redirects = [];
  let cursor = 0,
    refCursor = 0,
    handle = async () => ({});
  const deps = {
    react: {
      useState: (initial) => {
        const i = cursor++;
        if (!(i in state))
          state[i] = typeof initial === "function" ? initial() : initial;
        return [
          state[i],
          (v) => (state[i] = typeof v === "function" ? v(state[i]) : v),
        ];
      },
      useRef: (initial) =>
        refs[refCursor++] ?? (refs[refCursor - 1] = { current: initial }),
      useEffect() {},
      useCallback: (fn) => fn,
    },
    "../AdminFrame": { AdminFrame: "frame" },
    "../Preferences": {
      usePreferences: () => ({ locale, t: (k) => messages[locale][k] }),
    },
    "../../lib/api": {
      ApiError,
      errorKey: (e) => e.code ?? "error",
      api: async (path, init = {}) => {
        calls.push({ path, init });
        return handle(path, init);
      },
    },
    "../../lib/orders": {
      uzs: (n) => String(n),
      dateTime: (n) => n,
      orderStatusKey: (s) => s,
    },
    "../../lib/manual-orders": manual,
    "./Customers": { customerName: (c) => c.firstName },
  };
  const mod = load(file, deps, {
    window: { ...window, location: { assign: (p) => redirects.push(p) } },
  });
  const render = () => {
    cursor = 0;
    refCursor = 0;
    return nodes(mod[component]({ csrfToken: "fixture-csrf", ...props }));
  };
  return {
    state,
    calls,
    redirects,
    render,
    t: (k) => messages[locale][k],
    handle: (fn) => (handle = fn),
  };
}
const tick = () => new Promise((resolve) => setImmediate(resolve));
function prepared(locale = "ru") {
  const f = harness(
    "../src/components/customers/ManualOrder.tsx",
    "ManualOrder",
    locale,
    { customerId: "a" },
  );
  f.render();
  Object.assign(f.state, {
    2: "a",
    3: customer,
    4: recipient,
    5: [line],
    6: "OPS10",
  });
  const body = manual.manualPayload("a", recipient, [line], "OPS10");
  f.state[17] = { key: JSON.stringify(body), value: quote };
  return f;
}
const button = (f, key) =>
  f.render().find((n) => n.type === "button" && n.props.children === f.t(key));

test("manual payload excludes authoritative prices, trims recipient and validates measurements/duplicate variants", () => {
  const body = manual.manualPayload(
    "a",
    recipient,
    [{ ...line, price: 1, sku: "spoof", lineTotal: 1 }],
    " ops10 ",
  );
  assert.deepEqual(JSON.parse(JSON.stringify(body.items)), [line]);
  assert.equal(body.recipient.fullName, "Fixture");
  assert.equal(body.recipient.apartment, null);
  assert.equal(body.promoCode, "OPS10");
  for (const items of [
    [],
    [line, line],
    [{ ...line, heightCm: 99 }],
    [{ ...line, weightKg: 301 }],
    [{ ...line, quantity: 1.1 }],
  ])
    assert.throws(() => manual.manualPayload("a", recipient, items, ""));
});
test("manual journal stores only idempotency state and survives reload without PII", () => {
  storage.clear();
  manual.storeManualAttempt("a", "isolated-order-key-0001", true);
  assert.equal(JSON.stringify([...storage]).includes(recipient.phone), false);
  assert.deepEqual(
    JSON.parse(
      JSON.stringify(
        load("../src/lib/manual-orders.ts").readManualAttempt("a"),
      ),
    ),
    { key: "isolated-order-key-0001", uncertain: true },
  );
  storage.set("stenzo.manual-attempt:a", "malformed");
  assert.equal(manual.readManualAttempt("a"), null);
  manual.clearManualAttempt("a");
  assert.equal(storage.size, 0);
});
for (const locale of ["ru", "uz"])
  test(`manual ${locale}: server quote required, CSRF, one click pair creates once, clears journal and redirects`, async () => {
    storage.clear();
    const f = prepared(locale);
    f.handle(async () => ({ order: { publicId: "STZ-ISOLATED" } }));
    const create = button(f, "manualCreate");
    assert.ok(create);
    create.props.onClick();
    create.props.onClick();
    await tick();
    assert.equal(f.calls.length, 1);
    assert.equal(f.calls[0].path, "orders/manual");
    assert.equal(f.calls[0].init.headers["x-csrf-token"], "fixture-csrf");
    assert.ok(f.calls[0].init.headers["idempotency-key"]);
    assert.deepEqual(f.redirects, ["/admin/orders/STZ-ISOLATED"]);
    assert.equal(storage.size, 0);
    button(f, "manualCreate").props.onClick();
    await tick();
    assert.equal(f.calls.length, 1);
    f.state[6] = "OTHER";
    assert.equal(button(f, "manualCreate"), undefined);
  });
test("uncertain manual response retains the same key across retry and browser reload", async () => {
  storage.clear();
  let f = prepared();
  f.handle(async () => {
    throw Error("isolated network failure");
  });
  button(f, "manualCreate").props.onClick();
  await tick();
  const key = f.calls[0].init.headers["idempotency-key"];
  assert.equal(f.redirects.length, 0);
  assert.equal(manual.readManualAttempt("a").key, key);
  f = prepared();
  f.handle(async () => ({ order: { publicId: "STZ-RECOVERED" } }));
  button(f, "manualCreate").props.onClick();
  await tick();
  assert.equal(f.calls[0].init.headers["idempotency-key"], key);
  assert.equal(storage.size, 0);
});
test("blocked customer cannot create; changed form invalidates the previous quote", async () => {
  const f = prepared();
  f.state[3] = { ...customer, status: "BLOCKED" };
  button(f, "manualCreate").props.onClick();
  await tick();
  assert.equal(f.calls.length, 0);
  f.state[3] = customer;
  f.state[5] = [{ ...line, quantity: 2 }];
  assert.equal(button(f, "manualCreate"), undefined);
});
for (const locale of ["ru", "uz"])
  test(`notes ${locale}: append-only escaped text, CSRF and synchronous duplicate-click lock`, async () => {
    const f = harness(
      "../src/components/customers/CustomerNotes.tsx",
      "CustomerNotes",
      locale,
      { customerId: "a" },
    );
    f.render();
    f.state[0] = " <script>fixture</script> ";
    f.state[4] = false;
    f.handle(async (path, init) =>
      init.method
        ? {}
        : {
            notes: [
              {
                id: "n",
                body: "<script>fixture</script>",
                createdAt: "2026-10-20",
                createdBy: "web-admin",
              },
            ],
            nextCursor: null,
          },
    );
    const form = f.render().find((n) => n.type === "form");
    form.props.onSubmit({ preventDefault() {} });
    form.props.onSubmit({ preventDefault() {} });
    await tick();
    const post = f.calls.filter((c) => c.init.method === "POST");
    assert.equal(post.length, 1);
    assert.equal(post[0].init.headers["x-csrf-token"], "fixture-csrf");
    assert.deepEqual(JSON.parse(post[0].init.body), {
      body: "<script>fixture</script>",
    });
    const tree = f.render();
    assert.ok(
      tree.some(
        (n) =>
          n.type === "p" && n.props.children === "<script>fixture</script>",
      ),
    );
    assert.equal(
      tree.some((n) => n.props.dangerouslySetInnerHTML),
      false,
    );
    assert.equal(
      tree.some(
        (n) =>
          n.type === "button" &&
          /delete|удал|o‘chir/i.test(String(n.props.children)),
      ),
      false,
    );
  });
test("customer Telegram links accept usernames only, never arbitrary URLs", () => {
  const f = load("../src/components/customers/Customers.tsx", {
    react: {},
    "../AdminFrame": {},
    "../Preferences": {},
    "../../lib/api": {},
    "../../lib/orders": {},
  });
  assert.equal(
    f.telegramCustomerUrl("fixture_user"),
    "https://t.me/fixture_user",
  );
  for (const s of [
    null,
    "https://evil.invalid",
    "../admin",
    "@fixture",
    "a/b",
    "<script>",
  ])
    assert.equal(f.telegramCustomerUrl(s), null);
});
