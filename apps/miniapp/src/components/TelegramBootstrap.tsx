"use client";

import { useEffect, useState } from "react";
import { usePreferences } from "./PreferencesProvider";
import { useTelegramSession } from "./TelegramSession";

import {
  bootstrapTelegramSession,
  type BootstrapState,
} from "../lib/telegram-session";

export function TelegramBootstrap() {
  const { t, applyServerLocale } = usePreferences();
  const [state, setState] = useState<BootstrapState>({ status: "loading" });
  const { setStatus } = useTelegramSession();
  useEffect(() => setStatus(state.status), [state.status, setStatus]);

  useEffect(() => {
    const controller = new AbortController();

    async function bootstrap(): Promise<void> {
      const webApp = window.Telegram?.WebApp;
      webApp?.ready();
      webApp?.expand();

      const result = await bootstrapTelegramSession(
        webApp?.initData,
        controller.signal,
      );
      if (result && !controller.signal.aborted) {
        if (result.status === "authenticated")
          applyServerLocale(result.user.preferredLocale);
        setState(result);
      }
    }

    void bootstrap();
    return () => controller.abort();
  }, [applyServerLocale]);

  if (state.status === "loading") {
    return <p role="status">{t("session.loading")}</p>;
  }
  if (state.status === "outside-telegram") {
    return <p>{t("session.outside")}</p>;
  }
  if (state.status === "error") {
    return (
      <p role="alert">
        {t(
          state.reason === "unavailable"
            ? "session.unavailable"
            : "session.error",
        )}
      </p>
    );
  }

  const displayName =
    state.user.firstName ??
    state.user.username ??
    `ID ${state.user.telegramId}`;
  return <p>{t("session.active", { name: displayName })}</p>;
}
