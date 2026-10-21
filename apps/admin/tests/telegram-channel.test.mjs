import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { URL } from "node:url";
import ts from "typescript";
import * as React from "react";
import * as jsx from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";
const { AbortController } = globalThis;
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
    { exports, AbortController, ...globals },
  );
  return exports;
}
const dictionaries = load("lib/i18n.ts").messages;
const channel = load("lib/telegram-channel.ts");
function component(publication, locale = "uz", options = {}) {
  let state = 0;
  const requests = [];
  const react = {
    ...React,
    useEffect: () => {},
    useState: () => [
      state++ === 0 ? publication : state === 2 ? false : undefined,
      () => {},
    ],
  };
  const dependencies = {
    react,
    "react/jsx-runtime": jsx,
    "../Preferences": {
      usePreferences: () => ({ locale, t: (key) => dictionaries[locale][key] }),
    },
    "../../lib/telegram-channel": channel,
    "../../lib/api": {
      api: async (path, init) => {
        requests.push({ path, init });
        return { publication: { status: "PUBLISHED", retryAllowed: false } };
      },
      errorKey: () => "error",
    },
  };
  const { TelegramChannel } = load("components/products/TelegramChannel.tsx", {
    require: (name) => dependencies[name],
  });
  const tree = TelegramChannel({
    publishToChannel: true,
    onPublishToChannelChange: () => {},
    productId: "synthetic-product",
    active: true,
    csrfToken: "synthetic-csrf",
    disabled: false,
    revision: {},
    onBusyChange: () => {},
    ...options,
  });
  return { tree, requests, html: renderToStaticMarkup(tree) };
}
test("RU/UZ publication states and safe errors have complete translations", () => {
  for (const locale of ["uz", "ru"]) {
    for (const status of Object.keys(channel.channelStatusKeys)) {
      const result = component(
        { status, retryAllowed: status === "FAILED" },
        locale,
      );
      assert.ok(
        result.html.includes(
          dictionaries[locale][channel.channelStatusKeys[status]],
        ),
      );
    }
    for (const key of Object.values(channel.channelErrorKeys))
      assert.ok(dictionaries[locale][key]);
  }
});
test("PUBLISHED/PENDING and missing configuration disable publication rather than repost", () => {
  for (const status of ["PUBLISHED", "PENDING", "NOT_CONFIGURED"]) {
    assert.match(
      component({ status, retryAllowed: false }).html,
      /<button[^>]+disabled/,
    );
  }
});
test("FAILED retry uses only protected Admin API and the existing CSRF header", async () => {
  const f = component({
    status: "FAILED",
    errorCode: "PHOTO_UNAVAILABLE",
    retryAllowed: true,
  });
  const button = React.Children.toArray(f.tree.props.children).find(
    (child) => child.type === "button",
  );
  await button.props.onClick();
  assert.equal(f.requests.length, 1);
  assert.equal(
    f.requests[0].path,
    "catalog/products/synthetic-product/telegram/publish",
  );
  assert.equal(f.requests[0].init.method, "POST");
  assert.equal(f.requests[0].init.headers["x-csrf-token"], "synthetic-csrf");
});
test("uncertain delivery shows reconciliation guidance and keeps retry disabled", () => {
  const result = component(
    {
      status: "PENDING",
      errorCode: "DELIVERY_UNCONFIRMED",
      retryAllowed: false,
    },
    "ru",
  );
  assert.match(result.html, /повторная отправка заблокирована/);
  assert.match(result.html, /<button[^>]+disabled/);
});

test("unchecked channel choice disables manual publishing and its handler cannot send", async () => {
  const f = component({ status: "NOT_PUBLISHED", retryAllowed: true }, "ru", {
    publishToChannel: false,
  });
  assert.ok(f.html.includes(dictionaries.ru.channelAlsoPublish));
  const button = React.Children.toArray(f.tree.props.children).find(
    (child) => child.type === "button",
  );
  assert.equal(button.props.disabled, true);
  await button.props.onClick();
  assert.equal(f.requests.length, 0);
});
