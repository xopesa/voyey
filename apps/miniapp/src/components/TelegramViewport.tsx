"use client";

import { useEffect } from "react";

export function TelegramViewport() {
  useEffect(() => {
    const webApp = window.Telegram?.WebApp;
    if (!webApp) return;
    const root = document.documentElement;
    const properties = new Set<string>();
    const setProperty = (name: string, value: number | undefined) => {
      if (value === undefined || !Number.isFinite(value) || value < 0) return;
      root.style.setProperty(name, `${value}px`);
      properties.add(name);
    };
    const syncViewport = () => {
      // Stable height keeps the floating board steady during Telegram's drag gesture.
      if (webApp.viewportStableHeight && webApp.viewportStableHeight > 0) {
        setProperty("--app-viewport-height", webApp.viewportStableHeight);
      }
      for (const edge of ["top", "right", "bottom", "left"] as const) {
        setProperty(
          `--tg-safe-area-inset-${edge}`,
          webApp.safeAreaInset?.[edge],
        );
        setProperty(
          `--tg-content-safe-area-inset-${edge}`,
          webApp.contentSafeAreaInset?.[edge],
        );
      }
    };
    syncViewport();
    const events = [
      "viewportChanged",
      "safeAreaChanged",
      "contentSafeAreaChanged",
    ] as const;
    for (const event of events) webApp.onEvent?.(event, syncViewport);
    window.addEventListener("resize", syncViewport);
    return () => {
      for (const event of events) webApp.offEvent?.(event, syncViewport);
      window.removeEventListener("resize", syncViewport);
      for (const property of properties) root.style.removeProperty(property);
    };
  }, []);
  return null;
}
