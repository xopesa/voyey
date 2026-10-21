import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import { URL } from "node:url";
import { setImmediate } from "node:timers";
import * as shared from "@stenzo/shared";
import ts from "typescript";
const require = createRequire(import.meta.url);
function load(file, deps = {}) {
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
      Intl,
      AbortController: globalThis.AbortController,
      require: (n) => {
        if (n in deps) return deps[n];
        if (n === "@stenzo/shared") return shared;
        if (n === "react/jsx-runtime") return require(n);
        throw Error(n);
      },
    },
  );
  return exports;
}
const { messages } = load("../src/lib/i18n.ts");
const nodes = (n) =>
  n && typeof n === "object"
    ? [n, ...[n.props?.children].flat(Infinity).flatMap(nodes)]
    : [];
const tick = () => new Promise((r) => setImmediate(r));
function fixture(locale = "ru") {
  const state = [],
    calls = [];
  let index = 0;
  const props = {
    publicId: "STZ-FIXTURE",
    revision: 0,
    disabled: false,
    perform: async (...args) => {
      calls.push(args);
      return true;
    },
  };
  const { OrderLifecycle } = load(
    "../src/components/orders/OrderLifecycle.tsx",
    {
      react: {
        useEffect() {},
        useState(initial) {
          const slot = index++;
          if (!(slot in state)) state[slot] = initial;
          return [
            state[slot],
            (v) => {
              state[slot] = v;
            },
          ];
        },
      },
      "../Preferences": {
        usePreferences: () => ({
          locale,
          t: (k) => {
            assert.ok(messages[locale][k], k);
            return messages[locale][k];
          },
        }),
      },
      "../../lib/api": { api: async () => {}, errorKey: () => "error" },
      "../../lib/orders": { uzs: (n) => String(n), dateTime: (v) => v },
      "./ConfirmAction": { ConfirmAction: "confirm" },
    },
  );
  const render = () => {
    index = 0;
    return nodes(OrderLifecycle(props));
  };
  render();
  state[0] = {
    status: "AWAITING_PURCHASE",
    canCancel: true,
    hasSubmitted: false,
    approvedCash: 145000,
    reason: null,
    note: null,
    cancelledAt: null,
    stockReleaseStatus: "NOT_RELEASED",
    stockReleasedAt: null,
    refund: null,
  };
  return { state, calls, props, render, t: (k) => messages[locale][k] };
}
for (const locale of ["ru", "uz"])
  test(`cancellation ${locale}: explicit reason + confirmation, approved-cash warning, delegates guarded mutation`, async () => {
    const f = fixture(locale);
    assert.equal(f.calls.length, 0);
    f.render()
      .find(
        (n) =>
          n.type === "button" && n.props.children === f.t("lifecycleCancel"),
      )
      .props.onClick();
    let dialog = f.render().find((n) => n.type === "confirm");
    dialog.props.onConfirm();
    assert.equal(f.calls.length, 0);
    f.render()
      .find((n) => n.type === "select")
      .props.onChange({ target: { value: "CUSTOMER_REQUEST" } });
    f.render()
      .find((n) => n.type === "textarea")
      .props.onChange({ target: { value: "  Internal only  " } });
    dialog = f.render().find((n) => n.type === "confirm");
    assert.ok(JSON.stringify(dialog.props.children).includes("145000"));
    dialog.props.onConfirm();
    await tick();
    assert.deepEqual(f.calls[0].slice(0, 2), [
      "orders/STZ-FIXTURE/cancel",
      "POST",
    ]);
    assert.equal(f.calls[0][2].reason, "CUSTOMER_REQUEST");
    assert.equal(f.calls[0][2].note, "Internal only");
  });
test("submitted proof and blocked order do not expose cancellation; disabled confirmation cannot mutate; refresh cannot crash open dialog", () => {
  const f = fixture();
  f.state[0].hasSubmitted = true;
  f.state[0].canCancel = false;
  assert.equal(
    f
      .render()
      .some(
        (n) =>
          n.type === "button" && n.props.children === f.t("lifecycleCancel"),
      ),
    false,
  );
  f.state[2] = "cancel";
  f.props.disabled = true;
  f.render()
    .find((n) => n.type === "confirm")
    .props.onConfirm();
  assert.equal(f.calls.length, 0);
  f.state[0] = null;
  assert.doesNotThrow(() => f.render());
});
test("refund completion confirms manual transfer and immutable amount; completed refund is read-only", async () => {
  const f = fixture();
  Object.assign(f.state[0], {
    status: "CANCELLED",
    canCancel: false,
    refund: { id: "refund", amount: 145000, status: "PENDING" },
  });
  f.render()
    .find(
      (n) =>
        n.type === "button" && n.props.children === f.t("lifecycleRefundDone"),
    )
    .props.onClick();
  f.render()
    .find((n) => n.type === "input")
    .props.onChange({ target: { value: "bank-reference" } });
  f.render()
    .find((n) => n.type === "confirm")
    .props.onConfirm();
  await tick();
  assert.equal(f.calls[0][0], "finance/refunds/refund/complete");
  assert.equal(f.calls[0][2].reference, "bank-reference");
  assert.equal("amount" in f.calls[0][2], false);
  f.state[0].refund.status = "COMPLETED";
  assert.equal(
    f
      .render()
      .some(
        (n) =>
          n.type === "button" &&
          n.props.children === f.t("lifecycleRefundDone"),
      ),
    false,
  );
});

for (const [locale, expected] of [
  ["ru", "Загрузка возвратов…"],
  ["uz", "Qaytarishlar yuklanmoqda…"],
])
  test(`QA-003 refunds loading is localized correctly in ${locale}`, () => {
    const { Refunds } = load("../src/components/finance/Refunds.tsx", {
      react: { useState: (initial) => [initial, () => {}], useEffect() {} },
      "../AdminFrame": { AdminFrame: "frame" },
      "../Preferences": {
        usePreferences: () => ({ locale, t: (key) => messages[locale][key] }),
      },
      "../../lib/api": {
        api: () => {
          throw Error("must not fetch during render");
        },
        errorKey: () => "error",
      },
      "../../lib/orders": { uzs: String, dateTime: String },
    });
    const tree = nodes(Refunds({ csrfToken: "fixture" }));
    assert.equal(
      tree.find((n) => n.props?.role === "status").props.children,
      expected,
    );
    assert.ok(
      !tree.some((n) => n.props?.children === messages[locale].loading),
    );
  });
