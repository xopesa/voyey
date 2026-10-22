import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import { URL } from "node:url";
import ts from "typescript";

function loadModule(file, globals = {}) {
  const source = readFileSync(
    new URL(`../src/lib/${file}`, import.meta.url),
    "utf8",
  );
  const code = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  const exports = {};
  runInNewContext(code, { exports, ...globals });
  return exports;
}

function environment({
  saved = {},
  telegram,
  darkDevice = false,
  blocked = false,
} = {}) {
  const values = new Map(Object.entries(saved));
  const root = { lang: "ru", dataset: {} };
  const device = { matches: darkDevice };
  const window = {
    Telegram: telegram ? { WebApp: telegram } : undefined,
    matchMedia: () => device,
    localStorage: {
      getItem(key) {
        if (blocked) throw new Error("Storage unavailable");
        return values.get(key) ?? null;
      },
      setItem(key, value) {
        if (blocked) throw new Error("Storage unavailable");
        values.set(key, value);
      },
    },
  };
  const document = { documentElement: root };
  const module = loadModule("preferences.ts", { window, document });
  return {
    module,
    window,
    document,
    values,
    device,
    read: (overrides) =>
      module.readPreferences(module.preferenceKeys, overrides),
  };
}

test("locale defaults to UZ, and all uz language tags choose Uzbek Latin", () => {
  assert.equal(environment().read().locale, "uz");
  for (const language_code of ["uz", "uz-Latn", "UZ-uz"]) {
    assert.equal(
      environment({
        telegram: { initDataUnsafe: { user: { language_code } } },
      }).read().locale,
      "uz",
    );
  }
  assert.equal(
    environment({
      telegram: { initDataUnsafe: { user: { language_code: "en" } } },
    }).read().locale,
    "uz",
  );
  assert.equal(
    environment({
      telegram: { initDataUnsafe: { user: { language_code: "ru-RU" } } },
    }).read().locale,
    "uz",
  );
});

test("saved locale wins over Telegram and invalid saved values are ignored", () => {
  assert.equal(
    environment({
      saved: { "voyey.locale": "ru" },
      telegram: { initDataUnsafe: { user: { language_code: "uz" } } },
    }).read().locale,
    "ru",
  );
  assert.equal(
    environment({
      saved: { "voyey.locale": "invalid", "voyey.theme": "invalid" },
    }).read().themeMode,
    "system",
  );
});

test("system uses Telegram first, then device, ignoring the ordinary-browser SDK stub", () => {
  assert.equal(
    environment({
      telegram: { colorScheme: "light", platform: "android" },
      darkDevice: true,
    }).read().resolvedTheme,
    "light",
  );
  assert.equal(
    environment({ telegram: { colorScheme: "dark", platform: "ios" } }).read()
      .resolvedTheme,
    "dark",
  );
  assert.equal(
    environment({
      telegram: { colorScheme: "light", platform: "unknown", initData: "" },
      darkDevice: true,
    }).read().resolvedTheme,
    "dark",
  );
  assert.equal(environment({ darkDevice: true }).read().resolvedTheme, "dark");
  assert.equal(environment().read().resolvedTheme, "light");
});

test("explicit choices win over Telegram and device theme changes", () => {
  const env = environment({
    saved: { "voyey.theme": "dark" },
    telegram: { colorScheme: "light", platform: "android" },
  });
  assert.equal(env.read().resolvedTheme, "dark");
  env.window.Telegram.WebApp.colorScheme = "dark";
  assert.equal(env.read({ themeMode: "light" }).resolvedTheme, "light");
  assert.equal(env.read({ themeMode: "system" }).resolvedTheme, "dark");
  env.window.Telegram.WebApp.colorScheme = "light";
  assert.equal(env.read({ themeMode: "system" }).resolvedTheme, "light");
});

test("storage errors preserve working in-memory settings", () => {
  const env = environment({ blocked: true });
  assert.doesNotThrow(() => env.module.savePreference("voyey.theme", "dark"));
  assert.equal(
    env.read({ locale: "uz", themeMode: "dark" }).resolvedTheme,
    "dark",
  );
  assert.equal(env.read({ locale: "uz", themeMode: "dark" }).locale, "uz");
});

test("inline initialization applies saved preferences before hydration", () => {
  const env = environment({
    saved: { "voyey.locale": "uz", "voyey.theme": "dark" },
  });
  runInNewContext(env.module.preferenceScript, {
    window: env.window,
    document: env.document,
  });
  assert.equal(env.document.documentElement.lang, "uz");
  assert.equal(env.document.documentElement.dataset.theme, "dark");
  assert.equal(env.document.documentElement.dataset.themeMode, "dark");
});

test("saved choices survive a new initialization", () => {
  const env = environment();
  env.module.savePreference(env.module.preferenceKeys.locale, "uz");
  env.module.savePreference(env.module.preferenceKeys.themeMode, "light");
  assert.equal(env.read().locale, "uz");
  assert.equal(env.read().resolvedTheme, "light");
});

test("dictionary keys match, interpolation and catalog field selection work", () => {
  const { messages, translate, localizedText } = loadModule("i18n.ts");
  assert.deepEqual(
    Object.keys(messages.ru).sort(),
    Object.keys(messages.uz).sort(),
  );
  assert.equal(
    translate("ru", "nav.cartCount", { label: "Корзина", count: 3 }),
    "Корзина, товаров: 3",
  );
  assert.equal(localizedText("uz", { ru: "Куртка", uz: "Kurtka" }), "Kurtka");
  assert.equal(localizedText("uz", { ru: "Куртка", uz: null }), "Куртка");
});
