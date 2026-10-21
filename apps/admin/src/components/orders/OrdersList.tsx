"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { api } from "../../lib/api";
import {
  dateTime,
  orderError,
  orderQuery,
  orderStatusKey,
  orderStatuses,
  uzs,
  type AdminOrder,
} from "../../lib/orders";
import type { MessageKey } from "../../lib/i18n";
import { usePreferences } from "../Preferences";
import { AdminFrame } from "../AdminFrame";
import { PendingPayments } from "./PendingPayments";
export function OrdersList({ csrfToken }: { csrfToken: string }) {
  const { t, locale } = usePreferences();
  const [orders, setOrders] = useState<AdminOrder[]>([]);
  const [filters, setFilters] = useState({ status: "", search: "" });
  const [applied, setApplied] = useState(filters);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<MessageKey | null>(null);
  const [revision, setRevision] = useState(0);
  const generation = useRef(0);
  const visibilityLock = useRef(false);
  const [notice, setNotice] = useState<MessageKey | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    const current = ++generation.current;
    setLoading(true);
    setError(null);
    setOrders([]);
    setCursor(null);
    api<{ orders: AdminOrder[]; nextCursor: string | null }>(
      orderQuery(applied),
      { signal: controller.signal },
    )
      .then((result) => {
        if (current === generation.current) {
          setOrders(result.orders);
          setCursor(result.nextCursor);
        }
      })
      .catch((error) => {
        if (!controller.signal.aborted) setError(orderError(error));
      })
      .finally(() => {
        if (current === generation.current) setLoading(false);
      });
    return () => controller.abort();
  }, [applied, revision]);
  async function more() {
    if (!cursor || busy) return;
    const current = generation.current;
    setBusy(true);
    setError(null);
    try {
      const result = await api<{
        orders: AdminOrder[];
        nextCursor: string | null;
      }>(orderQuery(applied, cursor));
      if (current !== generation.current) return;
      setOrders((previous) => [
        ...previous,
        ...result.orders.filter(
          (item) => !previous.some((old) => old.publicId === item.publicId),
        ),
      ]);
      setCursor(result.nextCursor);
    } catch (error) {
      if (current === generation.current) setError(orderError(error));
    } finally {
      setBusy(false);
    }
  }
  async function toggleDashboardVisibility(order: AdminOrder) {
    if (order.status !== "COMPLETED" || busy || visibilityLock.current) return;
    const hidden = !order.dashboardHiddenAt;
    if (
      !window.confirm(
        t(hidden ? "dashboardHideConfirm" : "dashboardRestoreConfirm"),
      )
    )
      return;
    visibilityLock.current = true;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await api(
        `orders/${encodeURIComponent(order.publicId)}/dashboard-visibility`,
        {
          method: "POST",
          headers: { "x-csrf-token": csrfToken },
          body: JSON.stringify({ hidden }),
        },
      );
      setNotice(
        hidden ? "dashboardOrderHiddenNotice" : "dashboardOrderRestoredNotice",
      );
      setRevision((value) => value + 1);
    } catch (error) {
      setError(orderError(error));
    } finally {
      visibilityLock.current = false;
      setBusy(false);
    }
  }
  function search(event: FormEvent) {
    event.preventDefault();
    setApplied({ ...filters });
  }
  return (
    <AdminFrame csrfToken={csrfToken}>
      <div className="page-heading">
        <div>
          <p className="eyebrow">STENZO ADMIN</p>
          <h1>{t("orders")}</h1>
          <p className="muted">{t("ordersIntro")}</p>
        </div>
        <a href="/admin/orders/new" className="button primary">
          + {t("manualCreate")}
        </a>
      </div>
      {notice && (
        <p className="notice" role="status">
          {t(notice)}
        </p>
      )}
      <PendingPayments />
      <form className="order-filters" onSubmit={search}>
        <label>
          {t("orderSearch")}
          <input
            value={filters.search}
            maxLength={100}
            placeholder="STZ-…"
            onChange={(event) =>
              setFilters({ ...filters, search: event.target.value })
            }
          />
        </label>
        <label>
          {t("status")}
          <select
            value={filters.status}
            onChange={(event) =>
              setFilters({ ...filters, status: event.target.value })
            }
          >
            <option value="">{t("allStatuses")}</option>
            {orderStatuses.map((status) => (
              <option key={status} value={status}>
                {t(orderStatusKey(status))}
              </option>
            ))}
          </select>
        </label>
        <button className="secondary" disabled={busy}>
          {t("search")}
        </button>
      </form>
      {error && (
        <p className="error" role="alert">
          {t(error)}{" "}
          <button
            className="quiet"
            disabled={busy}
            onClick={() => setRevision((value) => value + 1)}
          >
            {t("retry")}
          </button>
        </p>
      )}
      <section className="list-panel" aria-busy={loading}>
        {loading ? (
          <div className="state" role="status">
            <span className="spinner" />
            {t("ordersLoading")}
          </div>
        ) : orders.length === 0 ? (
          <div className="state">
            <h2>{t("noOrders")}</h2>
            <p className="muted">{t("noOrdersHint")}</p>
          </div>
        ) : (
          <div className="table-scroll">
            <table className="orders-table">
              <thead>
                <tr>
                  <th>{t("orderNumber")}</th>
                  <th>{t("orderDate")}</th>
                  <th>{t("customer")}</th>
                  <th>{t("orderTotal")}</th>
                  <th>{t("prepayment")}</th>
                  <th>{t("status")}</th>
                  <th>{t("paymentReview")}</th>
                  <th>{t("actions")}</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((order) => (
                  <tr
                    key={order.publicId}
                    className={
                      order.requiresAction ? "attention-row" : undefined
                    }
                  >
                    <td>
                      <a
                        className="product-link"
                        href={`/admin/orders/${encodeURIComponent(order.publicId)}`}
                      >
                        {order.publicId}
                      </a>
                      {order.requiresAction && (
                        <div className="attention-label">
                          {t("actionRequired")}
                        </div>
                      )}
                    </td>
                    <td className="nowrap">
                      {dateTime(order.createdAt, locale)}
                    </td>
                    <td>
                      {order.recipient.fullName}
                      <div className="muted">
                        {order.customer.username
                          ? `@${order.customer.username}`
                          : order.customer.telegramId}
                      </div>
                    </td>
                    <td className="nowrap">
                      {uzs(order.total, locale)} {t("sum")}
                    </td>
                    <td className="nowrap">
                      {uzs(order.requiredPrepayment, locale)} {t("sum")}
                    </td>
                    <td>
                      <span
                        className={`badge ${order.requiresAction ? "active" : ""}`}
                      >
                        {t(orderStatusKey(order.status))}
                      </span>
                      {order.dashboardHiddenAt && (
                        <div className="muted">{t("dashboardOrderHidden")}</div>
                      )}
                    </td>
                    <td>
                      {order.paymentAttempts.some(
                        (payment) => payment.status === "SUBMITTED",
                      ) ? (
                        <a
                          className="attention-label"
                          href={`/admin/orders/${encodeURIComponent(order.publicId)}#payments`}
                        >
                          {t("pendingReview")}
                        </a>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td>
                      {order.status === "COMPLETED" && (
                        <button
                          type="button"
                          className="secondary"
                          title={t(
                            order.dashboardHiddenAt
                              ? "dashboardRestoreOrder"
                              : "dashboardHideOrder",
                          )}
                          aria-label={t(
                            order.dashboardHiddenAt
                              ? "dashboardRestoreOrder"
                              : "dashboardHideOrder",
                          )}
                          disabled={busy}
                          onClick={() => void toggleDashboardVisibility(order)}
                        >
                          {t(
                            order.dashboardHiddenAt
                              ? "dashboardRestoreShort"
                              : "dashboardHideShort",
                          )}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      {cursor && (
        <div className="load-more">
          <button
            className="secondary"
            disabled={busy || loading}
            onClick={more}
          >
            {t(busy ? "working" : "loadMore")}
          </button>
        </div>
      )}
    </AdminFrame>
  );
}
