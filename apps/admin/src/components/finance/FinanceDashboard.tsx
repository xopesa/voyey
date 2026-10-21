"use client";
import { useEffect, useState } from "react";
import type { FinanceDashboard as Data, FinanceRange } from "@stenzo/shared";
import { AdminFrame } from "../AdminFrame";
import { usePreferences } from "../Preferences";
import { api, errorKey } from "../../lib/api";
import {
  dateTime,
  uzs,
  orderStatusKey,
  type OrderStatus,
} from "../../lib/orders";
import { financeQuery, financeChartGeometry } from "../../lib/finance";
import { dashboardDate } from "../../lib/dashboard";
import type { MessageKey } from "../../lib/i18n";
import "../../styles/finance.css";

export function FinanceDashboard({ csrfToken }: { csrfToken: string }) {
  const { t, locale } = usePreferences();
  const [filters, setFilters] = useState({
      range: "30d" as FinanceRange,
      from: "",
      to: "",
    }),
    [query, setQuery] = useState("finance?range=30d"),
    [data, setData] = useState<Data | null>(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState<MessageKey | null>(null),
    [revision, setRevision] = useState(0);
  useEffect(() => {
    const c = new AbortController();
    setLoading(true);
    setData(null);
    setError(null);
    void api<Data>(query, { signal: c.signal })
      .then((r) => {
        if (!c.signal.aborted) setData(r);
      })
      .catch((e) => {
        if (!c.signal.aborted) setError(errorKey(e));
      })
      .finally(() => {
        if (!c.signal.aborted) setLoading(false);
      });
    return () => c.abort();
  }, [query, revision]);
  const money = (n: number | null) =>
    n === null ? "—" : uzs(n, locale) + " UZS";
  const margin = (n: number | null) =>
    n === null
      ? "—"
      : new Intl.NumberFormat(locale, {
          maximumFractionDigits: 1,
          minimumFractionDigits: 1,
        }).format(n) + "%";
  return (
    <AdminFrame csrfToken={csrfToken}>
      <div className="page-heading">
        <div>
          <p className="eyebrow">STENZO ADMIN</p>
          <h1>{t("financeTitle")}</h1>
          <p className="muted">{t("financeIntro")}</p>
        </div>
        <a className="button primary" href="/admin/finance/expenses">
          {t("financeExpenses")} →
        </a>
        <a className="button" href="/admin/finance/refunds">
          {t("lifecycleRefunds")} →
        </a>
      </div>
      <form
        className="editor product-filters finance-filters"
        onSubmit={(e) => {
          e.preventDefault();
          setQuery(financeQuery(filters.range, filters.from, filters.to));
          setRevision((v) => v + 1);
        }}
      >
        <label>
          {t("financePeriod")}
          <select
            value={filters.range}
            onChange={(e) =>
              setFilters({ ...filters, range: e.target.value as FinanceRange })
            }
          >
            {(["today", "7d", "30d", "90d", "custom"] as const).map((r) => (
              <option key={r} value={r}>
                {t(`financeRange_${r}`)}
              </option>
            ))}
          </select>
        </label>
        {filters.range === "custom" &&
          (["from", "to"] as const).map((k) => (
            <label key={k}>
              {t(k === "from" ? "dashboardFrom" : "dashboardTo")}
              <input
                type="date"
                value={filters[k]}
                required
                onChange={(e) =>
                  setFilters({ ...filters, [k]: e.target.value })
                }
              />
            </label>
          ))}
        <button disabled={loading}>{t("dashboardShow")}</button>
      </form>
      {error && (
        <p role="alert" className="error">
          {t(error)}{" "}
          <button onClick={() => setRevision((v) => v + 1)}>
            {t("retry")}
          </button>
        </p>
      )}
      {loading ? (
        <p role="status">{t("loading")}</p>
      ) : (
        data && (
          <>
            <p className="muted">
              {dashboardDate(data.period.from, locale)} —{" "}
              {dashboardDate(data.period.to, locale)} · Asia/Tashkent · UZS
            </p>
            <h2>{t("financeCashBlock")}</h2>
            <p className="muted">{t("financeCashHint")}</p>
            <div className="finance-kpis">
              {(
                [
                  ["financeReceived", data.cash.received],
                  ["financeGoodsCash", data.cash.goodsReceived],
                  ["financeCargoCash", data.cash.cargoReceived],
                  ["financeExpenses", data.cash.expenses],
                  ["lifecycleRefunded", data.cash.refunded ?? 0],
                  [
                    "financeCashBeforeProcurement",
                    data.cash.cashBeforeProcurement,
                  ],
                ] as const
              ).map(([key, n]) => (
                <section key={key} className="dashboard-panel">
                  <p className="muted">{t(key)}</p>
                  <strong className={n !== null && n < 0 ? "error" : undefined}>
                    {money(n)}
                  </strong>
                </section>
              ))}
            </div>
            <p className="notice">
              {t("lifecycleRefundPending")}: {data.cash.pendingRefundCount ?? 0}{" "}
              · {money(data.cash.pendingRefundAmount ?? 0)} ·{" "}
              {t("dashboardCurrent")}
            </p>
            {data.cash.unallocatedFinalCount > 0 && (
              <p role="status" className="notice">
                {t("financeUnallocated")}: {data.cash.unallocatedFinalCount} ·{" "}
                {money(data.cash.unallocatedCash)}
              </p>
            )}
            <h2>{t("financeCompletedBlock")}</h2>
            <p className="muted">{t("financeRealizedHint")}</p>
            <div className="finance-kpis">
              {(
                [
                  [
                    "financeCompletedCount",
                    data.realized.completedOrders,
                    false,
                  ],
                  [
                    "financeCompleteCostCount",
                    data.realized.costCompleteOrders,
                    false,
                  ],
                  ["financeCompletedRevenue", data.realized.revenue, true],
                  ["financeProcurement", data.realized.procurement, true],
                  ["financeDirectExpenses", data.realized.expenses, true],
                  ["financeOperatingProfit", data.realized.profit, true],
                ] as const
              ).map(([key, n, isMoney]) => (
                <section key={key} className="dashboard-panel">
                  <p className="muted">{t(key)}</p>
                  <strong className={n < 0 ? "error" : undefined}>
                    {isMoney ? money(n) : n}
                  </strong>
                </section>
              ))}
              <section className="dashboard-panel">
                <p className="muted">{t("financeMargin")}</p>
                <strong>{margin(data.realized.marginPercent)}</strong>
              </section>
            </div>
            {data.realized.incompleteOrders > 0 && (
              <p role="status" className="notice">
                {t("financeIncompleteCount")}: {data.realized.incompleteOrders}
              </p>
            )}
            {data.realized.historicalUndated > 0 && (
              <p className="muted">
                {t("financeHistoricalUndated")}:{" "}
                {data.realized.historicalUndated}
              </p>
            )}
            <div className="finance-two">
              <FinanceChart rows={data.chart} mode="cash" />
              <FinanceChart rows={data.chart} mode="profit" />
            </div>
            <section className="editor">
              <h2>{t("financeBreakdown")}</h2>
              {data.expenseBreakdown.every((r) => r.amount === 0) ? (
                <p className="muted">{t("financeNoExpenses")}</p>
              ) : (
                <dl className="finance-breakdown">
                  {data.expenseBreakdown.map((r) => (
                    <div key={r.category}>
                      <dt>{t(`financeCategory_${r.category}`)}</dt>
                      <dd>{money(r.amount)}</dd>
                      <meter
                        min={0}
                        max={data.cash.expenses || 1}
                        value={r.amount}
                      >
                        {money(r.amount)}
                      </meter>
                    </div>
                  ))}
                </dl>
              )}
            </section>
            <section className="editor">
              <h2>{t("financeProfitableOrders")}</h2>
              <p className="muted">{t("financeTableHint")}</p>
              {!data.profitableOrders.length ? (
                <p>{t("financeNoCompleted")}</p>
              ) : (
                <div className="finance-table-wrap">
                  <table>
                    <thead>
                      <tr>
                        {(
                          [
                            "dashboardOrderNumber",
                            "customer",
                            "financeRevenue",
                            "financeProcurement",
                            "financeDirectExpenses",
                            "financeOperatingProfit",
                            "financeMargin",
                            "financeCompletedAt",
                          ] as const
                        ).map((k) => (
                          <th key={k}>{t(k)}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {data.profitableOrders.map((o) => (
                        <tr key={o.publicId}>
                          <td>
                            <a
                              href={
                                "/admin/orders/" +
                                encodeURIComponent(o.publicId)
                              }
                            >
                              {o.publicId}
                            </a>
                          </td>
                          <td>{o.customer}</td>
                          <td>{money(o.revenue)}</td>
                          <td>{money(o.procurement)}</td>
                          <td>{money(o.expenses)}</td>
                          <td className={o.profit < 0 ? "error" : undefined}>
                            {money(o.profit)}
                          </td>
                          <td>{margin(o.marginPercent)}</td>
                          <td>{dateTime(o.completedAt, locale)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
            <section className="editor">
              <h2>{t("financeNeedsCosts")}</h2>
              <p className="muted">{t("financeNeedsHint")}</p>
              {!data.incompleteOrders.length ? (
                <p>{t("financeNoMissing")}</p>
              ) : (
                <ul className="finance-incomplete-list">
                  {data.incompleteOrders.map((o) => (
                    <li key={o.publicId}>
                      <a
                        href={"/admin/orders/" + encodeURIComponent(o.publicId)}
                      >
                        {o.publicId} · {t("financeFillCosts")} →
                      </a>
                      <span>
                        {o.customer} ·{" "}
                        {t(orderStatusKey(o.status as OrderStatus))} ·{" "}
                        {t("financeMissingItems")}: {o.missingCosts}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </>
        )
      )}
    </AdminFrame>
  );
}

export function FinanceChart({
  rows,
  mode,
}: {
  rows: Data["chart"];
  mode: "cash" | "profit";
}) {
  const { t, locale } = usePreferences();
  const [selected, setSelected] = useState<number | null>(null),
    keys =
      mode === "cash"
        ? (["received", "refunds", "expenses"] as const)
        : (["profit"] as const);
  const geometry = financeChartGeometry(rows, [...keys]),
    index = Math.min(selected ?? rows.length - 1, rows.length - 1),
    active = rows[index];
  const label = {
    received: "financeReceived",
    expenses: "financeExpenses",
    profit: "financeOperatingProfit",
    refunds: "lifecycleRefunded",
  } as const;
  return (
    <section className="dashboard-panel finance-chart">
      <h2>{t(mode === "cash" ? "financeCashChart" : "financeProfitChart")}</h2>
      <p className="muted">{t("financeChartHint")}</p>
      <svg
        viewBox="0 0 720 225"
        role="img"
        aria-label={t(
          mode === "cash" ? "financeCashChart" : "financeProfitChart",
        )}
      >
        <line
          x1={48}
          x2={672}
          y1={geometry.zero}
          y2={geometry.zero}
          stroke="currentColor"
          opacity=".3"
          strokeDasharray="4 4"
        />
        {geometry.series.map((s, i) => (
          <g
            key={s.key}
            stroke={
              s.key === "refunds"
                ? "var(--error)"
                : i === 0
                  ? "var(--dashboard-accent)"
                  : "var(--muted)"
            }
          >
            <path d={s.path} fill="none" strokeWidth={3}>
              <title>{t(label[s.key])}</title>
            </path>
            {s.points[index] && (
              <circle
                cx={s.points[index]!.x}
                cy={s.points[index]!.y}
                r={4}
                fill={
                  s.key === "refunds"
                    ? "var(--error)"
                    : i === 0
                      ? "var(--dashboard-accent)"
                      : "var(--muted)"
                }
              />
            )}
          </g>
        ))}
        <text x={48} y={15} fill="currentColor" fontSize={11}>
          {uzs(geometry.max, locale)} UZS
        </text>
        <text x={48} y={215} fill="currentColor" fontSize={11}>
          {uzs(geometry.min, locale)} UZS
        </text>
      </svg>
      {active && (
        <>
          <label>
            {t("financeChartDay")}
            <input
              type="range"
              min={0}
              max={Math.max(0, rows.length - 1)}
              value={index}
              onChange={(e) => setSelected(Number(e.target.value))}
            />
          </label>
          <p>
            <time dateTime={active.date}>
              {dashboardDate(active.date, locale)}
            </time>
          </p>
          <dl className="finance-grid">
            {keys.map((k) => (
              <div key={k}>
                <dt>{t(label[k])}</dt>
                <dd>{uzs(active[k] ?? 0, locale)} UZS</dd>
              </div>
            ))}
          </dl>
        </>
      )}
    </section>
  );
}
