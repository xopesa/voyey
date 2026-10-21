"use client";
import { PreferenceControls, usePreferences } from "./Preferences";
import type { ReactNode } from "react";
import { dashboardCopy } from "../lib/i18n";
export function Header({
  children,
  dashboard = false,
  styled = false,
}: {
  children?: ReactNode;
  dashboard?: boolean;
  styled?: boolean;
}) {
  const { t: preferredCopy } = usePreferences();
  const t = dashboard ? dashboardCopy : preferredCopy;
  const modern = dashboard || styled;
  return (
    <header className="header">
      <a className="brand" href="/admin/">
        STENZO <span>{modern ? "WEAR" : "ADMIN"}</span>
      </a>
      <div className="header-controls">
        <PreferenceControls russian={dashboard} />
        {modern && (
          <div className="dashboard-principal">
            <span className="dashboard-avatar" aria-hidden="true">
              S
            </span>
            <div>
              <strong>{t("dashboardAdmin")}</strong>
              <small>{t("dashboardPanel")}</small>
            </div>
          </div>
        )}
        {children}
      </div>
    </header>
  );
}
