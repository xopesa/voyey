import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { URL, URLSearchParams } from "node:url";
import { setImmediate } from "node:timers";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
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
      exports,
      URLSearchParams,
      Intl,
      Error,
      AbortController: globalThis.AbortController,
      require: (n) => {
        if (n in deps) return deps[n];
        if (n === "@stenzo/shared") return shared;
        if (n === "react/jsx-runtime") return require(n);
        if (n.endsWith(".css")) return {};
        throw Error(n);
      },
      ...globals,
    },
  );
  return exports;
}
const { messages } = load("../src/lib/i18n.ts"),
  helpers = load("../src/lib/finance.ts");
const nodes = (n) =>
  n && typeof n === "object"
    ? [n, ...[n.props?.children].flat(Infinity).flatMap(nodes)]
    : [];
const tick = () => new Promise((r) => setImmediate(r));
const row = {
  id: "e",
  category: "CARGO",
  amount: 60000,
  occurredAt: "2026-10-19T19:00:00.000Z",
  description: "<script>fixture</script>",
  orderPublicId: "STZ-FINANCE",
  createdBy: "web-admin",
  createdAt: "2026-10-20T00:00:00.000Z",
  updatedAt: "2026-10-20T00:00:00.000Z",
  voidedAt: null,
};
function harness(file, name, locale = "ru", props = {}) {
  const f = {
    state: [],
    refs: [],
    calls: [],
    performed: [],
    confirmations: [],
    allowConfirm: false,
  };
  let i = 0,
    r = 0,
    handle = async () => ({});
  const t = (k) => {
    assert.ok(messages[locale][k], `Missing ${locale} translation ${k}`);
    return messages[locale][k];
  };
  const module = load(
    file,
    {
      react: {
        useEffect() {},
        useRef: (initial) =>
          f.refs[r++] ?? (f.refs[r - 1] = { current: initial }),
        useState: (initial) => {
          const slot = i++;
          if (!(slot in f.state))
            f.state[slot] = typeof initial === "function" ? initial() : initial;
          return [
            f.state[slot],
            (value) =>
              (f.state[slot] =
                typeof value === "function" ? value(f.state[slot]) : value),
          ];
        },
      },
      "../AdminFrame": { AdminFrame: "frame" },
      "../Preferences": { usePreferences: () => ({ locale, t }) },
      "../../lib/api": {
        errorKey: () => "error",
        api: async (path, init = {}) => {
          f.calls.push({ path, init });
          return handle(path, init);
        },
      },
      "../../lib/orders": {
        uzs: (n) => String(n),
        dateTime: (v) => v,
        orderStatusKey: (s) => "order_" + s,
      },
      "../../lib/dashboard": { dashboardDate: (v) => v },
      "../../lib/finance": helpers,
    },
    {
      window: {
        confirm: (s) => {
          f.confirmations.push(s);
          return f.allowConfirm;
        },
      },
    },
  );
  f.render = (
    fn = module[name],
    args = { csrfToken: "fixture-csrf", ...props },
  ) => {
    i = 0;
    r = 0;
    return nodes(fn(args));
  };
  f.t = t;
  f.handle = (fn) => (handle = fn);
  f.module = module;
  return f;
}
const button = (f, key) =>
  f.render().find((n) => n.type === "button" && n.props.children === f.t(key));
test("expense form uses Tashkent independent of browser timezone, positive strict integers and optimistic timestamp", () => {
  assert.equal(
    helpers.tashkentInput("2026-10-19T19:00:00Z"),
    "2026-10-20T00:00",
  );
  const draft = helpers.expenseDraft(row);
  assert.equal(draft.occurredAt, "2026-10-20T00:00");
  assert.equal(
    helpers.expensePayload(draft, row).expectedUpdatedAt,
    row.updatedAt,
  );
  for (const amount of ["0", "-1", "1.1", "1e3", "2147483648"])
    assert.throws(() => helpers.expensePayload({ ...draft, amount }));
});
test("finance SVG geometry preserves negative profit, bounded coordinates and single-day data points", () => {
  for (const rows of [
    [{ date: "2026-10-20", received: 0, expenses: 0, profit: -1 }],
    Array.from({ length: 366 }, (_, i) => ({
      date: String(i),
      received: 10,
      expenses: 20,
      profit: i % 2 ? -100 : 300,
    })),
  ]) {
    const g = helpers.financeChartGeometry(rows, ["profit"]);
    assert.ok(g.min < 0);
    assert.ok(g.zero >= 20 && g.zero <= 180);
    assert.equal(g.series[0].points.length, rows.length);
    assert.ok(g.series[0].points.every((p) => p.y >= 20 && p.y <= 180));
    assert.equal(/NaN|Infinity/.test(g.series[0].path), false);
  }
});
for (const locale of ["ru", "uz"])
  test(`expenses ${locale}: explicit create has CSRF and duplicate-click protection, no autosave`, async () => {
    const f = harness(
      "../src/components/finance/Expenses.tsx",
      "Expenses",
      locale,
    );
    f.render();
    assert.equal(f.calls.length, 0);
    f.state[4] = false;
    f.state[8] = { draft: { ...helpers.expenseDraft(), amount: "60000" } };
    f.handle(async () => ({ expense: row }));
    const form = f
      .render()
      .find((n) => n.type === "form" && n.props.className === "editor");
    form.props.onSubmit({ preventDefault() {} });
    form.props.onSubmit({ preventDefault() {} });
    await tick();
    assert.equal(f.calls.length, 1);
    assert.equal(f.calls[0].path, "finance/expenses");
    assert.equal(f.calls[0].init.method, "POST");
    assert.equal(f.calls[0].init.headers["x-csrf-token"], "fixture-csrf");
    assert.equal(JSON.parse(f.calls[0].init.body).amount, 60000);
    assert.equal(f.state[8], null);
  });
test("expense void requires explicit confirm, escaped description, keeps voided history without edit/delete/unvoid actions", async () => {
  const f = harness("../src/components/finance/Expenses.tsx", "Expenses");
  f.render();
  f.state[3] = { expenses: [row], nextCursor: null };
  f.state[4] = false;
  f.handle(async () => ({
    expense: { ...row, voidedAt: "2026-10-20T01:00:00Z" },
  }));
  let tree = f.render();
  assert.ok(
    tree.some((n) => n.type === "td" && n.props.children === row.description),
  );
  assert.equal(
    tree.some((n) => n.props.dangerouslySetInnerHTML),
    false,
  );
  button(f, "financeVoid").props.onClick();
  await tick();
  assert.equal(f.calls.length, 0);
  f.allowConfirm = true;
  button(f, "financeVoid").props.onClick();
  await tick();
  assert.equal(f.calls[0].path, "finance/expenses/e/void");
  assert.equal(f.calls[0].init.headers["x-csrf-token"], "fixture-csrf");
  f.state[3] = {
    expenses: [{ ...row, voidedAt: "2026-10-20T01:00:00Z" }],
    nextCursor: null,
  };
  assert.equal(button(f, "financeVoid"), undefined);
  assert.equal(button(f, "edit"), undefined);
  assert.equal(
    f
      .render()
      .some(
        (n) =>
          n.type === "button" &&
          /unvoid|delete|удалить/i.test(String(n.props.children)),
      ),
    false,
  );
});
test("procurement explicit save/clear confirmations preserve server authority; incomplete profit renders a warning", async () => {
  const f = harness(
    "../src/components/finance/Procurement.tsx",
    "Procurement",
    "ru",
    {
      publicId: "STZ-FINANCE",
      revision: 1,
      disabled: false,
      perform: async (...args) => {
        f.performed.push(args);
        return true;
      },
    },
  );
  f.render();
  f.state[0] = {
    publicId: "STZ-FINANCE",
    costComplete: false,
    missingCosts: 1,
    items: [
      {
        id: "i",
        productNameRu: "Брюки",
        productNameUz: "Shim",
        sku: "F-M",
        quantity: 2,
        unitPrice: 145000,
        lineTotal: 290000,
        procurementUnitCost: 90000,
        procurementUpdatedAt: "2026-10-20T00:00:00Z",
        procurementLineCost: 180000,
        lineMargin: 110000,
      },
    ],
    goodsSubtotal: 290000,
    discountAmount: 0,
    goodsRevenue: 290000,
    customerCargo: 0,
    revenue: 290000,
    procurementCost: 180000,
    linkedExpenses: 0,
    directCost: 180000,
    profit: null,
    marginPercent: null,
    received: 0,
    outstanding: 290000,
    completedAt: null,
  };
  const tree = f.render();
  assert.ok(
    tree.some(
      (n) =>
        n.props.role === "status" &&
        n.props.children === f.t("financeIncomplete"),
    ),
  );
  const child = tree.find((n) => typeof n.type === "function");
  f.state = ["100000", false];
  const form = f.render(child.type, child.props).find((n) => n.type === "form");
  assert.equal(f.performed.length, 0);
  form.props.onSubmit({ preventDefault() {} });
  await tick();
  assert.equal(f.performed[0][1], "PATCH");
  assert.equal(f.performed[0][2].procurementUnitCost, 100000);
  const clear = () =>
    f
      .render(child.type, child.props)
      .find(
        (n) =>
          n.type === "button" && n.props.children === f.t("financeClearCost"),
      );
  clear().props.onClick();
  await tick();
  assert.equal(f.performed.length, 1);
  f.allowConfirm = true;
  clear().props.onClick();
  await tick();
  assert.equal(f.performed[1][2].procurementUnitCost, null);
  f.state = ["0", false];
  f.render(child.type, child.props)
    .find((n) => n.type === "form")
    .props.onSubmit({ preventDefault() {} });
  await tick();
  assert.equal(f.performed.length, 2);
});
const data = {
  period: { from: "2026-10-20", to: "2026-10-20", timezone: "Asia/Tashkent" },
  cash: {
    received: 380000,
    goodsReceived: null,
    cargoReceived: null,
    unallocatedCash: 235000,
    unallocatedFinalCount: 1,
    expenses: 65000,
    cashBeforeProcurement: 315000,
  },
  realized: {
    completedOrders: 2,
    costCompleteOrders: 1,
    incompleteOrders: 1,
    revenue: 380000,
    procurement: 180000,
    expenses: 65000,
    profit: 135000,
    marginPercent: 35.526315789,
    historicalUndated: 1,
  },
  chart: [
    { date: "2026-10-20", received: 380000, expenses: 65000, profit: 135000 },
  ],
  expenseBreakdown: shared.expenseCategories.map((category) => ({
    category,
    amount: category === "CARGO" ? 65000 : 0,
  })),
  profitableOrders: [
    {
      publicId: "STZ-FINANCE",
      customer: "Fixture",
      completedAt: "2026-10-20T00:00:00Z",
      revenue: 380000,
      procurement: 180000,
      expenses: 65000,
      profit: 135000,
      marginPercent: 35.526315789,
    },
  ],
  incompleteOrders: [],
};
for (const locale of ["ru", "uz"])
  test(`finance ${locale}: cash/profit separation, incomplete/undated warnings, exact server totals and Admin order links`, () => {
    const f = harness(
      "../src/components/finance/FinanceDashboard.tsx",
      "FinanceDashboard",
      locale,
    );
    f.render();
    f.state[2] = data;
    f.state[3] = false;
    const tree = f.render();
    assert.ok(
      tree.some(
        (n) => n.type === "strong" && n.props.children === "380000 UZS",
      ),
    );
    assert.ok(
      tree.some(
        (n) => n.type === "strong" && n.props.children === "135000 UZS",
      ),
    );
    assert.ok(
      tree.some((n) => n.type === "strong" && n.props.children === "—"),
    );
    assert.ok(
      tree.some(
        (n) =>
          n.props.role === "status" &&
          n.props.children?.includes(f.t("financeIncompleteCount")),
      ),
    );
    assert.ok(
      tree.some(
        (n) => n.type === "a" && n.props.href === "/admin/orders/STZ-FINANCE",
      ),
    );
    assert.equal(
      tree.some(
        (n) =>
          n.type === "button" &&
          /paid|оплачен|to‘langan/i.test(String(n.props.children)),
      ),
      false,
    );
    assert.equal(f.calls.length, 0);
    f.state[0] = { range: "custom", from: "2026-10-01", to: "2026-10-20" };
    f.render()
      .find((n) => n.type === "form")
      .props.onSubmit({ preventDefault() {} });
    assert.equal(
      f.state[1],
      "finance?range=custom&from=2026-10-01&to=2026-10-20",
    );
  });
test("empty finance dashboard renders real empty states; chart day slider handles one day", () => {
  const f = harness(
    "../src/components/finance/FinanceDashboard.tsx",
    "FinanceDashboard",
  );
  f.render();
  f.state[2] = {
    ...data,
    expenseBreakdown: data.expenseBreakdown.map((r) => ({ ...r, amount: 0 })),
    profitableOrders: [],
  };
  f.state[3] = false;
  const tree = f.render();
  assert.ok(tree.some((n) => n.props.children === f.t("financeNoExpenses")));
  assert.ok(tree.some((n) => n.props.children === f.t("financeNoCompleted")));
  f.state = [];
  const chart = f.render(f.module.FinanceChart, {
    rows: data.chart,
    mode: "profit",
  });
  assert.ok(chart.some((n) => n.type === "circle"));
  assert.equal(chart.find((n) => n.type === "input").props.max, 0);
});
