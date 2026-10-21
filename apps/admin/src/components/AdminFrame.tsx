"use client";
import { useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { Header } from "./Header";
import { usePreferences } from "./Preferences";
import { api, errorKey } from "../lib/api";
import { dashboardCopy, type MessageKey } from "../lib/i18n";
import "../styles/dashboard-v2.css";
import "../styles/admin-sections.css";

export function AdminNav({ dashboard = false }: { dashboard?: boolean } = {}) {
  const { t: preferredCopy } = usePreferences();
  const t = dashboard ? dashboardCopy : preferredCopy;
  const path = usePathname();
  const links = [
    [
      "/admin/",
      "/",
      "dashboardPanel",
      "M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z",
    ],
    [
      "/admin/orders",
      "/orders",
      "orders",
      "M3 3h2l3 12h11l2-9H6 M9 20h1 M17 20h1",
    ],
    [
      "/admin/products",
      "/products",
      "products",
      "M3 7l9-4 9 4v10l-9 4-9-4z M3 7l9 4 9-4 M12 11v10",
    ],
    [
      "/admin/categories",
      "/categories",
      "categories",
      "M3 3h9l9 9-9 9-9-9z M7 7h1",
    ],
    [
      "/admin/customers",
      "/customers",
      "customers",
      "M8 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z M2 21v-3a6 6 0 0 1 12 0v3 M17 4a4 4 0 0 1 0 8 M17 15a5 5 0 0 1 5 5",
    ],
    [
      "/admin/marketing",
      "/marketing",
      "marketing",
      "M3 9l18-5v16L3 15z M6 16l2 5h4l-2-5",
    ],
    [
      "/admin/finance",
      "/finance",
      "financeTitle",
      "M3 5h18v15H3z M3 9h18 M7 14h2 M15 14h2",
    ],
    [
      "/admin/telegram",
      "/telegram",
      "telegram",
      "M3 10l18-7-5 18-5-7-8-4z M11 14l10-11",
    ],
  ] as const;
  return (
    <nav className="nav dashboard-nav" aria-label={t("dashboardNav")}>
      <a className="dashboard-wordmark" href="/admin/" aria-label="STENZO WEAR">
        <strong>STENZO</strong>
        <span>WEAR</span>
      </a>
      <div className="dashboard-nav-links">
        {links.map(([href, prefix, label, icon]) => (
          <a
            key={href}
            href={href}
            aria-current={
              (prefix === "/" ? path === "/" : path.startsWith(prefix))
                ? "page"
                : undefined
            }
          >
            <svg aria-hidden="true" viewBox="0 0 24 24">
              <path d={icon} />
            </svg>
            {t(label)}
          </a>
        ))}
      </div>
      <p className="dashboard-nav-footer">
        STENZO WEAR <span>{t("dashboardPanel")}</span>
      </p>
    </nav>
  );
}
export function AdminFrame({
  csrfToken,
  children,
  preventLogout = false,
  dashboard = false,
}: {
  csrfToken: string;
  children: ReactNode;
  preventLogout?: boolean;
  dashboard?: boolean;
}) {
  const { t: preferredCopy, locale } = usePreferences();
  const t = dashboard ? dashboardCopy : preferredCopy;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<MessageKey | null>(null);
  async function logout() {
    if (preventLogout && !window.confirm(t("discardChanges"))) return;
    setBusy(true);
    try {
      await api("auth/logout", {
        method: "POST",
        headers: { "x-csrf-token": csrfToken },
      });
      window.location.replace("/cdn-cgi/access/logout");
    } catch (error) {
      setError(errorKey(error));
      setBusy(false);
    }
  }
  const frame = (
    <>
      <Header dashboard={dashboard} styled>
        <button className="quiet" onClick={logout} disabled={busy}>
          {t("logout")}
        </button>
      </Header>
      <div className="workspace">
        <AdminNav dashboard={dashboard} />
        <main className="content">
          {error && (
            <p role="alert" className="error">
              {t(error)}
            </p>
          )}
          {children}
        </main>
      </div>
    </>
  );
  return (
    <div
      className={
        dashboard
          ? "admin-dashboard-shell"
          : "admin-dashboard-shell admin-section-shell"
      }
      lang={dashboard ? "ru" : locale}
    >
      {frame}
    </div>
  );
}
