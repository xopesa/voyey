"use client";
import { useEffect, useState, type FormEvent } from "react";
import { AdminFrame } from "../AdminFrame";
import { api, ApiError } from "../../lib/api";
import {
  dashboardDate,
  dashboardQuery,
  type AdminDashboard,
  type DashboardRange,
} from "../../lib/dashboard";
import { orderStatusKey, uzs, type OrderStatus } from "../../lib/orders";
import { dashboardCopy, type MessageKey } from "../../lib/i18n";
import { DashboardChart } from "./DashboardChart";

export function Dashboard({ csrfToken }: { csrfToken: string }) {
  const t = dashboardCopy,
    locale = "ru";
  const [filters, setFilters] = useState({
    range: "7d" as DashboardRange,
    from: "",
    to: "",
  });
  const [query, setQuery] = useState("dashboard?range=7d");
  const [data, setData] = useState<AdminDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<MessageKey | null>(null);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    setData(null);
    api<AdminDashboard>(query, { signal: controller.signal })
      .then((result) => {
        if (!controller.signal.aborted) setData(result);
      })
      .catch((error) => {
        if (!controller.signal.aborted)
          setError(
            error instanceof ApiError && error.status === 400
              ? "dashboardInvalidPeriod"
              : "dashboardError",
          );
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [query, revision]);
  function filter(event: FormEvent) {
    event.preventDefault();
    setQuery(dashboardQuery(filters.range, filters.from, filters.to));
    setRevision((value) => value + 1);
  }
  const cards: {
    key: keyof AdminDashboard["kpis"];
    title: MessageKey;
    hint: MessageKey;
    icon: string;
    money?: boolean;
  }[] = [
    {
      key: "orders",
      title: "dashboardTotalOrders",
      hint: "dashboardSelectedPeriod",
      icon: "M4 6h16v14H4z M7 3v6 M17 3v6 M4 11h16",
    },
    {
      key: "receivedPayments",
      title: "dashboardReceived",
      hint: "dashboardApprovedOnly",
      icon: "M3 6h18v14H3z M3 10h18 M16 15h2",
      money: true,
    },
    {
      key: "awaitingReview",
      title: "dashboardAwaiting",
      hint: "dashboardCurrent",
      icon: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18 M12 7v5l3 2",
    },
    {
      key: "inProgress",
      title: "dashboardInProgress",
      hint: "dashboardProgressHint",
      icon: "M3 7h18v13H3z M8 7V4h8v3 M3 12h18",
    },
    {
      key: "activeProducts",
      title: "dashboardActiveProducts",
      hint: "dashboardCurrent",
      icon: "M3 7l9-4 9 4v10l-9 4-9-4z M3 7l9 4 9-4 M12 11v10",
    },
    {
      key: "lowStockVariants",
      title: "dashboardLowStock",
      hint: "dashboardLowStockHint",
      icon: "M12 3l10 18H2z M12 9v5 M12 17v1",
    },
  ];
  const catalogSummary = data && (
    <section className="dashboard-panel dashboard-catalog">
      <div className="dashboard-section-heading">
        <div>
          <h2>{t("dashboardProductSummary")}</h2>
          <p className="muted">{t("dashboardStockSummaryHint")}</p>
        </div>
      </div>
      <dl className="dashboard-summary">
        {(
          [
            ["total", "dashboardTotal"],
            ["active", "dashboardProductsActive"],
            ["draft", "dashboardDrafts"],
            ["inactive", "dashboardProductsInactive"],
            ["outOfStockVariants", "dashboardOutOfStock"],
            ["lowStockVariants", "dashboardFewLeft"],
          ] as const
        ).map(([key, label]) => {
          const stock =
            key === "outOfStockVariants" || key === "lowStockVariants";
          const denominator = stock
            ? data.products.outOfStockVariants + data.products.lowStockVariants
            : data.products.total;
          const share =
            denominator > 0
              ? Math.min(
                  100,
                  Math.round((data.products[key] / denominator) * 100),
                )
              : 0;
          return (
            <div key={key}>
              <dt>{t(label)}</dt>
              <dd>{uzs(data.products[key], locale)}</dd>
              <div
                className="dashboard-summary-meter"
                role="progressbar"
                aria-label={`${t(label)}. ${t(stock ? "dashboardStockShare" : "dashboardProductShare")}`}
                aria-valuenow={share}
                aria-valuemin={0}
                aria-valuemax={100}
              >
                <span style={{ width: `${share}%` }} />
              </div>
            </div>
          );
        })}
      </dl>
    </section>
  );
  return (
    <AdminFrame csrfToken={csrfToken} dashboard>
      <div className="dashboard">
        <div className="dashboard-top">
          <div className="page-heading">
            <div>
              <p className="eyebrow">{t("dashboardWelcomeLabel")}</p>
              <h1>{t("dashboardWelcome")}</h1>
              <p className="muted">
                {t("dashboardWelcomeBefore")}{" "}
                <span className="dashboard-brand-accent">STENZO WEAR</span>{" "}
                {t("dashboardWelcomeAfter")}
              </p>
            </div>
          </div>
          <form className="dashboard-filters" onSubmit={filter}>
            <label>
              <span className="sr-only">{t("dashboardPeriod")}</span>
              <span className="dashboard-period-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24">
                  <path d="M4 5h16v16H4z M8 2v6 M16 2v6 M4 11h16" />
                </svg>
              </span>
              <select
                value={filters.range}
                onChange={(e) =>
                  setFilters({
                    ...filters,
                    range: e.target.value as DashboardRange,
                  })
                }
              >
                <option value="today">{t("dashboardToday")}</option>
                <option value="7d">{t("dashboard7d")}</option>
                <option value="30d">{t("dashboard30d")}</option>
                <option value="custom">{t("dashboardCustom")}</option>
              </select>
            </label>
            {filters.range === "custom" && (
              <>
                <label>
                  {t("dashboardFrom")}
                  <input
                    type="date"
                    required
                    value={filters.from}
                    max={filters.to || undefined}
                    onChange={(e) =>
                      setFilters({ ...filters, from: e.target.value })
                    }
                  />
                </label>
                <label>
                  {t("dashboardTo")}
                  <input
                    type="date"
                    required
                    value={filters.to}
                    min={filters.from || undefined}
                    onChange={(e) =>
                      setFilters({ ...filters, to: e.target.value })
                    }
                  />
                </label>
              </>
            )}
            <button
              type="submit"
              className="dashboard-button"
              disabled={loading}
            >
              {t("dashboardShow")}
            </button>
            {data && (
              <p className="muted dashboard-period-label">
                {dashboardDate(data.period.from, locale)} —{" "}
                {dashboardDate(data.period.to, locale)}{" "}
                <span>· {t("dashboardTimezone")}</span>
              </p>
            )}
          </form>
        </div>
        {error && (
          <div className="dashboard-panel dashboard-error" role="alert">
            <p>{t(error)}</p>
            <button
              type="button"
              className="secondary"
              onClick={() => setRevision((value) => value + 1)}
            >
              {t("retry")}
            </button>
          </div>
        )}
        {loading && (
          <div
            className="dashboard-loading"
            role="status"
            aria-label={t("dashboardLoading")}
          >
            <div className="dashboard-kpis">
              {cards.map((card) => (
                <div
                  key={card.key}
                  className="dashboard-panel dashboard-skeleton"
                >
                  <span />
                  <span />
                </div>
              ))}
            </div>
            <div className="dashboard-analysis">
              <div className="dashboard-panel dashboard-skeleton dashboard-chart-skeleton" />
              <div className="dashboard-panel dashboard-skeleton dashboard-summary-skeleton">
                {[1, 2, 3, 4, 5, 6].map((row) => (
                  <span key={row} />
                ))}
              </div>
            </div>
            <div className="dashboard-bottom">
              <div className="dashboard-panel dashboard-skeleton dashboard-orders-skeleton" />
              <div className="dashboard-panel dashboard-skeleton dashboard-actions-skeleton" />
            </div>
          </div>
        )}
        {data && (
          <>
            <div className="dashboard-kpis">
              {cards.map((card) => (
                <section
                  className="dashboard-panel dashboard-kpi"
                  key={card.key}
                >
                  <div className="dashboard-kpi-heading">
                    <h2>{t(card.title)}</h2>
                    <span className="dashboard-icon" aria-hidden="true">
                      <svg viewBox="0 0 24 24">
                        <path d={card.icon} />
                      </svg>
                    </span>
                  </div>
                  <strong className="dashboard-number">
                    {uzs(data.kpis[card.key], locale)}
                    {card.money && <small> UZS</small>}
                  </strong>
                  <p className="muted">
                    {t(card.hint).replace(
                      "{threshold}",
                      String(data.products.lowStockThreshold),
                    )}
                  </p>
                </section>
              ))}
            </div>
            {data.profit && (
              <section
                className="dashboard-panel dashboard-profit"
                aria-labelledby="dashboard-profit-title"
              >
                <div>
                  <h2 id="dashboard-profit-title">{t("dashboardNetProfit")}</h2>
                  <p className="muted">{t("dashboardNetProfitHint")}</p>
                </div>
                <strong
                  className={`dashboard-number${data.profit.netProfit !== null && data.profit.netProfit < 0 ? " error" : ""}`}
                >
                  {data.profit.netProfit === null
                    ? "—"
                    : uzs(data.profit.netProfit, locale)}
                  {data.profit.netProfit !== null && <small> UZS</small>}
                </strong>
                {data.profit.incompleteOrders > 0 && (
                  <p className="notice" role="status">
                    {t("dashboardMissingCosts").replace(
                      "{count}",
                      String(data.profit.incompleteOrders),
                    )}
                  </p>
                )}
                <a className="dashboard-text-link" href="/admin/finance">
                  {t("dashboardProfitDetails")} →
                </a>
              </section>
            )}
            <div className="dashboard-analysis">
              <DashboardChart
                key={`${data.period.from}:${data.period.to}`}
                chart={data.chart}
              />
              {catalogSummary}
            </div>
            <div className="dashboard-bottom">
              <section
                className="dashboard-panel dashboard-recent"
                aria-labelledby="dashboard-latest-title"
              >
                <div className="dashboard-section-heading">
                  <div>
                    <h2 id="dashboard-latest-title">{t("dashboardLatest")}</h2>
                    <p className="muted">{t("dashboardLatestHint")}</p>
                  </div>
                  <a className="dashboard-text-link" href="/admin/orders">
                    {t("dashboardViewAll")} →
                  </a>
                </div>
                {data.latestOrders.length === 0 ? (
                  <p className="dashboard-empty">{t("noOrders")}</p>
                ) : (
                  <table className="dashboard-orders">
                    <thead>
                      <tr>
                        <th>{t("dashboardOrderNumber")}</th>
                        <th>{t("customer")}</th>
                        <th>{t("dashboardOrderTotal")}</th>
                        <th>{t("dashboardPaid")}</th>
                        <th>{t("status")}</th>
                        <th>{t("orderDate")}</th>
                        <th>{t("dashboardOrderAction")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.latestOrders.map((order) => (
                        <tr key={order.publicId}>
                          <td data-label={t("dashboardOrderNumber")}>
                            <strong>{order.publicId}</strong>
                          </td>
                          <td data-label={t("customer")}>{order.customer}</td>
                          <td data-label={t("dashboardOrderTotal")}>
                            {uzs(order.total, locale)} UZS
                          </td>
                          <td data-label={t("dashboardPaid")}>
                            {uzs(order.paid, locale)} UZS
                          </td>
                          <td data-label={t("status")}>
                            <span
                              className="badge dashboard-status"
                              data-tone={dashboardStatusTone(order.status)}
                            >
                              {t(orderStatusKey(order.status as OrderStatus))}
                            </span>
                          </td>
                          <td data-label={t("orderDate")}>
                            <time dateTime={order.createdAt}>
                              {dashboardDate(order.createdAt, locale, true)}
                            </time>
                          </td>
                          <td>
                            <a
                              className="dashboard-text-link"
                              href={`/admin/orders/${encodeURIComponent(order.publicId)}`}
                            >
                              {t("dashboardOpen")} →
                            </a>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </section>
              <section className="dashboard-panel dashboard-actions-panel">
                <div className="dashboard-section-heading">
                  <h2>{t("dashboardQuickActions")}</h2>
                </div>
                <div className="dashboard-quick-actions">
                  <a className="dashboard-button" href="/admin/products/new">
                    + {t("newProduct")}
                  </a>
                  <a className="dashboard-action" href="/admin/categories">
                    {t("categories")} →
                  </a>
                  <a className="dashboard-action" href="/admin/orders">
                    {t("dashboardAllOrders")} →
                  </a>
                  <a className="dashboard-action" href="/admin/telegram">
                    {t("telegram")} →
                  </a>
                  <a className="dashboard-action" href="/admin/finance">
                    {t("financeTitle")} →
                  </a>
                </div>
              </section>
            </div>
          </>
        )}
      </div>
    </AdminFrame>
  );
}

export function dashboardStatusTone(status: string) {
  if (status === "CANCELLED") return "danger";
  if (["COMPLETED", "PAID_FULL", "READY_TO_SHIP"].includes(status))
    return "success";
  if (["PURCHASED", "IN_TRANSIT", "ARRIVED", "SHIPPED"].includes(status))
    return "transport";
  return "waiting";
}
