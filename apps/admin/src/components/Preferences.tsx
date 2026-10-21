"use client";
import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { messages, dashboardCopy, type MessageKey } from "../lib/i18n";

type Locale = "ru" | "uz";
type Theme = "dark" | "light" | "system";
const PreferencesContext = createContext<{
  locale: Locale;
  theme: Theme;
  setLocale: (value: Locale) => void;
  setTheme: (value: Theme) => void;
  t: (key: MessageKey) => string;
} | null>(null);
export const preferenceScript = `try{var l=localStorage.getItem('stenzo.locale'),t=localStorage.getItem('stenzo.theme');document.documentElement.lang=l==='uz'?'uz':'ru';document.documentElement.dataset.theme=t==='light'||t==='dark'?t:matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'}catch{}`;

export function Preferences({ children }: { children: ReactNode }) {
  const [locale, setLocale] = useState<Locale>("ru");
  const [theme, setTheme] = useState<Theme>("system");
  useEffect(() => {
    try {
      setLocale(localStorage.getItem("stenzo.locale") === "uz" ? "uz" : "ru");
      const saved = localStorage.getItem("stenzo.theme");
      setTheme(saved === "dark" || saved === "light" ? saved : "system");
    } catch {
      /* Preferences remain available in memory. */
    }
  }, []);
  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const sync = () => {
      document.documentElement.lang = locale;
      document.documentElement.dataset.theme =
        theme === "system" ? (media.matches ? "dark" : "light") : theme;
    };
    sync();
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, [locale, theme]);
  const persist = (key: string, value: string) => {
    try {
      localStorage.setItem(key, value);
    } catch {
      /* Optional storage. */
    }
  };
  return (
    <PreferencesContext.Provider
      value={{
        locale,
        theme,
        setLocale: (value) => {
          persist("stenzo.locale", value);
          setLocale(value);
        },
        setTheme: (value) => {
          persist("stenzo.theme", value);
          setTheme(value);
        },
        t: (key) => messages[locale][key],
      }}
    >
      {children}
    </PreferencesContext.Provider>
  );
}
export function usePreferences() {
  const value = useContext(PreferencesContext);
  if (!value) throw new Error("Preferences provider required");
  return value;
}
export function PreferenceControls({
  russian = false,
}: { russian?: boolean } = {}) {
  const {
    locale,
    theme,
    setLocale,
    setTheme,
    t: preferredCopy,
  } = usePreferences();
  const t = russian ? dashboardCopy : preferredCopy;
  return (
    <div className="preferences">
      <select
        aria-label={t("language")}
        title={russian ? t("dashboardOtherLanguage") : undefined}
        value={locale}
        onChange={(event) => setLocale(event.target.value as Locale)}
      >
        <option value="ru">RU</option>
        <option value="uz">UZ</option>
      </select>
      <select
        aria-label={t("theme")}
        value={theme}
        onChange={(event) => setTheme(event.target.value as Theme)}
      >
        <option value="system">{t("system")}</option>
        <option value="dark">{t("dark")}</option>
        <option value="light">{t("light")}</option>
      </select>
    </div>
  );
}
