import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { URL, URLSearchParams } from "node:url";
import { setImmediate } from "node:timers";
import ts from "typescript";
import { runInNewContext } from "node:vm";

const require = createRequire(import.meta.url);
function load(file, dependencies = {}, globals = {}) {
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
      URLSearchParams,
      AbortController: globalThis.AbortController,
      ...globals,
      require: (name) => {
        if (name in dependencies) return dependencies[name];
        if (name.endsWith(".css")) return {};
        if (name === "react/jsx-runtime") return require(name);
        throw new Error("Unexpected dependency " + name);
      },
    },
  );
  return exports;
}
function nodes(node) {
  if (!node || typeof node !== "object") return [];
  return [node, ...[node.props?.children].flat(Infinity).flatMap(nodes)];
}
const { messages, dashboardCopy } = load("../src/lib/i18n.ts");
const lib = load("../src/lib/dashboard.ts");
const orders = load("../src/lib/orders.ts", { "./api": {} });
const data = {
  period: { from: "2026-10-13", to: "2026-10-19", timezone: "Asia/Tashkent" },
  kpis: {
    orders: 2,
    receivedPayments: 1100,
    awaitingReview: 1,
    inProgress: 1,
    activeProducts: 3,
    lowStockVariants: 4,
  },
  chart: Array.from({ length: 7 }, (_, i) => ({
    date: `2026-10-${i + 13}`,
    orders: i === 6 ? 2 : 0,
    receivedPayments: i === 6 ? 1100 : 0,
  })),
  latestOrders: [
    {
      publicId: "STZ-FIXTURE",
      customer: "Fixture",
      total: 1000,
      paid: 1100,
      status: "FINAL_PAYMENT_SUBMITTED",
      createdAt: "2026-10-18T19:00:00Z",
    },
  ],
  products: {
    total: 5,
    active: 3,
    draft: 1,
    inactive: 1,
    lowStockVariants: 3,
    outOfStockVariants: 1,
    lowStockThreshold: 3,
  },
};
const frame = () => null,
  chartComponent = () => null;
class FixtureApiError extends Error {
  constructor(status) {
    super();
    this.status = status;
  }
}
function dashboardHarness(locale, initial = data, options = {}) {
  const state = [
    { range: "7d", from: "", to: "" },
    "dashboard?range=7d",
    initial,
    false,
    null,
    0,
  ];
  const calls = [];
  let cursor = 0,
    effect;
  const { Dashboard } = load("../src/components/dashboard/Dashboard.tsx", {
    react: {
      useEffect: (callback) => {
        effect = callback;
      },
      useState: () => {
        const i = cursor++;
        return [
          state[i],
          (value) => {
            state[i] = typeof value === "function" ? value(state[i]) : value;
          },
        ];
      },
    },
    "../AdminFrame": { AdminFrame: frame },
    "../Preferences": {
      usePreferences: () => ({ locale, t: (key) => messages[locale][key] }),
    },
    "../../lib/api": {
      ApiError: FixtureApiError,
      api: async (...args) => {
        calls.push(args);
        if (options.error) throw new FixtureApiError(options.error);
        return data;
      },
    },
    "../../lib/dashboard": lib,
    "../../lib/orders": orders,
    "../../lib/i18n": { dashboardCopy },
    "./DashboardChart": { DashboardChart: chartComponent },
  });
  return {
    state,
    calls,
    effect: () => effect(),
    render: () => {
      cursor = 0;
      return Dashboard({ csrfToken: "fixture" });
    },
  };
}
test("chart geometry is stable with zero, one day and 366 days; no NaN/Infinity; integral ticks", () => {
  for (const chart of [
    [],
    [{ date: "2026-10-19", orders: 0, receivedPayments: 0 }],
    data.chart,
    Array.from({ length: 366 }, (_, i) => ({
      date: String(i),
      orders: i,
      receivedPayments: i * 290000,
    })),
  ])
    for (const metric of ["orders", "receivedPayments"])
      for (const width of [240, 360, 1000]) {
        const g = lib.chartGeometry(chart, metric, width);
        assert.doesNotMatch(g.path, /NaN|Infinity/);
        assert.ok(Number.isInteger(g.ceiling / 4));
        assert.ok(
          g.points.every(
            (p) =>
              p.x >= g.left &&
              p.x <= g.right &&
              p.y >= g.top &&
              p.y <= g.bottom,
          ),
        );
      }
});
test("query generation and dates do not depend on browser timezone", () => {
  assert.equal(
    lib.dashboardQuery("7d", "ignored", "ignored"),
    "dashboard?range=7d",
  );
  assert.equal(
    lib.dashboardQuery("custom", "2026-10-01", "2026-10-19"),
    "dashboard?range=custom&from=2026-10-01&to=2026-10-19",
  );
  assert.match(
    lib.dashboardDate("2026-10-18T19:00:00Z", "ru", true),
    /19\.10\.2026/,
  );
  assert.match(lib.dashboardDate("2026-10-19", "ru"), /19\.10\.2026/);
});
for (const locale of ["ru", "uz"])
  test(`${locale} preference: Dashboard remains Russian with 6 unchanged KPIs, chart, order links, summary and quick actions`, () => {
    const h = dashboardHarness(locale),
      tree = h.render(),
      all = nodes(tree);
    assert.equal(tree.type, frame);
    assert.equal(
      all.filter((n) => n.props?.className === "dashboard-panel dashboard-kpi")
        .length,
      6,
    );
    assert.equal(all.filter((n) => n.type === chartComponent).length, 1);
    assert.ok(
      all.some(
        (n) =>
          n.type === "span" &&
          n.props.children === messages.ru.orderFINAL_PAYMENT_SUBMITTED,
      ),
    );
    const links = all.filter((n) => n.type === "a").map((n) => n.props.href);
    for (const href of [
      "/admin/orders/STZ-FIXTURE",
      "/admin/products/new",
      "/admin/categories",
      "/admin/orders",
      "/admin/telegram",
    ])
      assert.ok(links.includes(href));
    assert.equal(h.calls.length, 0);
    assert.equal(tree.props.dashboard, true);
    for (const [key, text] of Object.entries(messages.ru).filter(([key]) =>
      key.startsWith("dashboard"),
    )) {
      assert.ok(text.trim(), key);
      assert.doesNotMatch(
        text,
        /\b(?:Dashboard|Revenue|Orders|Products|profit|daromad)\b/i,
      );
    }
  });
test("loading uses six skeleton cards without fake numbers; empty data shows zeros and no-orders state", () => {
  const h = dashboardHarness("ru", null);
  h.state[3] = true;
  let all = nodes(h.render());
  assert.equal(
    all.filter(
      (n) => n.props?.className === "dashboard-panel dashboard-skeleton",
    ).length,
    6,
  );
  assert.ok(!all.some((n) => n.props?.className === "dashboard-number"));
  h.state[3] = false;
  h.state[2] = {
    ...data,
    latestOrders: [],
    kpis: Object.fromEntries(Object.keys(data.kpis).map((key) => [key, 0])),
  };
  all = nodes(h.render());
  assert.ok(
    all.some(
      (n) =>
        n.props?.className === "dashboard-empty" &&
        n.props.children === messages.ru.noOrders,
    ),
  );
});
test("error keeps Admin shell and retry action; custom dates submitted to the read-only query", () => {
  const h = dashboardHarness("uz", null);
  h.state[4] = "dashboardError";
  let tree = h.render();
  assert.equal(tree.type, frame);
  const retry = nodes(tree).find(
    (n) => n.type === "button" && n.props.children === messages.ru.retry,
  );
  retry.props.onClick();
  assert.equal(h.state[5], 1);
  h.state[0] = { range: "custom", from: "2026-10-01", to: "2026-10-19" };
  tree = h.render();
  nodes(tree)
    .find((n) => n.type === "form")
    .props.onSubmit({ preventDefault() {} });
  assert.equal(
    h.state[1],
    "dashboard?range=custom&from=2026-10-01&to=2026-10-19",
  );
});
test("effect fetches only GET with abort signal and no mutations", async () => {
  const h = dashboardHarness("ru", null);
  h.render();
  const cleanup = h.effect();
  await new Promise(setImmediate);
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0][0], "dashboard?range=7d");
  assert.equal(h.calls[0][1].method, undefined);
  assert.equal(h.state[2], data);
  assert.equal(h.state[3], false);
  cleanup();
  assert.equal(h.calls[0][1].signal.aborted, true);
});
test("today/7d/30d filters keep the original GET query contract", () => {
  const h = dashboardHarness("uz");
  for (const range of ["today", "7d", "30d"]) {
    nodes(h.render())
      .find((n) => n.type === "select")
      .props.onChange({ target: { value: range } });
    nodes(h.render())
      .find((n) => n.type === "form")
      .props.onSubmit({ preventDefault() {} });
    assert.equal(h.state[1], `dashboard?range=${range}`);
  }
  assert.equal(h.calls.length, 0);
});
for (const status of [400, 500])
  test(`API ${status} yields localized error without shell crash`, async () => {
    const h = dashboardHarness("ru", null, { error: status });
    h.render();
    h.effect();
    await new Promise(setImmediate);
    assert.equal(
      h.state[4],
      status === 400 ? "dashboardInvalidPeriod" : "dashboardError",
    );
    assert.equal(h.state[3], false);
  });
test("chart switches Orders/Payments; full UZS tooltip, keyboard/touch day selection", () => {
  const state = ["orders", null, 360];
  let cursor = 0;
  const module = load("../src/components/dashboard/DashboardChart.tsx", {
    react: {
      useEffect() {},
      useRef: () => ({ current: null }),
      useState: () => {
        const i = cursor++;
        return [
          state[i],
          (v) => {
            state[i] = v;
          },
        ];
      },
    },
    "../../lib/dashboard": lib,
    "../../lib/orders": orders,
    "../../lib/i18n": { dashboardCopy },
    "../Preferences": {
      usePreferences: () => ({ locale: "uz", t: (key) => messages.uz[key] }),
    },
  });
  const render = () => {
    cursor = 0;
    return module.DashboardChart({ chart: data.chart });
  };
  let all = nodes(render());
  all
    .find(
      (n) =>
        n.type === "button" &&
        n.props.children === messages.ru.dashboardPayments,
    )
    .props.onClick();
  all = nodes(render());
  assert.ok(
    all.some((n) => n.type === "strong" && /UZS/.test(n.props.children)),
  );
  const svg = all.find((n) => n.type === "svg");
  svg.props.onKeyDown({ key: "Home", preventDefault() {} });
  assert.equal(state[1], 0);
  svg.props.onPointerDown({
    clientX: 360,
    currentTarget: { getBoundingClientRect: () => ({ left: 0, width: 360 }) },
  });
  assert.equal(state[1], 6);
  svg.props.onPointerDown({
    clientX: 160,
    currentTarget: { getBoundingClientRect: () => ({ left: 0, width: 360 }) },
  });
  const touchDay = state[1];
  svg.props.onPointerLeave({ pointerType: "touch" });
  assert.equal(state[1], touchDay);
  svg.props.onPointerLeave({ pointerType: "mouse" });
  assert.equal(state[1], null);
});

test("catalog bars use only existing counts and zero totals produce zero, never NaN", () => {
  const h = dashboardHarness("uz");
  let bars = nodes(h.render()).filter((n) => n.props?.role === "progressbar");
  assert.deepEqual(
    bars.map((n) => n.props["aria-valuenow"]),
    [100, 60, 20, 20, 25, 75],
  );
  h.state[2] = {
    ...data,
    products: {
      ...data.products,
      total: 0,
      active: 0,
      draft: 0,
      inactive: 0,
      lowStockVariants: 0,
      outOfStockVariants: 0,
    },
  };
  bars = nodes(h.render()).filter((n) => n.props?.role === "progressbar");
  assert.ok(bars.every((n) => n.props["aria-valuenow"] === 0));
});
test("payment KPI displays the original approved-payment value without adding order totals or paid values", () => {
  const tree = dashboardHarness("ru").render();
  const cards = nodes(tree).filter(
    (n) => n.props?.className === "dashboard-panel dashboard-kpi",
  );
  const amount = nodes(cards[1]).find(
    (n) => n.props?.className === "dashboard-number",
  );
  assert.equal(
    amount.props.children[0].replace(/\s/g, ""),
    String(data.kpis.receivedPayments),
  );
});
test("status badge tones are presentation only and keep existing Russian labels", () => {
  const h = dashboardHarness("ru");
  for (const [status, tone] of [
    ["COMPLETED", "success"],
    ["PREPAYMENT_SUBMITTED", "waiting"],
    ["FINAL_PAYMENT_SUBMITTED", "waiting"],
    ["IN_TRANSIT", "transport"],
    ["SHIPPED", "transport"],
    ["CANCELLED", "danger"],
  ]) {
    h.state[2] = {
      ...data,
      latestOrders: [{ ...data.latestOrders[0], status }],
    };
    const badge = nodes(h.render()).find(
      (n) => n.props?.className === "badge dashboard-status",
    );
    assert.equal(badge.props["data-tone"], tone);
    assert.equal(
      badge.props.children,
      messages.ru[orders.orderStatusKey(status)],
    );
  }
});
function frameModule(preferences, api = async () => {}, globals = {}) {
  return load(
    "../src/components/AdminFrame.tsx",
    {
      react: { useState: (initial) => [initial, () => {}] },
      "next/navigation": { usePathname: () => "/" },
      "./Header": { Header: () => null },
      "./Preferences": {
        usePreferences: () => ({ locale: "uz", ...preferences }),
      },
      "../lib/i18n": { dashboardCopy },
      "../lib/api": { api, errorKey: () => "error" },
    },
    globals,
  );
}
test("Dashboard navigation is Russian, ordered and includes the Marketing section", () => {
  const module = frameModule({ t: (key) => messages.uz[key] });
  const nav = module.AdminNav({ dashboard: true });
  const items = nodes(
    nodes(nav).find((n) => n.props?.className === "dashboard-nav-links"),
  ).filter((n) => n.type === "a");
  assert.deepEqual(
    items.map((n) => n.props.href),
    [
      "/admin/",
      "/admin/orders",
      "/admin/products",
      "/admin/categories",
      "/admin/customers",
      "/admin/marketing",
      "/admin/finance",
      "/admin/telegram",
    ],
  );
  assert.deepEqual(
    items.map((n) => n.props.children[1]),
    [
      messages.ru.dashboardPanel,
      messages.ru.orders,
      messages.ru.products,
      messages.ru.categories,
      messages.ru.customers,
      messages.ru.marketing,
      messages.ru.financeTitle,
      messages.ru.telegram,
    ],
  );
  const normal = nodes(module.AdminNav()).filter(
    (n) => n.type === "a" && n.props.className !== "dashboard-wordmark",
  );
  assert.equal(normal[0].props.children[1], messages.uz.dashboardPanel);
});
for (const dashboard of [false, true])
  test(`logout preserves method, CSRF and redirect (Dashboard=${dashboard})`, async () => {
    const calls = [],
      redirects = [];
    const module = frameModule(
      { t: (key) => messages.uz[key] },
      async (...args) => {
        calls.push(args);
      },
      { window: { location: { replace: (url) => redirects.push(url) } } },
    );
    const tree = module.AdminFrame({
      csrfToken: "fixture-csrf",
      children: null,
      dashboard,
    });
    if (dashboard) {
      assert.equal(tree.props.className, "admin-dashboard-shell");
      assert.equal(tree.props.lang, "ru");
    } else {
      assert.equal(
        tree.props.className,
        "admin-dashboard-shell admin-section-shell",
      );
      assert.equal(tree.props.lang, "uz");
    }
    await nodes(tree)
      .find((n) => n.type === "button")
      .props.onClick();
    assert.equal(calls[0][0], "auth/logout");
    assert.equal(calls[0][1].method, "POST");
    assert.equal(calls[0][1].headers["x-csrf-token"], "fixture-csrf");
    assert.deepEqual(redirects, ["/cdn-cgi/access/logout"]);
  });
test("logout failure does not redirect or bypass auth", async () => {
  const redirects = [];
  const module = frameModule(
    { t: (key) => messages.ru[key] },
    async () => {
      throw new Error("fixture");
    },
    { window: { location: { replace: (url) => redirects.push(url) } } },
  );
  await nodes(
    module.AdminFrame({
      csrfToken: "fixture",
      children: null,
      dashboard: true,
    }),
  )
    .find((n) => n.type === "button")
    .props.onClick();
  assert.deepEqual(redirects, []);
});
test("Header keeps controls and uses a role/initial instead of a fake name or photograph", () => {
  const controls = () => null;
  const module = load("../src/components/Header.tsx", {
    "./Preferences": {
      PreferenceControls: controls,
      usePreferences: () => ({ t: (key) => messages.uz[key] }),
    },
    "../lib/i18n": { dashboardCopy },
  });
  const all = nodes(
    module.Header({ dashboard: true, children: "fixture-logout" }),
  );
  assert.equal(all.find((n) => n.type === controls).props.russian, true);
  assert.equal(all.filter((n) => n.type === "img").length, 0);
  assert.ok(
    all.some(
      (n) =>
        n.type === "strong" && n.props.children === messages.ru.dashboardAdmin,
    ),
  );
  assert.ok(
    !nodes(module.Header({})).some(
      (n) => n.props?.className === "dashboard-principal",
    ),
  );
  const section = nodes(module.Header({ styled: true }));
  assert.equal(section.find((n) => n.type === controls).props.russian, false);
  assert.ok(
    section.some(
      (n) =>
        n.type === "strong" && n.props.children === messages.uz.dashboardAdmin,
    ),
  );
  assert.equal(section.filter((n) => n.type === "img").length, 0);
});
test("Russian Dashboard controls preserve global UZ locale and theme callbacks for the other pages", () => {
  const updates = [];
  const preferences = {
    locale: "uz",
    theme: "dark",
    setLocale: (v) => updates.push(["locale", v]),
    setTheme: (v) => updates.push(["theme", v]),
    t: (key) => messages.uz[key],
  };
  const module = load("../src/components/Preferences.tsx", {
    react: { createContext: () => ({}), useContext: () => preferences },
    "../lib/i18n": { messages, dashboardCopy },
  });
  const selects = nodes(module.PreferenceControls({ russian: true })).filter(
    (n) => n.type === "select",
  );
  assert.equal(selects[0].props.value, "uz");
  assert.equal(selects[1].props["aria-label"], messages.ru.theme);
  selects[0].props.onChange({ target: { value: "ru" } });
  selects[1].props.onChange({ target: { value: "light" } });
  assert.deepEqual(updates, [
    ["locale", "ru"],
    ["theme", "light"],
  ]);
  const ordinary = nodes(module.PreferenceControls()).filter(
    (n) => n.type === "select",
  );
  assert.equal(ordinary[1].props["aria-label"], messages.uz.theme);
});

const tags = Object.fromEntries(
  [
    "Dashboard",
    "Categories",
    "ProductsList",
    "ProductEditor",
    "OrdersList",
    "OrderDetail",
    "Login",
    "TelegramSettings",
    "Preferences",
    "CustomersList",
    "CustomerDetail",
    "ManualOrder",
    "CustomerNotes",
    "MarketingHome",
    "BannerManager",
    "PromoCodeManager",
    "Expenses",
    "FinanceDashboard",
    "Refunds",
  ].map((name) => [name, () => null]),
);
for (const [path, component] of [
  ["/", "Dashboard"],
  ["/categories", "Categories"],
  ["/products", "ProductsList"],
  ["/products/new", "ProductEditor"],
  ["/products/existing", "ProductEditor"],
  ["/orders", "OrdersList"],
  ["/orders/STZ-EXISTING", "OrderDetail"],
  ["/telegram", "TelegramSettings"],
  ["/orders/new", "ManualOrder"],
  ["/customers/fixture/orders/new", "ManualOrder"],
  ["/customers", "CustomersList"],
  ["/customers/fixture", "CustomerDetail"],
  ["/marketing", "MarketingHome"],
  ["/marketing/banners", "BannerManager"],
  ["/marketing/promo-codes", "PromoCodeManager"],
  ["/finance", "FinanceDashboard"],
  ["/finance/expenses", "Expenses"],
  ["/finance/refunds", "Refunds"],
])
  test(`SPA route ${path} preserves correct component`, () => {
    let cursor = 0;
    const module = load(
      "../src/spa.tsx",
      {
        "react-dom/client": { createRoot: () => ({ render() {} }) },
        react: {
          useEffect() {},
          useState: () => [
            cursor++ === 0 ? { csrfToken: "fixture" } : false,
            () => {},
          ],
        },
        "../../miniapp/src/spa/navigation": {
          usePathname: () => path,
          useSearchParams: () => new URLSearchParams(),
        },
        "./components/Preferences": tags,
        "./components/Categories": tags,
        "./components/products/ProductsList": tags,
        "./components/products/ProductEditor": tags,
        "./components/orders/OrdersList": tags,
        "./components/orders/OrderDetail": tags,
        "./components/Login": tags,
        "./components/TelegramSettings": tags,
        "./components/customers/Customers": tags,
        "./components/customers/ManualOrder": tags,
        "./components/finance/Expenses": tags,
        "./components/finance/Refunds": tags,
        "./components/finance/FinanceDashboard": tags,
        "./components/customers/CustomerNotes": tags,
        "./components/marketing/Banners": tags,
        "./components/marketing/PromoCodes": tags,
        "./components/dashboard/Dashboard": tags,
        "./app/globals.css": {},
      },
      {
        document: {
          documentElement: { dataset: {} },
          getElementById: () => ({}),
        },
        localStorage: { getItem: () => "light" },
      },
    );
    const result = module.Routes();
    assert.equal(result.type, tags[component]);
    assert.equal(result.props.csrfToken, "fixture");
  });
test("sidebar has Dashboard + Categories + existing links and exactly one active route", () => {
  for (const path of [
    "/",
    "/categories",
    "/products",
    "/orders",
    "/telegram",
    "/marketing",
    "/finance",
  ]) {
    const module = load("../src/components/AdminFrame.tsx", {
      react: {},
      "next/navigation": { usePathname: () => path },
      "./Header": {},
      "./Preferences": {
        usePreferences: () => ({ t: (key) => messages.ru[key] }),
      },
      "../lib/api": {},
      "../lib/i18n": { dashboardCopy },
    });
    const links = nodes(module.AdminNav()).filter(
      (n) => n.type === "a" && n.props.className !== "dashboard-wordmark",
    );
    assert.equal(links.length, 8);
    assert.equal(
      links.filter((n) => n.props["aria-current"] === "page").length,
      1,
    );
    assert.equal(
      links.find((n) => n.props["aria-current"] === "page").props.href,
      "/admin" + (path === "/" ? "/" : path),
    );
  }
});

test("Categories uses the shared styled shell while keeping its logout request and redirect", async () => {
  const calls = [],
    redirects = [];
  const header = () => null,
    nav = () => null;
  const module = load(
    "../src/components/Categories.tsx",
    {
      react: {
        useState: (initial) => [initial, () => {}],
        useRef: (initial) => ({ current: initial }),
        useEffect: () => {},
        useCallback: (fn) => fn,
      },
      "./Header": { Header: header },
      "./AdminFrame": { AdminNav: nav },
      "./Preferences": {
        usePreferences: () => ({ locale: "uz", t: (key) => messages.uz[key] }),
      },
      "../lib/api": {
        api: async (...args) => {
          calls.push(args);
        },
        errorKey: () => "error",
      },
    },
    { window: { location: { replace: (url) => redirects.push(url) } } },
  );
  const tree = module.Categories({ csrfToken: "fixture-csrf" });
  assert.equal(
    tree.props.className,
    "admin-dashboard-shell admin-section-shell",
  );
  assert.equal(tree.props.lang, "uz");
  assert.equal(nodes(tree).find((n) => n.type === header).props.styled, true);
  assert.equal(nodes(tree).filter((n) => n.type === nav).length, 1);
  await nodes(tree)
    .find((n) => n.type === "button" && n.props.className === "quiet")
    .props.onClick();
  assert.equal(calls[0][0], "auth/logout");
  assert.equal(calls[0][1].method, "POST");
  assert.equal(calls[0][1].headers["x-csrf-token"], "fixture-csrf");
  assert.deepEqual(redirects, ["/admin/login"]);
});

test("shared navigation keeps exactly one active section for editor and order detail paths in RU and UZ", () => {
  for (const locale of ["ru", "uz"]) {
    for (const [path, href] of [
      ["/products/new", "/admin/products"],
      ["/products/fixture", "/admin/products"],
      ["/orders/STZ-FIXTURE", "/admin/orders"],
    ]) {
      const module = load("../src/components/AdminFrame.tsx", {
        react: {},
        "next/navigation": { usePathname: () => path },
        "./Header": {},
        "./Preferences": {
          usePreferences: () => ({ locale, t: (key) => messages[locale][key] }),
        },
        "../lib/api": {},
        "../lib/i18n": { dashboardCopy },
      });
      const links = nodes(module.AdminNav()).filter(
        (n) => n.type === "a" && n.props["aria-current"] === "page",
      );
      assert.equal(links.length, 1);
      assert.equal(links[0].props.href, href);
    }
  }
});
for (const [page, component] of [
  ["../src/app/page.tsx", "Dashboard"],
  ["../src/app/categories/page.tsx", "Categories"],
])
  test(`Next page ${component} reuses component with existing session guard`, async () => {
    for (const authenticated of [true, false]) {
      const session = {
        getSession: async () =>
          authenticated ? { csrfToken: "fixture" } : null,
      };
      const module = load(page, {
        "next/navigation": {
          redirect: () => {
            throw new Error("redirect login");
          },
        },
        "../lib/session": session,
        "../../lib/session": session,
        "../components/dashboard/Dashboard": tags,
        "../../components/Categories": tags,
      });
      if (authenticated)
        assert.equal((await module.default()).type, tags[component]);
      else await assert.rejects(module.default(), /redirect login/);
    }
  });

for (const netProfit of [215998, -238000, null])
  test(`net profit card renders ${netProfit} and explains missing costs instead of inventing profit`, () => {
    const f = dashboardHarness("ru", {
      ...data,
      profit: {
        netProfit,
        incompleteOrders: netProfit === null ? 1 : 0,
        completedOrders: 1,
        overheadExpenses: 7000,
      },
    });
    const tree = nodes(f.render());
    assert.ok(
      tree.some((n) => n.props?.children === messages.ru.dashboardNetProfit),
    );
    const number = tree.find(
      (n) =>
        n.type === "section" && n.props.className?.includes("dashboard-profit"),
    );
    assert.ok(number);
    const inner = nodes(number);
    if (netProfit === null) {
      assert.ok(
        inner.some(
          (n) =>
            Array.isArray(n.props?.children) && n.props.children.includes("—"),
        ),
      );
      assert.ok(
        inner.some(
          (n) => n.props?.role === "status" && n.props.children.includes("1"),
        ),
      );
    } else {
      assert.ok(
        inner.some(
          (n) =>
            Array.isArray(n.props?.children) &&
            n.props.children.includes(orders.uzs(netProfit, "ru")),
        ),
      );
    }
  });
