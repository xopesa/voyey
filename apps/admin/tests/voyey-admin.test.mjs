import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";

const require = createRequire(import.meta.url);
const base = fileURLToPath(new URL("../src/voyey/", import.meta.url));
const assets = Object.fromEntries(
  ["logo", "symbol", "notebook", "markers", "hoodie", "care"].map((k) => [
    k,
    `/demo-${k}.png`,
  ]),
);
function loader(overrides = {}, globals = {}) {
  const cache = new Map();
  return function load(path) {
    const file = resolve(base, path);
    if (cache.has(file)) return cache.get(file);
    const exports = {};
    cache.set(file, exports);
    runInNewContext(
      ts.transpileModule(readFileSync(file, "utf8"), {
        compilerOptions: {
          module: ts.ModuleKind.CommonJS,
          target: ts.ScriptTarget.ES2022,
          jsx: ts.JsxEmit.ReactJSX,
        },
      }).outputText,
      {
        exports,
        URLSearchParams,
        structuredClone,
        setTimeout,
        clearTimeout,
        ...globals,
        require: (name) => {
          if (Object.hasOwn(overrides, name)) return overrides[name];
          if (name.endsWith("?url")) return { default: "/demo-proof.svg" };
          if (name.endsWith("/assets")) return { assets };
          if (name.endsWith(".css")) return {};
          if (name.startsWith(".")) {
            const nested = resolve(dirname(file), name);
            return load(nested + (existsSync(nested + ".ts") ? ".ts" : ".tsx"));
          }
          return require(name);
        },
      },
    );
    return exports;
  };
}
const load = loader(),
  model = load("model.ts"),
  i18n = load("messages.ts"),
  ui = load("components.tsx"),
  screens = load("screens.tsx");
const normalized = (value) => JSON.parse(JSON.stringify(value));
function elements(root, predicate) {
  if (root === null || root === undefined || typeof root !== "object")
    return [];
  if (Array.isArray(root)) return root.flatMap((v) => elements(v, predicate));
  return [
    ...(predicate(root) ? [root] : []),
    ...elements(root.props?.children, predicate),
  ];
}

test("isolated routes allow all thirteen sections and reject unknown/external destinations", () => {
  assert.equal(model.sections.length, 13);
  for (const s of model.sections) {
    assert.equal(model.readRoute(`?screen=${s}`), s);
    assert.equal(
      model.routeHref(s),
      `/admin/voyey-admin-demo.html?screen=${s}`,
    );
  }
  for (const search of [
    "",
    "?screen=/admin/orders",
    "?screen=https://example.com",
    "?screen=finance",
    "?role=owner",
  ])
    assert.equal(model.readRoute(search), "login");
});
test("RU/UZ dictionary is complete and UZS/date use explicit local formatting", () => {
  for (const [key, pair] of Object.entries(i18n.copy)) {
    assert.equal(pair.length, 2, key);
    assert.ok(
      pair.every((v) => typeof v === "string" && v.length),
      key,
    );
    assert.equal(i18n.translate("ru", key), pair[0]);
    assert.equal(i18n.translate("uz", key), pair[1]);
  }
  assert.match(i18n.money(80100, "ru"), /80\D100/);
  assert.match(i18n.money(80100, "uz"), /80\D100/);
  assert.match(i18n.dateTime("2026-10-24T07:40:00Z", "ru"), /12:40/);
});
test("order statuses match existing Prisma vocabulary, no new Backend state is invented", () => {
  const schema = readFileSync(
    new URL("../../../packages/database/prisma/schema.prisma", import.meta.url),
    "utf8",
  );
  const statuses = schema
    .match(/enum OrderStatus\s*\{([^}]+)}/)[1]
    .trim()
    .split(/\s+/);
  for (const order of model.orders)
    assert.ok(statuses.includes(order.status), order.status);
  for (const claim of model.initialClaims)
    assert.ok(["SUBMITTED", "APPROVED", "REJECTED"].includes(claim.status));
});
test("order filters keep fully paid distinct from partially paid and unknown CARGO", () => {
  const ids = (f) =>
    Array.from(model.filterOrders(model.orders, f), (o) => o.id);
  assert.deepEqual(ids("paid"), ["DEMO-1046"]);
  assert.deepEqual(ids("onReview"), ["DEMO-1048", "DEMO-1045"]);
  assert.deepEqual(ids("cancelled"), ["DEMO-1043"]);
  assert.deepEqual(ids("waitPay"), ["DEMO-1044"]);
  assert.equal(
    model.filterOrders(
      [
        {
          ...model.orders[3],
          status: "AWAITING_FINAL_PAYMENT",
          payment: "APPROVED",
        },
      ],
      "waitPay",
    ).length,
    1,
  );
  assert.equal(model.filterOrders(model.orders, "all", "1047").length, 1);
  assert.equal(
    model.filterOrders(model.orders, "all", "not present").length,
    0,
  );
  for (const [f, mode] of [
    ["inStock", "IN_STOCK"],
    ["preorder", "PREORDER"],
  ])
    assert.ok(
      model.filterOrders(model.orders, f).every((o) => o.mode === mode),
    );
});
test("order fixture snapshots and 50/100 money are consistent and independent of catalogue editing", () => {
  const originalOrders = JSON.stringify(model.orders);
  const draft = structuredClone(model.initialProducts[0]);
  draft.name.ru = "Changed demo name";
  draft.attributes[0].value = "Changed";
  draft.category = "care";
  draft.price = 999;
  const result = model.saveProduct(model.initialProducts, draft);
  assert.equal(result[0].price, 999);
  assert.equal(JSON.stringify(model.orders), originalOrders);
  assert.notEqual(result[0].name.ru, model.initialProducts[0].name.ru);
  for (const o of model.orders) {
    assert.equal(o.goodsTotal, o.subtotal - o.discount);
    assert.equal(o.first, Math.ceil((o.goodsTotal * o.percent) / 100));
    if (o.mode === "IN_STOCK") assert.equal(o.percent, 100);
  }
  assert.equal(model.orders.find((o) => o.id === "DEMO-1047").cargo, null);
  assert.equal(model.orders.find((o) => o.id === "DEMO-1045").cargo, 17000);
});
test("product search works for both languages, SKU and category; sorting does not mutate fixtures", () => {
  const before = JSON.stringify(model.initialProducts);
  for (const query of ["Планер", "rejalashtirgich", "demo-a5-pink"])
    assert.equal(
      model.filterProducts(
        model.initialProducts,
        query,
        "all",
        "nameSort",
        "ru",
      )[0].id,
      "demo-p1",
    );
  assert.equal(
    model.filterProducts(
      model.initialProducts,
      "",
      "stationery",
      "stockSort",
      "uz",
    ).length,
    2,
  );
  const sorted = model.filterProducts(
    model.initialProducts,
    "",
    "all",
    "priceSort",
    "ru",
  );
  assert.deepEqual(
    Array.from(sorted, (p) => p.price),
    [48000, 72000, 89000, 299000],
  );
  assert.equal(JSON.stringify(model.initialProducts), before);
});
test("local product editor validates money, stock, names and unique SKU without writing inputs", () => {
  const before = JSON.stringify(model.initialProducts);
  for (const patch of [
    { price: 0 },
    { price: 1.5 },
    { stock: -1 },
    { stock: NaN },
    { name: { ru: "", uz: "test" } },
    { sku: "bad sku" },
    { sku: model.initialProducts[1].sku },
  ]) {
    assert.throws(
      () =>
        model.saveProduct(model.initialProducts, {
          ...structuredClone(model.initialProducts[0]),
          ...patch,
        }),
      /invalidProduct/,
    );
  }
  const created = model.saveProduct(model.initialProducts, {
    ...structuredClone(model.initialProducts[0]),
    id: "demo-new",
    sku: "DEMO-NEW",
  });
  assert.equal(created.length, 5);
  assert.equal(JSON.stringify(model.initialProducts), before);
  assert.ok(!Object.hasOwn(created[0], "skuPrice"));
});
test("demo review is single decision, immutable and cannot change orders or ledger money", () => {
  const before = JSON.stringify(model.initialClaims),
    orderBefore = JSON.stringify(model.orders);
  const once = model.reviewDemoClaim(
    model.initialClaims,
    "demo-claim-1",
    "APPROVED",
  );
  assert.equal(once[0].status, "APPROVED");
  assert.deepEqual(normalized(once[0].history), ["APPROVED"]);
  const replay = model.reviewDemoClaim(once, "demo-claim-1", "REJECTED");
  assert.deepEqual(normalized(replay), normalized(once));
  assert.equal(JSON.stringify(model.initialClaims), before);
  assert.equal(JSON.stringify(model.orders), orderBefore);
});
test("login form rejects blanks and never has a successful login branch or credential network call", () => {
  const state = [],
    updates = [],
    timers = [];
  let index = 0,
    demoOpened = 0;
  const component = loader(
    {
      react: {
        ...React,
        useState: (initial) => {
          const at = index++;
          if (!(at in state))
            state[at] = typeof initial === "function" ? initial() : initial;
          return [
            state[at],
            (value) => {
              state[at] =
                typeof value === "function" ? value(state[at]) : value;
              updates.push(at);
            },
          ];
        },
        useRef: () => ({ current: null }),
        useEffect() {},
      },
    },
    {
      setTimeout: (fn) => {
        timers.push(fn);
        return 1;
      },
      fetch: () => {
        throw new Error("Network is forbidden");
      },
      localStorage: {
        setItem() {
          throw new Error("Credential storage forbidden");
        },
      },
    },
  )("components.tsx");
  function render() {
    index = 0;
    return component.VoyeyAdminLogin({
      locale: "ru",
      setLocale() {},
      openDemo() {
        demoOpened++;
      },
    });
  }
  let tree = render();
  elements(tree, (e) => e.type === "form")[0].props.onSubmit({
    preventDefault() {},
  });
  assert.equal(state[4], "emptyLogin");
  tree = render();
  elements(tree, (e) => e.props?.name === "username")[0].props.onChange({
    target: { value: "synthetic-user" },
  });
  elements(tree, (e) => e.props?.name === "password")[0].props.onChange({
    target: { value: "synthetic-input-not-a-secret" },
  });
  tree = render();
  elements(tree, (e) => e.type === "form")[0].props.onSubmit({
    preventDefault() {},
  });
  assert.equal(state[1], "");
  assert.equal(state[3], true);
  assert.equal(demoOpened, 0);
  timers[0]();
  assert.equal(state[3], false);
  assert.equal(state[4], "authUnavailable");
  tree = render();
  elements(
    tree,
    (e) => e.props?.children === i18n.translate("ru", "demoOpen"),
  )[0].props.onClick();
  assert.equal(demoOpened, 1);
  assert.ok(updates.length > 0);
});

for (const locale of ["ru", "uz"]) {
  test(`actual React SSR login in ${locale} has labelled inputs, no preset credentials`, () => {
    const html = renderToStaticMarkup(
      React.createElement(ui.VoyeyAdminLogin, {
        locale,
        setLocale() {},
        openDemo() {},
      }),
    );
    assert.match(html, /type="password"/);
    assert.match(html, /type="submit"/);
    assert.ok(html.includes(i18n.translate(locale, "loginTitle")));
    assert.ok(html.includes(i18n.translate(locale, "demoOpen")));
    assert.ok(html.includes(i18n.translate(locale, "loginNotice")));
    assert.ok(!/admin\/admin|STENZO|passwordProof|csrfToken/.test(html));
  });
  for (const section of model.sections)
    test(`actual React SSR ${section}/${locale} is an isolated demo screen`, () => {
      const shell = loader(
        {},
        { localStorage: { getItem: () => locale } },
      )("App.tsx").VoyeyAdminShell;
      const html = renderToStaticMarkup(
        React.createElement(shell, { initialScreen: section }),
      );
      assert.ok(html.includes(i18n.translate(locale, section)), section);
      assert.ok(html.includes(i18n.translate(locale, "demoWarning")));
      assert.equal((html.match(/aria-current="page"/g) ?? []).length, 1);
      assert.ok(
        !/STENZO|api\/admin|accessToken|voyey_admin_session/.test(html),
      );
      if (
        !["dashboard", "orders", "products", "payments", "promos"].includes(
          section,
        )
      )
        assert.ok(html.includes(i18n.translate(locale, "inDevelopment")));
    });
  test(`order detail ${locale} preserves unknown CARGO and outstanding goods`, () => {
    const html = renderToStaticMarkup(
      React.createElement(screens.OrderDetails, {
        locale,
        order: model.orders[1],
        onClose() {},
      }),
    );
    assert.ok(html.includes(i18n.translate(locale, "cargoUnknown")));
    assert.ok(html.includes(i18n.money(30600, locale)));
    assert.ok(html.includes("50%"));
    assert.ok(!html.includes(model.initialProducts[2].sku));
  });
}
test("table exposes empty, loading and error states; long names are rendered intact", () => {
  for (const [state, key] of [
    ["loading", "loading"],
    ["error", "loadError"],
    ["ready", "empty"],
  ]) {
    const html = renderToStaticMarkup(
      React.createElement(ui.VoyeyAdminTable, {
        locale: "ru",
        headers: [],
        count: 0,
        state,
        retry() {},
      }),
    );
    assert.ok(html.includes(i18n.translate("ru", key)));
  }
  const longName = "Очень длинное демонстрационное название ".repeat(8);
  const html = renderToStaticMarkup(
    React.createElement(screens.OrderDetails, {
      locale: "ru",
      order: {
        ...model.orders[0],
        item: { ...model.orders[0].item, name: { ru: longName, uz: longName } },
      },
      onClose() {},
    }),
  );
  assert.ok(html.includes(longName));
});
test("reduced motion removes shared navigation movement and modal slide", () => {
  const reduced = loader({
    react: {
      ...React,
      useRef: () => ({ current: null }),
      useId: () => "test-dialog",
      useEffect() {},
    },
    "motion/react": {
      ...require("motion/react"),
      useReducedMotion: () => true,
    },
  })("components.tsx");
  const tree = reduced.VoyeyAdminModal({
    title: "DEMO",
    locale: "ru",
    drawer: true,
    side: "left",
    onClose() {},
    children: "DEMO",
  });
  assert.deepEqual(normalized(tree.props.children.props.initial), {
    opacity: 0,
  });
  const sidebar = reduced.VoyeyAdminSidebar({
    locale: "ru",
    section: "orders",
    collapsed: false,
    navigate() {},
    toggle() {},
    exit() {},
  });
  const indicator = elements(
    sidebar,
    (e) => e.props?.className === "va-active-indicator",
  )[0];
  assert.equal(indicator.props.layoutId, undefined);
  assert.equal(ui.transition(true).duration, 0.08);
  assert.equal(ui.transition(false).duration, 0.22);
});
test("native modal lifecycle locks scroll, closes and restores prior focus on cleanup", () => {
  const calls = [],
    effects = [];
  const node = {
    showModal: () => calls.push("showModal"),
    close: () => calls.push("close"),
  };
  const component = loader(
    {
      react: {
        ...React,
        useRef: () => ({ current: node }),
        useId: () => "test-native-dialog",
        useEffect: (effect) => effects.push(effect),
      },
      "motion/react": {
        ...require("motion/react"),
        useReducedMotion: () => false,
      },
    },
    {
      document: {
        activeElement: { focus: () => calls.push("focus") },
        body: { style: { overflow: "auto" } },
      },
    },
  )("components.tsx");
  component.VoyeyAdminModal({
    title: "DEMO",
    locale: "ru",
    onClose() {},
    children: "DEMO",
  });
  const cleanup = effects[0]();
  cleanup();
  assert.deepEqual(calls, ["showModal", "close", "focus"]);
});
test("prototype import graph contains no API/auth/financial writer, network client or credential persistence", () => {
  const files = readdirSync(base).filter((f) => /\.tsx?$/.test(f));
  for (const name of files) {
    const source = readFileSync(resolve(base, name), "utf8");
    assert.ok(
      !/\bfetch\s*\(|XMLHttpRequest|sendBeacon|WebSocket\s*\(|axios|passwordProof|csrfToken|accessToken|document\.cookie|sessionStorage|console\./.test(
        source,
      ),
      name,
    );
    const imports = [
      ...source.matchAll(/(?:from\s+|import\s*\(|import\s+)["']([^"']+)["']/g),
    ].map((m) => m[1]);
    assert.ok(
      imports.every(
        (i) =>
          i.startsWith("./") ||
          [
            "react",
            "react-dom/client",
            "motion/react",
            "../../../miniapp/src/voyey/assets",
            "../../../miniapp/src/lib/i18n",
          ].includes(i),
      ),
      `${name}: ${imports.join(",")}`,
    );
  }
  const app = readFileSync(resolve(base, "App.tsx"), "utf8");
  assert.match(app, /voyey\.admin\.demo\.locale/);
  assert.equal((app.match(/localStorage\.setItem\(/g) ?? []).length, 1);
  assert.match(app, /localStorage\.setItem\(localeKey, locale\)/);
});
test("DEV entry blocks production/non-loopback hosts, and default production input is unchanged", () => {
  const entry = readFileSync(resolve(base, "entry.tsx"), "utf8");
  assert.match(entry, /import\.meta\.env\.DEV/);
  assert.match(entry, /127\.0\.0\.1/);
  assert.match(entry, /\[::1\]/);
  assert.ok(!entry.includes("api/admin"));
  const html = readFileSync(
    new URL("../voyey-admin-demo.html", import.meta.url),
    "utf8",
  );
  assert.match(html, /form-action 'none'/);
  assert.ok(!html.includes("telegram.org"));
  const vite = readFileSync(
    new URL("../vite.config.ts", import.meta.url),
    "utf8",
  );
  assert.ok(!vite.includes("voyey-admin"));
});
