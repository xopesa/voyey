"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../../lib/api";
import {
  dateTime,
  orderError,
  orderStatusKey,
  type AdminOrder,
} from "../../lib/orders";
import type { MessageKey } from "../../lib/i18n";
import { usePreferences } from "../Preferences";
import { AdminFrame } from "../AdminFrame";
import { OrderOverview } from "./OrderOverview";
import { OrderFinance, type OrderMutation } from "./OrderFinance";
import { PaymentReview } from "./PaymentReview";
import { Procurement } from "../finance/Procurement";
import { OrderLifecycle } from "./OrderLifecycle";
import { WarehouseEstimate } from "./WarehouseEstimate";
export function OrderDetail({
  csrfToken,
  publicId,
  paymentId,
}: {
  csrfToken: string;
  publicId: string;
  paymentId?: string;
}) {
  const { t, locale } = usePreferences();
  const [order, setOrder] = useState<AdminOrder | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [stale, setStale] = useState(false);
  const [error, setError] = useState<MessageKey | null>(null);
  const [notice, setNotice] = useState<MessageKey | null>(null);
  const lock = useRef(false);
  const [revision, setRevision] = useState(0);
  const load = useCallback(
    async (signal?: AbortSignal) => {
      const result = await api<{ order: AdminOrder }>(
        `orders/${encodeURIComponent(publicId)}`,
        { signal },
      );
      if (!signal?.aborted) {
        setOrder(result.order);
        setStale(false);
        setRevision((r) => r + 1);
      }
    },
    [publicId],
  );
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setOrder(null);
    setError(null);
    load(controller.signal)
      .catch((error) => {
        if (!controller.signal.aborted) setError(orderError(error));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [load]);
  async function refresh() {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError(null);
    try {
      await load();
    } catch (error) {
      setError(orderError(error));
      setStale(true);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  const perform: OrderMutation = async (path, method, body) => {
    if (lock.current || stale) return false;
    lock.current = true;
    setBusy(true);
    setError(null);
    setNotice(null);
    let persisted = false;
    try {
      await api(path, {
        method,
        headers: { "x-csrf-token": csrfToken },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      persisted = true;
      await load();
      setNotice("actionSaved");
      return true;
    } catch (error) {
      // A timeout can occur after a committed transaction. Require a fresh read
      // before allowing another mutation; never guess or optimistically change status.
      setStale(true);
      setError(persisted ? "refreshFailed" : orderError(error));
      return false;
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  return (
    <AdminFrame csrfToken={csrfToken} preventLogout={busy}>
      <div className="page-heading order-heading">
        <div>
          <a className="muted" href="/admin/orders">
            ← {t("backOrders")}
          </a>
          <h1>
            {t("orderDetail")} {publicId}
          </h1>
          {order && (
            <p className="muted">
              {t(
                order.source === "ADMIN"
                  ? "orderSourceAdmin"
                  : "orderSourceMiniapp",
              )}{" "}
              · {dateTime(order.createdAt, locale)} ·{" "}
              <span className="badge active">
                {t(orderStatusKey(order.status))}
              </span>
            </p>
          )}
        </div>
        <button
          className="secondary"
          disabled={busy || loading}
          onClick={refresh}
        >
          {t("refreshOrder")}
        </button>
      </div>
      {error && (
        <p className="error" role="alert">
          {t(error)}
          {!order && (
            <button className="quiet" disabled={busy} onClick={refresh}>
              {t("retry")}
            </button>
          )}
        </p>
      )}
      {notice && (
        <p className="notice" role="status">
          {t(notice)}
        </p>
      )}
      {loading ? (
        <div className="state" role="status">
          <span className="spinner" />
          {t("ordersLoading")}
        </div>
      ) : (
        order && (
          <>
            <OrderOverview order={order} />
            <OrderLifecycle
              publicId={publicId}
              revision={revision}
              disabled={busy || stale}
              perform={perform}
            />
            <Procurement
              publicId={publicId}
              revision={revision}
              disabled={busy || stale}
              perform={perform}
            />
            <OrderFinance
              order={order}
              disabled={busy || stale}
              busy={busy}
              perform={perform}
            />
            <WarehouseEstimate
              order={order}
              disabled={busy || stale}
              perform={perform}
            />
            <PaymentReview
              order={order}
              paymentId={paymentId}
              disabled={busy || stale}
              busy={busy}
              perform={perform}
            />
          </>
        )
      )}
    </AdminFrame>
  );
}
