import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { URL } from "node:url";
import { createRequire } from "node:module";
import { setImmediate } from "node:timers";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import * as shared from "@stenzo/shared";
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
      require: (name) => {
        if (name in deps) return deps[name];
        if (name === "@stenzo/shared") return shared;
        if (name === "react/jsx-runtime") return require(name);
        if (name.endsWith(".css")) return {};
        throw Error(name);
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
const row = {
  id: "isolated",
  code: "STENZO10",
  type: "PERCENT",
  value: 10,
  minOrderAmount: null,
  maxDiscount: null,
  startsAt: null,
  endsAt: null,
  usageLimit: 10,
  perUserLimit: 1,
  isActive: false,
  usageCount: 0,
  createdAt: "2026-10-20T00:00:00Z",
  updatedAt: "2026-10-20T00:00:00Z",
};
function fixture(locale = "ru") {
  const state = [[], null, false, false, null, false],
    calls = [],
    lock = { current: false };
  let cursor = 0,
    rows = [];
  const deps = {
    react: {
      useEffect() {},
      useRef: () => lock,
      useState: (initial) => {
        const i = cursor++;
        if (!(i in state)) state[i] = initial;
        return [
          state[i],
          (value) =>
            (state[i] = typeof value === "function" ? value(state[i]) : value),
        ];
      },
    },
    "../AdminFrame": { AdminFrame: "frame" },
    "../Preferences": {
      usePreferences: () => ({ locale, t: (k) => messages[locale][k] }),
    },
    "../../lib/api": {
      errorKey: () => "error",
      api: async (path, init = {}) => {
        calls.push([path, init]);
        if (!init.method) return { promoCodes: rows };
        if (path.endsWith("/activate")) rows[0].isActive = true;
        else rows = [{ ...row, ...(init.body ? JSON.parse(init.body) : {}) }];
        return { promoCode: rows[0] };
      },
    },
  };
  const module = load("../src/components/marketing/PromoCodes.tsx", deps);
  return {
    ...module,
    calls,
    state,
    t: (k) => messages[locale][k],
    render: () => {
      cursor = 0;
      return nodes(module.PromoCodeManager({ csrfToken: "fixture-csrf" }));
    },
    home: () =>
      nodes(
        load("../src/components/marketing/Banners.tsx", deps).MarketingHome({
          csrfToken: "fixture-csrf",
        }),
      ),
  };
}
test("Marketing home has two primary cards and an informational Products link", () => {
  const f = fixture();
  const links = f
    .home()
    .filter((n) => n.type === "a")
    .map((n) => n.props.href);
  assert.deepEqual(links, [
    "/admin/marketing/banners",
    "/admin/marketing/promo-codes",
    "/admin/products",
  ]);
});
test("promo editor UTC/Tashkent roundtrip, strict integer fields and percent/fixed modes", () => {
  const f = fixture(),
    draft = f.promoDraft({ ...row, startsAt: "2026-10-20T04:00:00Z" });
  assert.equal(draft.startsAt, "2026-10-20T09:00");
  const input = f.promoInput(draft);
  assert.equal(input.startsAt, "2026-10-20T04:00:00.000Z");
  for (const value of ["1.5", "1e3", "0", "2147483648"])
    assert.throws(() => f.promoInput({ ...draft, value }));
  assert.equal(
    f.promoInput({
      ...draft,
      code: " stenzo-20 ",
      type: "FIXED",
      value: "20000",
      maxDiscount: "100",
    }).maxDiscount,
    null,
  );
});
test("promo status uses explicit active/scheduled/expired/exhausted states", () => {
  const f = fixture();
  const now = Date.parse("2026-10-20T12:00:00Z");
  assert.equal(f.promoState(row, now), "promoInactive");
  assert.equal(f.promoState({ ...row, isActive: true }, now), "promoActive");
  assert.equal(
    f.promoState(
      { ...row, isActive: true, startsAt: "2026-10-21T00:00:00Z" },
      now,
    ),
    "promoScheduled",
  );
  assert.equal(
    f.promoState(
      { ...row, isActive: true, endsAt: "2026-10-20T12:00:00Z" },
      now,
    ),
    "promoExpired",
  );
  assert.equal(
    f.promoState({ ...row, isActive: true, usageCount: 10 }, now),
    "promoExhausted",
  );
});
for (const locale of ["ru", "uz"])
  test(`promo Admin ${locale}: explicit create/edit/activate use CSRF once; no hard delete`, async () => {
    const f = fixture(locale);
    let tree = f.render();
    assert.equal(f.calls.length, 0);
    tree
      .find((n) => n.type === "button" && n.props.children === f.t("newPromo"))
      .props.onClick();
    tree = f.render();
    const set = (label, value) => {
      const parent = f
        .render()
        .find((n) => n.type === "label" && n.props.children[0] === label);
      nodes(parent)
        .find((n) => n.type === "input")
        .props.onChange({ target: { value } });
    };
    set(f.t("promoCode"), "stenzo10");
    set(f.t("promo_value"), "10");
    const form = f.render().find((n) => n.type === "form");
    form.props.onSubmit({ preventDefault() {} });
    form.props.onSubmit({ preventDefault() {} });
    await new Promise(setImmediate);
    const writes = f.calls.filter(([, init]) => init.method);
    assert.equal(writes.length, 1);
    assert.equal(writes[0][1].method, "POST");
    assert.equal(writes[0][1].headers["x-csrf-token"], "fixture-csrf");
    assert.equal(JSON.parse(writes[0][1].body).code, "STENZO10");
    tree = f.render();
    assert.equal(
      tree.some(
        (n) => n.type === "button" && /delete/i.test(String(n.props.children)),
      ),
      false,
    );
    tree
      .find((n) => n.type === "button" && n.props.children === f.t("activate"))
      .props.onClick();
    await new Promise(setImmediate);
    assert.ok(
      f.calls.some(
        ([path, init]) =>
          path.endsWith("/activate") &&
          init.method === "POST" &&
          init.headers["x-csrf-token"] === "fixture-csrf",
      ),
    );
    tree = f.render();
    tree
      .find((n) => n.type === "button" && n.props.children === f.t("edit"))
      .props.onClick();
    set(f.t("promo_value"), "15");
    f.render()
      .find((n) => n.type === "form")
      .props.onSubmit({ preventDefault() {} });
    await new Promise(setImmediate);
    assert.ok(
      f.calls.some(
        ([path, init]) =>
          path === "marketing/promo-codes/isolated" &&
          init.method === "PATCH" &&
          JSON.parse(init.body).value === 15,
      ),
    );
    assert.equal(
      f.calls.some(([, init]) => init.method === "DELETE"),
      false,
    );
  });
