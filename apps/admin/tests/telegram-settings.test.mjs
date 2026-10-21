import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import * as React from "react";
import * as jsx from "react/jsx-runtime";

function load(path, globals = {}) {
  const exports = {};
  runInNewContext(
    ts.transpileModule(
      readFileSync(new URL("../src/" + path, import.meta.url), "utf8"),
      {
        compilerOptions: {
          module: ts.ModuleKind.CommonJS,
          target: ts.ScriptTarget.ES2022,
          jsx: ts.JsxEmit.ReactJSX,
        },
      },
    ).outputText,
    { exports, ...globals },
  );
  return exports;
}
const messages = load("lib/i18n.ts").messages;
const row = {
  id: "synthetic",
  telegramId: "101",
  label: "Test",
  isActive: true,
  notifyNewOrders: true,
  notifyPayments: false,
  user: null,
  createdAt: "2026-10-17T00:00:00Z",
};
function fixture({ locale = "ru", id = "102", allowed = true } = {}) {
  const requests = [],
    errors = [],
    confirms = [];
  let state = 0;
  const stateValues = [[row], id, "Manager", false, false, null];
  const deps = {
    react: {
      ...React,
      useEffect() {},
      useState() {
        const index = state++;
        return [
          stateValues[index],
          (value) => {
            if (index === 5) errors.push(value);
          },
        ];
      },
    },
    "react/jsx-runtime": jsx,
    "@stenzo/shared": {
      validTelegramAdminId: (value) =>
        /^[1-9][0-9]{0,15}$/.test(value) &&
        BigInt(value) <= BigInt(Number.MAX_SAFE_INTEGER),
    },
    "./AdminFrame": {
      AdminFrame: ({ children }) => jsx.jsx("main", { children }),
    },
    "./Preferences": {
      usePreferences: () => ({ t: (key) => messages[locale][key] }),
    },
    "../lib/api": {
      api: async (path, init) => {
        requests.push({ path, init });
        return row;
      },
      errorKey: () => "error",
      ApiError: class extends Error {},
    },
  };
  const { TelegramSettings } = load("components/TelegramSettings.tsx", {
    require: (name) => deps[name],
    window: {
      confirm(text) {
        confirms.push(text);
        return allowed;
      },
    },
  });
  const tree = TelegramSettings({ csrfToken: "test-csrf" });
  function find(predicate, element = tree) {
    if (!element || typeof element !== "object") return [];
    const kids = React.Children.toArray(element.props?.children);
    return [
      ...(predicate(element) ? [element] : []),
      ...kids.flatMap((child) => find(predicate, child)),
    ];
  }
  return { tree, requests, errors, confirms, find };
}

test("Telegram settings localize RU/UZ labels and unlinked-user state", () => {
  for (const locale of ["ru", "uz"]) {
    const f = fixture({ locale });
    const nodes = f.find((element) => typeof element.type === "string");
    const visible = nodes
      .flatMap((node) =>
        React.Children.toArray(node.props.children).filter(
          (child) => typeof child === "string",
        ),
      )
      .join(" ");
    assert.ok(visible.includes(messages[locale].telegramUnlinked));
    assert.ok(visible.includes(messages[locale].telegramNewOrders));
    assert.ok(visible.includes(messages[locale].telegramDisable));
  }
});
test("create form validates ID and sends only ID/label with session CSRF", async () => {
  const f = fixture();
  await f
    .find((e) => e.type === "form")[0]
    .props.onSubmit({ preventDefault() {} });
  assert.equal(f.requests[0].path, "telegram/admins");
  assert.equal(f.requests[0].init.headers["x-csrf-token"], "test-csrf");
  assert.deepEqual(JSON.parse(f.requests[0].init.body), {
    telegramId: "102",
    label: "Manager",
  });
  const invalid = fixture({ id: "01" });
  await invalid
    .find((e) => e.type === "form")[0]
    .props.onSubmit({ preventDefault() {} });
  assert.equal(invalid.requests.length, 0);
  assert.ok(invalid.errors.includes("telegramInvalid"));
});
test("cancelled disable never mutates; confirmed disable carries CSRF", async () => {
  for (const allowed of [false, true]) {
    const f = fixture({ allowed });
    f.find(
      (e) =>
        e.type === "button" && e.props.children === messages.ru.telegramDisable,
    )[0].props.onClick();
    await Promise.resolve();
    assert.equal(f.confirms.length, 1);
    assert.equal(f.requests.length, allowed ? 1 : 0);
    if (allowed) {
      assert.equal(f.requests[0].init.method, "PATCH");
      assert.equal(f.requests[0].init.headers["x-csrf-token"], "test-csrf");
      assert.equal(JSON.parse(f.requests[0].init.body).isActive, false);
    }
  }
});
test("notification switches patch independent flags with CSRF", async () => {
  const f = fixture();
  const checkboxes = f.find(
    (e) => e.type === "input" && e.props.type === "checkbox",
  );
  checkboxes[0].props.onChange({ target: { checked: false } });
  await Promise.resolve();
  checkboxes[1].props.onChange({ target: { checked: true } });
  await Promise.resolve();
  assert.deepEqual(
    f.requests.map((r) => JSON.parse(r.init.body)),
    [{ notifyNewOrders: false }, { notifyPayments: true }],
  );
  assert.ok(
    f.requests.every((r) => r.init.headers["x-csrf-token"] === "test-csrf"),
  );
});
