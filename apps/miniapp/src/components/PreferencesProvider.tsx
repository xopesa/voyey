"use client";

import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  useCallback,
  type ReactNode,
} from "react";
import {
  localizedText,
  translate,
  type Locale,
  type TranslationKey,
} from "../lib/i18n";
import {
  applyPreferences,
  preferenceKeys,
  readPreferences,
  savePreference,
  serverPreferences,
  type Preferences,
  type ThemeMode,
} from "../lib/preferences";
import { useTelegramSession } from "./TelegramSession";
import { createLocaleSync } from "../lib/locale-sync";
import { readAccessToken } from "../lib/auth-storage";
import { updateUserLocale } from "../lib/api-client";

type PreferencesContextValue = Preferences & {
  ready: boolean;
  setLocale: (locale: Locale) => void;
  applyServerLocale: (locale: Locale) => void;
  localeSaveError: boolean;
  setThemeMode: (mode: ThemeMode) => void;
  t: (key: TranslationKey, values?: Record<string, string | number>) => string;
  localizedText: (values: Record<Locale, string | null | undefined>) => string;
};

const PreferencesContext = createContext<PreferencesContextValue | null>(null);

export function PreferencesProvider({ children }: { children: ReactNode }) {
  const [preferences, setPreferences] = useState(serverPreferences);
  const [ready, setReady] = useState(false);
  const current = useRef(preferences);
  const { status } = useTelegramSession();
  const [localeSaveError, setLocaleSaveError] = useState(false);

  const commit = useCallback((next: Preferences) => {
    current.current = next;
    applyPreferences(next);
    setPreferences(next);
  }, []);

  const sync = useRef<ReturnType<typeof createLocaleSync> | null>(null);
  if (!sync.current)
    sync.current = createLocaleSync({
      apply(locale) {
        savePreference(preferenceKeys.locale, locale);
        commit({ ...current.current, locale });
      },
      async save(locale) {
        const token = readAccessToken();
        if (!token || !window.Telegram?.WebApp?.initData)
          throw new Error("Session unavailable");
        const { user } = await updateUserLocale(locale, token);
        return user.preferredLocale;
      },
      onError: setLocaleSaveError,
    });
  const applyServerLocale = useCallback((locale: Locale) => {
    sync.current!.applyServerLocale(locale);
  }, []);

  useEffect(() => {
    function update(next: Preferences) {
      current.current = next;
      applyPreferences(next);
      setPreferences(next);
    }
    update(readPreferences(preferenceKeys));
    setReady(true);
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const webApp = window.Telegram?.WebApp;
    const syncSystemTheme = () =>
      update(readPreferences(preferenceKeys, current.current));
    const syncStorage = (event: StorageEvent) => {
      if (
        event.key === null ||
        event.key === preferenceKeys.locale ||
        event.key === preferenceKeys.themeMode
      ) {
        update(readPreferences(preferenceKeys));
      }
    };
    webApp?.onEvent?.("themeChanged", syncSystemTheme);
    media.addEventListener("change", syncSystemTheme);
    window.addEventListener("storage", syncStorage);
    return () => {
      webApp?.offEvent?.("themeChanged", syncSystemTheme);
      media.removeEventListener("change", syncSystemTheme);
      window.removeEventListener("storage", syncStorage);
    };
  }, []);

  const value: PreferencesContextValue = {
    ...preferences,
    ready,
    localeSaveError,
    applyServerLocale,
    setLocale(locale) {
      void sync.current!.changeLocale(
        locale,
        status === "authenticated" &&
          Boolean(window.Telegram?.WebApp?.initData),
      );
    },
    setThemeMode(themeMode) {
      savePreference(preferenceKeys.themeMode, themeMode);
      commit(
        readPreferences(preferenceKeys, {
          locale: current.current.locale,
          themeMode,
        }),
      );
    },
    t: (key, values) => translate(preferences.locale, key, values),
    localizedText: (values) => localizedText(preferences.locale, values),
  };

  return (
    <PreferencesContext.Provider value={value}>
      {children}
    </PreferencesContext.Provider>
  );
}

export function usePreferences() {
  const context = useContext(PreferencesContext);
  if (!context) throw new Error("usePreferences requires PreferencesProvider");
  return context;
}
