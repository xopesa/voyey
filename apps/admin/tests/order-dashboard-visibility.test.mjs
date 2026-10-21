import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import { URL } from "node:url";
import ts from "typescript";
const require = createRequire(import.meta.url);
function load(file, deps = {}, extra = {}) {
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
      Intl,
      AbortController: globalThis.AbortController,
      ...extra,
      require: (name) => {
        if (name in deps) return deps[name];
        if (name === "react/jsx-runtime") return require(name);
        throw Error(name);
      },
    },
  );
  return exports;
}
const { messages } = load("lib/i18n.ts");
const nodes = (n) =>
  n && typeof n === "object"
    ? [n, ...[n.props?.children].flat(Infinity).flatMap(nodes)]
    : [];
const tick = () => new Promise((resolve) => globalThis.setTimeout(resolve, 0));
function fixture(locale, hidden = false) {
  const state = [],
    refs = [],
    calls = [];
  let cursor = 0,
    rc = 0,
    confirmed = false,
    gate;
  const order = {
    publicId: "STZ-FIXTURE",
    status: "COMPLETED",
    dashboardHiddenAt: hidden ? "2026-10-21T12:00:00Z" : null,
    createdAt: "2026-10-21T12:00:00Z",
    recipient: { fullName: "Fixture" },
    customer: { telegramId: "1", username: null },
    total: 200000,
    requiredPrepayment: 100000,
    paymentAttempts: [],
    requiresAction: false,
  };
  const { OrdersList } = load(
    "components/orders/OrdersList.tsx",
    {
      react: {
        useState: (initial) => {
          const slot = cursor++;
          if (!(slot in state)) state[slot] = initial;
          return [
            state[slot],
            (next) => {
              state[slot] =
                typeof next === "function" ? next(state[slot]) : next;
            },
          ];
        },
        useRef: (initial) =>
          refs[rc++] ?? (refs[rc - 1] = { current: initial }),
        useEffect() {},
      },
      "../../lib/api": {
        api: async (...args) => {
          calls.push(args);
          await gate;
          return { dashboardHiddenAt: hidden ? null : "2026-10-21T12:00:00Z" };
        },
      },
      "../../lib/orders": {
        dateTime: String,
        orderError: () => "error",
        orderQuery: () => "orders",
        orderStatusKey: (status) => "order" + status,
        orderStatuses: ["COMPLETED"],
        uzs: String,
      },
      "../Preferences": {
        usePreferences: () => ({ locale, t: (key) => messages[locale][key] }),
      },
      "../AdminFrame": { AdminFrame: "frame" },
      "./PendingPayments": { PendingPayments: "pending-payments" },
    },
    { window: { confirm: () => confirmed } },
  );
  const render = () => {
    cursor = 0;
    rc = 0;
    return nodes(OrdersList({ csrfToken: "fixture-csrf" }));
  };
  render();
  state[0] = [
    order,
    {
      ...order,
      publicId: "STZ-ACTIVE",
      status: "IN_TRANSIT",
      dashboardHiddenAt: null,
    },
  ];
  state[4] = false;
  return {
    render,
    order,
    state,
    calls,
    t: (key) => messages[locale][key],
    allow: () => {
      confirmed = true;
    },
    gate: (promise) => {
      gate = promise;
    },
  };
}
for (const locale of ["ru", "uz"])
  for (const hidden of [false, true])
    test(`${locale}: completed order ${hidden ? "restore" : "hide"} requires confirmation, sends CSRF and locks duplicate clicks`, async () => {
      const f = fixture(locale, hidden);
      const action = (tree) =>
        tree.find(
          (n) =>
            n.type === "button" &&
            n.props.children ===
              f.t(hidden ? "dashboardRestoreShort" : "dashboardHideShort"),
        );
      assert.equal(
        f
          .render()
          .filter(
            (n) =>
              n.type === "button" &&
              [
                f.t("dashboardHideShort"),
                f.t("dashboardRestoreShort"),
              ].includes(n.props.children),
          ).length,
        1,
        "unfinished row must not expose hide",
      );
      if (hidden)
        assert.ok(
          f
            .render()
            .some((n) => n.props?.children === f.t("dashboardOrderHidden")),
        );
      action(f.render()).props.onClick();
      await tick();
      assert.equal(f.calls.length, 0);
      f.allow();
      let release;
      f.gate(
        new Promise((resolve) => {
          release = resolve;
        }),
      );
      const button = action(f.render());
      button.props.onClick();
      button.props.onClick();
      await tick();
      assert.equal(f.calls.length, 1);
      assert.equal(action(f.render()).props.disabled, true);
      const [path, init] = f.calls[0];
      assert.equal(path, "orders/STZ-FIXTURE/dashboard-visibility");
      assert.equal(init.method, "POST");
      assert.equal(init.headers["x-csrf-token"], "fixture-csrf");
      assert.deepEqual(JSON.parse(init.body), { hidden: !hidden });
      release();
      await tick();
      assert.ok(
        f
          .render()
          .some(
            (n) =>
              n.props?.children ===
              f.t(
                hidden
                  ? "dashboardOrderRestoredNotice"
                  : "dashboardOrderHiddenNotice",
              ),
          ),
      );
    });
test("failed hide does not show success or change displayed order state", async () => {
  const f = fixture("ru");
  f.allow();
  let reject;
  f.gate(
    new Promise((_resolve, no) => {
      reject = no;
    }),
  );
  f.render()
    .find(
      (n) =>
        n.type === "button" && n.props.children === f.t("dashboardHideShort"),
    )
    .props.onClick();
  reject(Error("isolated failure"));
  await tick();
  assert.ok(f.render().some((n) => n.props?.role === "alert"));
  assert.equal(f.order.dashboardHiddenAt, null);
  assert.ok(
    !f
      .render()
      .some((n) => n.props?.children === f.t("dashboardOrderHiddenNotice")),
  );
});
test("non-completed and cancelled orders never expose dashboard hide controls", () => {
  const f = fixture("ru");
  f.order.status = "CANCELLED";
  assert.ok(
    !f
      .render()
      .some(
        (n) =>
          n.type === "button" && n.props.children === f.t("dashboardHideShort"),
      ),
  );
});
