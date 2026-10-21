import assert from "node:assert/strict";
import test from "node:test";
import { URL } from "node:url";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import * as React from "react";
import * as jsxRuntime from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";
const { Headers, AbortController } = globalThis;
function load(file, globals = {}) {
  const code = ts.transpileModule(
    readFileSync(new URL("../src/" + file, import.meta.url), "utf8"),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        jsx: ts.JsxEmit.ReactJSX,
      },
    },
  ).outputText;
  const exports = {};
  runInNewContext(code, { exports, Headers, AbortController, ...globals });
  return exports;
}
const api = load("lib/api-client.ts", { require: () => ({}) });
const { bootstrapTelegramSession } = load("lib/telegram-session.ts", {
  require: (name) => (name === "./api-client" ? api : {}),
});
const user = {
  id: "test-user",
  telegramId: "42",
  firstName: "Local test",
  languageCode: "uz",
};
function fixture(override = {}) {
  const calls = { auth: 0, me: 0, stored: [], cleared: 0 };
  const dependencies = {
    readAccessToken: () => null,
    clearAccessToken: () => calls.cleared++,
    storeAccessToken: (value) => calls.stored.push(value),
    authenticateTelegram: async () => {
      calls.auth++;
      return { accessToken: "synthetic-test-only", user };
    },
    getCurrentUser: async () => {
      calls.me++;
      return { user };
    },
    ...override,
  };
  return {
    calls,
    dependencies,
    run: (
      initData = "signed-test-input",
      signal = new AbortController().signal,
    ) => bootstrapTelegramSession(initData, signal, dependencies),
  };
}
test("outside Telegram: no auth request, no stored token, stale token cleared", async () => {
  const f = fixture({ readAccessToken: () => "stale" });
  const result = await f.run("");
  assert.equal(result.status, "outside-telegram");
  assert.equal(f.calls.auth, 0);
  assert.equal(f.calls.me, 0);
  assert.equal(f.calls.stored.length, 0);
  assert.equal(f.calls.cleared, 1);
});
test("successful Telegram auth is the only path that stores a new access token", async () => {
  const f = fixture();
  assert.equal((await f.run()).status, "authenticated");
  assert.equal(f.calls.auth, 1);
  assert.deepEqual(f.calls.stored, ["synthetic-test-only"]);
});
for (const status of [400, 401, 403])
  test(
    "invalid auth HTTP " + status + " produces the invalid-session UI state",
    async () => {
      const f = fixture({
        authenticateTelegram: async () => {
          throw new api.ApiRequestError(status);
        },
      });
      const r = await f.run();
      assert.equal(r.status, "error");
      assert.equal(r.reason, "invalid-auth");
      assert.equal(f.calls.stored.length, 0);
    },
  );
for (const problem of [
  new api.ApiRequestError(503),
  new api.ApiRequestError(429),
  new TypeError("Network unavailable"),
])
  test(
    "API unavailable: " + problem.name + " " + (problem.status ?? "network"),
    async () => {
      const f = fixture({
        authenticateTelegram: async () => {
          throw problem;
        },
      });
      assert.equal((await f.run()).reason, "unavailable");
      assert.equal(f.calls.stored.length, 0);
    },
  );
test("valid cached token is checked with /me inside Telegram without issuing another token", async () => {
  const f = fixture({ readAccessToken: () => "cached" });
  assert.equal((await f.run()).status, "authenticated");
  assert.equal(f.calls.me, 1);
  assert.equal(f.calls.auth, 0);
  assert.equal(f.calls.stored.length, 0);
});
test("expired cached JWT is cleared before Telegram reauthentication", async () => {
  const f = fixture({
    readAccessToken: () => "expired",
    getCurrentUser: async () => {
      throw new api.ApiRequestError(401);
    },
  });
  assert.equal((await f.run()).status, "authenticated");
  assert.equal(f.calls.cleared, 1);
  assert.equal(f.calls.auth, 1);
});
test("temporary /me failure preserves token and does not retry auth in a loop", async () => {
  const f = fixture({
    readAccessToken: () => "cached",
    getCurrentUser: async () => {
      throw new api.ApiRequestError(503);
    },
  });
  assert.equal((await f.run()).reason, "unavailable");
  assert.equal(f.calls.cleared, 0);
  assert.equal(f.calls.auth, 0);
});
test("unmounted/aborted bootstrap never writes a late token", async () => {
  const controller = new AbortController();
  const f = fixture({
    authenticateTelegram: async () => {
      controller.abort();
      return { accessToken: "late-test-only", user };
    },
  });
  assert.equal(await f.run("signed", controller.signal), undefined);
  assert.equal(f.calls.stored.length, 0);
});
test("blocked sessionStorage is safe and cannot create a token outside Telegram", () => {
  const storage = load("lib/auth-storage.ts", {
    window: {
      get sessionStorage() {
        throw new Error("blocked");
      },
    },
  });
  assert.equal(storage.readAccessToken(), null);
  assert.doesNotThrow(() => storage.clearAccessToken());
  assert.doesNotThrow(() => storage.storeAccessToken("synthetic-test-only"));
});
const i18n = load("lib/i18n.ts");
function render(state, locale) {
  const dependencies = {
    react: { ...React, useState: () => [state, () => {}], useEffect: () => {} },
    "react/jsx-runtime": jsxRuntime,
    "./PreferencesProvider": {
      usePreferences: () => ({ t: (key) => i18n.translate(locale, key) }),
    },
    "./TelegramSession": {
      useTelegramSession: () => ({ setStatus: () => {} }),
    },
    "../lib/telegram-session": { bootstrapTelegramSession },
  };
  const { TelegramBootstrap } = load("components/TelegramBootstrap.tsx", {
    require: (name) => dependencies[name],
  });
  return renderToStaticMarkup(React.createElement(TelegramBootstrap));
}
test("RU/UZ rendered outside, invalid-session and unavailable messages are distinct and hide technical details", () => {
  for (const locale of ["ru", "uz"]) {
    const outside = render({ status: "outside-telegram" }, locale),
      invalid = render({ status: "error", reason: "invalid-auth" }, locale),
      unavailable = render({ status: "error", reason: "unavailable" }, locale);
    assert.match(outside, /Telegram/);
    assert.doesNotMatch(outside, /role="alert"/);
    assert.notEqual(invalid, unavailable);
    assert.match(invalid, /role="alert"/);
    assert.match(unavailable, /role="alert"/);
    assert.doesNotMatch(
      unavailable,
      /503|JWT|HMAC|TELEGRAM_BOT_TOKEN|initData/,
    );
  }
});
