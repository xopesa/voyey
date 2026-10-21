"use client";
import { useEffect, useState } from "react";
import type { RefundPage } from "@stenzo/shared";
import { AdminFrame } from "../AdminFrame";
import { usePreferences } from "../Preferences";
import { api, errorKey } from "../../lib/api";
import { uzs, dateTime } from "../../lib/orders";
import type { MessageKey } from "../../lib/i18n";
export function Refunds({ csrfToken }: { csrfToken: string }) {
  const { t, locale } = usePreferences();
  const [status, setStatus] = useState("all"),
    [cursors, setCursors] = useState<string[]>([]),
    [page, setPage] = useState<RefundPage | null>(null),
    [error, setError] = useState<MessageKey | null>(null),
    [loading, setLoading] = useState(true);
  const cursor = cursors.at(-1);
  useEffect(() => {
    const c = new AbortController();
    setLoading(true);
    setPage(null);
    setError(null);
    void api<RefundPage>(
      `finance/refunds?status=${status}&limit=20${cursor ? "&cursor=" + encodeURIComponent(cursor) : ""}`,
      { signal: c.signal },
    )
      .then((r) => {
        if (!c.signal.aborted) setPage(r);
      })
      .catch((e) => {
        if (!c.signal.aborted) setError(errorKey(e));
      })
      .finally(() => {
        if (!c.signal.aborted) setLoading(false);
      });
    return () => c.abort();
  }, [status, cursor]);
  return (
    <AdminFrame csrfToken={csrfToken}>
      <div className="page-heading">
        <div>
          <a href="/admin/finance">← {t("financeTitle")}</a>
          <h1>{t("lifecycleRefunds")}</h1>
          <p className="muted">{t("lifecycleManualRefundHint")}</p>
        </div>
      </div>
      <label>
        {t("status")}
        <select
          value={status}
          onChange={(e) => {
            setCursors([]);
            setStatus(e.target.value);
          }}
        >
          <option value="all">{t("financeAll")}</option>
          <option value="PENDING">{t("lifecycleRefundPending")}</option>
          <option value="COMPLETED">{t("lifecycleRefundDone")}</option>
        </select>
      </label>
      {error && (
        <p role="alert" className="error">
          {t(error)}
        </p>
      )}
      {loading ? (
        <p role="status">{t("refundsLoading")}</p>
      ) : !page?.refunds.length ? (
        <p className="state">{t("lifecycleNoRefunds")}</p>
      ) : (
        <div className="finance-table-wrap">
          <table>
            <thead>
              <tr>
                {(
                  [
                    "dashboardOrderNumber",
                    "customer",
                    "financeAmount",
                    "status",
                    "orderDate",
                    "financeCompletedAt",
                    "actions",
                  ] as const
                ).map((k) => (
                  <th key={k}>{t(k)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {page.refunds.map((r) => (
                <tr key={r.id}>
                  <td>
                    <a
                      href={
                        "/admin/orders/" + encodeURIComponent(r.orderPublicId)
                      }
                    >
                      {r.orderPublicId}
                    </a>
                  </td>
                  <td>{r.customer}</td>
                  <td>{uzs(r.amount, locale)} UZS</td>
                  <td>
                    {t(
                      r.status === "PENDING"
                        ? "lifecycleRefundPending"
                        : "lifecycleRefundDone",
                    )}
                  </td>
                  <td>{dateTime(r.createdAt, locale)}</td>
                  <td>
                    {r.completedAt ? dateTime(r.completedAt, locale) : "—"}
                  </td>
                  <td>
                    <a
                      href={
                        "/admin/orders/" + encodeURIComponent(r.orderPublicId)
                      }
                    >
                      {t("dashboardOpen")} →
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="finance-actions">
        <button
          disabled={loading || !cursors.length}
          onClick={() => setCursors((v) => v.slice(0, -1))}
        >
          {t("customerPrevious")}
        </button>
        <button
          disabled={loading || !page?.nextCursor}
          onClick={() => setCursors((v) => [...v, page!.nextCursor!])}
        >
          {t("customerNext")}
        </button>
      </div>
    </AdminFrame>
  );
}
