import type { Locale } from "./i18n";

export type ThemeMode = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";
export type Preferences = {
  locale: Locale;
  themeMode: ThemeMode;
  resolvedTheme: ResolvedTheme;
};

export const preferenceKeys = {
  locale: "stenzo.locale",
  themeMode: "stenzo.theme",
} as const;
export const serverPreferences: Preferences = {
  locale: "uz",
  themeMode: "system",
  resolvedTheme: "dark",
};

/** Self-contained so the same resolver also runs inline before the first paint. */
export function readPreferences(
  keys: { locale: string; themeMode: string },
  overrides?: { locale?: Locale; themeMode?: ThemeMode },
): Preferences {
  const read = (key: string) => {
    try {
      return window.localStorage.getItem(key);
    } catch {
      return null;
    }
  };
  const webApp = window.Telegram?.WebApp;
  const savedLocale = overrides?.locale ?? read(keys.locale);
  const savedTheme = overrides?.themeMode ?? read(keys.themeMode);
  const locale =
    savedLocale === "ru" || savedLocale === "uz" ? savedLocale : "uz";
  const themeMode =
    savedTheme === "dark" || savedTheme === "light" ? savedTheme : "system";
  // The SDK exists in ordinary browsers too, with platform="unknown" and no initData.
  const telegramTheme =
    webApp && (webApp.platform !== "unknown" || Boolean(webApp.initData))
      ? webApp.colorScheme
      : undefined;
  const systemTheme =
    telegramTheme === "light" || telegramTheme === "dark"
      ? telegramTheme
      : window.matchMedia?.("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light";
  return {
    locale,
    themeMode,
    resolvedTheme: themeMode === "system" ? systemTheme : themeMode,
  };
}

export function applyPreferences(preferences: Preferences) {
  const root = document.documentElement;
  root.lang = preferences.locale;
  root.dataset.locale = preferences.locale;
  root.dataset.theme = preferences.resolvedTheme;
  root.dataset.themeMode = preferences.themeMode;
}

export function savePreference(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* Settings still work in memory if storage is unavailable. */
  }
}

// This is trusted, static application code; no initData or user value is interpolated.
export const preferenceScript = `(${applyPreferences.toString()})((${readPreferences.toString()})(${JSON.stringify(preferenceKeys)}));`;
