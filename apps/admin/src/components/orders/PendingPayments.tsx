"use client";
import { useEffect, useRef, useState } from "react";
import { api } from "../../lib/api";
import {
  dateTime,
  orderError,
  paymentTypeKey,
  uzs,
  type AdminPayment,
} from "../../lib/orders";
import type { MessageKey } from "../../lib/i18n";
import { usePreferences } from "../Preferences";
export function PendingPayments() {
  const { t, locale } = usePreferences();
  const [payments, setPayments] = useState<AdminPayment[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<MessageKey | null>(null);
  const [revision, setRevision] = useState(0);
  const generation = useRef(0);
  useEffect(() => {
    const controller = new AbortController();
    const current = ++generation.current;
    setLoading(true);
    setError(null);
    api<{ payments: AdminPayment[]; nextCursor: string | null }>(
      "payments?status=SUBMITTED&limit=20",
      { signal: controller.signal },
    )
      .then((result) => {
        if (current === generation.current) {
          setPayments(result.payments);
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
  }, [revision]);
  async function more() {
    if (!cursor || busy) return;
    const current = generation.current;
    setBusy(true);
    setError(null);
    try {
      const result = await api<{
        payments: AdminPayment[];
        nextCursor: string | null;
      }>(
        `payments?status=SUBMITTED&limit=20&cursor=${encodeURIComponent(cursor)}`,
      );
      if (current !== generation.current) return;
      setPayments((previous) => [
        ...previous,
        ...result.payments.filter(
          (item) => !previous.some((old) => old.id === item.id),
        ),
      ]);
      setCursor(result.nextCursor);
    } catch (error) {
      if (current === generation.current) setError(orderError(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="editor payment-inbox">
      <h2>{t("pendingPayments")}</h2>
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
      {loading ? (
        <p className="section-empty" role="status">
          {t("paymentDetailsLoading")}
        </p>
      ) : payments.length === 0 ? (
        <p className="muted section-empty">{t("noPendingPayments")}</p>
      ) : (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>{t("orderNumber")}</th>
                <th>{t("paymentType")}</th>
                <th>{t("expectedAmount")}</th>
                <th>{t("paymentSubmitted")}</th>
                <th>{t("actions")}</th>
              </tr>
            </thead>
            <tbody>
              {payments.map((payment) => (
                <tr key={payment.id} className="attention-row">
                  <td>{payment.orderPublicId}</td>
                  <td>{t(paymentTypeKey(payment.type))}</td>
                  <td className="nowrap">
                    {uzs(payment.expectedAmount, locale)} {t("sum")}
                  </td>
                  <td>{dateTime(payment.submittedAt, locale)}</td>
                  <td>
                    <a
                      className="button secondary"
                      href={`/admin/orders/${encodeURIComponent(payment.orderPublicId)}?payment=${encodeURIComponent(payment.id)}#payments`}
                    >
                      {t("viewPayment")}
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
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
    </section>
  );
}
