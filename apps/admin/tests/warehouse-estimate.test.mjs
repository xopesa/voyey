import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import { URL } from "node:url";
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
      require: (name) => (name in deps ? deps[name] : require(name)),
    },
  );
  return exports;
}
const { messages } = load("lib/i18n.ts");
const nodes = (n) =>
  n && typeof n === "object"
    ? [n, ...[n.props?.children].flat(Infinity).flatMap(nodes)]
    : [];
for (const locale of ["ru", "uz"])
  test(`${locale}: manual warehouse date save/change/clear and terminal/busy guards`, async () => {
    let date,
      initialized = false;
    const calls = [];
    const { WarehouseEstimate } = load(
      "components/orders/WarehouseEstimate.tsx",
      {
        react: {
          useState: (initial) => {
            if (!initialized) {
              date = initial;
              initialized = true;
            }
            return [date, (value) => (date = value)];
          },
          useEffect() {},
        },
        "../Preferences": {
          usePreferences: () => ({ t: (key) => messages[locale][key] }),
        },
      },
    );
    const order = {
      publicId: "STZ-FIXTURE",
      status: "PURCHASED",
      estimatedWarehouseArrival: null,
    };
    const render = (props = {}) =>
      nodes(
        WarehouseEstimate({
          order,
          disabled: false,
          perform: async (...args) => {
            calls.push(args);
            return true;
          },
          ...props,
        }),
      );
    const input = (tree) => tree.find((n) => n.type === "input");
    const submit = (tree) =>
      tree
        .find((n) => n.type === "form")
        .props.onSubmit({ preventDefault() {} });
    const button = (tree) => tree.find((n) => n.type === "button");
    assert.equal(button(render()).props.disabled, true);
    assert.ok(
      render().some(
        (n) => n.props.children === messages[locale].warehouseEstimateHint,
      ),
    );
    input(render()).props.onChange({ target: { value: "2026-11-05" } });
    assert.equal(button(render()).props.disabled, false);
    await submit(render());
    assert.equal(calls[0][0], "orders/STZ-FIXTURE/warehouse-estimate");
    assert.equal(calls[0][1], "PATCH");
    assert.deepEqual(JSON.parse(JSON.stringify(calls[0][2])), {
      estimatedWarehouseArrival: "2026-11-05",
    });
    order.estimatedWarehouseArrival = "2026-11-05";
    assert.equal(button(render()).props.disabled, true);
    input(render()).props.onChange({ target: { value: "" } });
    await submit(render());
    assert.equal(calls[1][2].estimatedWarehouseArrival, null);
    const count = calls.length;
    await submit(render({ disabled: true }));
    for (const status of [
      "ARRIVED",
      "COMPLETED",
      "CANCELLED",
      "AWAITING_PREPAYMENT",
    ]) {
      const tree = render({ order: { ...order, status } });
      assert.equal(input(tree).props.disabled, true);
      assert.equal(button(tree), undefined);
      await submit(tree);
    }
    assert.equal(calls.length, count);
  });
