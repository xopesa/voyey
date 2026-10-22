import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { setImmediate } from "node:timers/promises";
import { URL } from "node:url";
import ts from "typescript";
const { Headers, AbortController } = globalThis;

function load(path, globals = {}) {
  const code = ts.transpileModule(
    readFileSync(new URL("../src/" + path, import.meta.url), "utf8"),
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
const { createLocaleSync } = load("lib/locale-sync.ts");

test("server locale overrides stale local choice; outside Telegram changes stay local", async () => {
  const applied = [],
    saved = [];
  const sync = createLocaleSync({
    apply: (v) => applied.push(v),
    save: async (v) => {
      saved.push(v);
      return v;
    },
    onError: () => {},
  });
  sync.applyServerLocale("uz");
  await sync.changeLocale("ru", false);
  assert.deepEqual(applied, ["uz", "ru"]);
  assert.deepEqual(saved, []);
});
test("authenticated rapid UZ/RU changes are serialized and latest locale persists", async () => {
  let current,
    active = 0;
  const saved = [];
  const sync = createLocaleSync({
    apply: (v) => {
      current = v;
    },
    save: async (v) => {
      assert.equal(active++, 0);
      await setImmediate();
      saved.push(v);
      active--;
      return v;
    },
    onError: () => {},
  });
  sync.applyServerLocale("uz");
  await Promise.all([
    sync.changeLocale("ru", true),
    sync.changeLocale("uz", true),
  ]);
  assert.deepEqual(saved, ["ru", "uz"]);
  assert.equal(current, "uz");
});
test("failed persistence rolls back to last server locale and allows a later retry", async () => {
  let current,
    failed,
    reject = true;
  const sync = createLocaleSync({
    apply: (v) => {
      current = v;
    },
    save: async (v) => {
      if (reject) throw new Error("network");
      return v;
    },
    onError: (v) => {
      failed = v;
    },
  });
  sync.applyServerLocale("uz");
  await sync.changeLocale("ru", true);
  assert.equal(current, "uz");
  assert.equal(failed, true);
  reject = false;
  await sync.changeLocale("ru", true);
  assert.equal(current, "ru");
  assert.equal(failed, false);
});

// Exercise the real Provider -> API client and Bootstrap -> Provider wiring,
// with browser storage, fetch and React effects isolated from a real account.
function mounted({
  authenticated = true,
  initData = authenticated ? "synthetic-test-input" : "",
} = {}) {
  const values = new Map([
    ["voyey.locale", "ru"],
    ["voyey.theme", "dark"],
  ]);
  const requests = [],
    effects = [];
  let context;
  const document = { documentElement: { lang: "uz", dataset: {} } };
  const window = {
    localStorage: {
      getItem: (k) => values.get(k) ?? null,
      setItem: (k, v) => values.set(k, v),
    },
    sessionStorage: {
      getItem: () => (authenticated ? "synthetic-local-jwt" : null),
      setItem: () => {},
      removeItem: () => {},
    },
    Telegram: {
      WebApp: {
        initData,
        initDataUnsafe: { user: { language_code: "ru" } },
        platform: "android",
        colorScheme: "light",
        ready() {},
        expand() {},
      },
    },
    matchMedia: () => ({
      matches: false,
      addEventListener() {},
      removeEventListener() {},
    }),
    addEventListener() {},
    removeEventListener() {},
  };
  const react = {
    createContext: () => ({ Provider: "provider" }),
    useContext: () => context,
    useCallback: (f) => f,
    useRef: (v) => ({ current: v }),
    useState: (v) => [v, () => {}],
    useEffect: (f) => effects.push(f),
  };
  const i18n = load("lib/i18n.ts");
  const storage = load("lib/auth-storage.ts", { window });
  const user = { id: "test", telegramId: "91001", preferredLocale: "uz" };
  const api = load("lib/api-client.ts", {
    require: () => ({}),
    fetch: async (url, init) => {
      requests.push({ url, init });
      return {
        ok: true,
        json: async () => ({
          user: {
            ...user,
            preferredLocale:
              init.method === "PATCH"
                ? JSON.parse(init.body).locale
                : user.preferredLocale,
          },
        }),
      };
    },
  });
  const preferences = load("lib/preferences.ts", { window, document });
  const dependencies = {
    react,
    "react/jsx-runtime": {
      jsx: (_type, props) => {
        if (props.value) context = props.value;
        return props;
      },
    },
    "../lib/i18n": i18n,
    "../lib/preferences": preferences,
    "../lib/locale-sync": { createLocaleSync },
    "../lib/auth-storage": storage,
    "../lib/api-client": api,
    "./TelegramSession": {
      useTelegramSession: () => ({
        status: authenticated ? "authenticated" : "outside-telegram",
        setStatus() {},
      }),
    },
  };
  const provider = load("components/PreferencesProvider.tsx", {
    window,
    document,
    require: (name) => dependencies[name],
  });
  provider.PreferencesProvider({ children: null });
  effects.splice(0).forEach((f) => f());
  const bootstrap = load("lib/telegram-session.ts", {
    require: (name) => (name === "./api-client" ? api : storage),
  });
  const component = load("components/TelegramBootstrap.tsx", {
    window,
    require: (name) =>
      ({
        ...dependencies,
        "./PreferencesProvider": { usePreferences: () => context },
        "../lib/telegram-session": bootstrap,
      })[name],
  });
  return { document, requests, context, effects, component };
}
test("Telegram Bootstrap applies server UZ over local RU and Telegram RU metadata, preserving dark theme", async () => {
  const f = mounted();
  f.component.TelegramBootstrap();
  f.effects.splice(0).forEach((effect) => effect());
  await setImmediate();
  assert.equal(f.document.documentElement.lang, "uz");
  assert.equal(f.document.documentElement.dataset.theme, "dark");
  assert.equal(f.requests[0].url, "/api/me");
});
test("Profile provider language change sends authenticated PATCH and updates local UI", async () => {
  const f = mounted();
  f.context.setLocale("ru");
  await setImmediate();
  assert.equal(f.document.documentElement.lang, "ru");
  assert.equal(f.requests.length, 1);
  assert.equal(f.requests[0].url, "/api/me/preferences");
  assert.equal(f.requests[0].init.method, "PATCH");
  assert.equal(JSON.parse(f.requests[0].init.body).locale, "ru");
  assert.ok(f.requests[0].init.headers.has("Authorization"));
});
test("outside Telegram provider keeps language switch local and preserves theme", async () => {
  const f = mounted({ authenticated: false });
  f.context.setLocale("uz");
  await setImmediate();
  assert.equal(f.document.documentElement.lang, "uz");
  assert.equal(f.document.documentElement.dataset.theme, "dark");
  assert.equal(f.requests.length, 0);
});

test("stale authenticated context outside Telegram cannot trigger a preferences request", async () => {
  const f = mounted({ authenticated: true, initData: "" });
  f.context.setLocale("uz");
  await setImmediate();
  assert.equal(f.document.documentElement.lang, "uz");
  assert.equal(f.requests.length, 0);
});
