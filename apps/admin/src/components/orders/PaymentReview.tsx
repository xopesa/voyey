"use client";
import { useEffect, useState } from "react";
import { api } from "../../lib/api";
import {
  dateTime,
  orderError,
  paymentStatusKey,
  paymentTypeKey,
  uzs,
  type AdminOrder,
  type AdminPayment,
} from "../../lib/orders";
import type { MessageKey } from "../../lib/i18n";
import { usePreferences } from "../Preferences";
import type { OrderMutation } from "./OrderFinance";
import { ConfirmAction } from "./ConfirmAction";
import { PaymentProof } from "./PaymentProof";
export function PaymentReview({
  order,
  paymentId,
  disabled,
  busy,
  perform,
}: {
  order: AdminOrder;
  paymentId?: string;
  disabled: boolean;
  busy: boolean;
  perform: OrderMutation;
}) {
  const { t, locale } = usePreferences();
  const initial =
    paymentId && order.paymentAttempts.some((item) => item.id === paymentId)
      ? paymentId
      : (order.paymentAttempts.find((item) => item.status === "SUBMITTED")
          ?.id ??
        order.paymentAttempts[0]?.id ??
        null);
  const [selected, setSelected] = useState<string | null>(initial);
  const [payment, setPayment] = useState<AdminPayment | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<MessageKey | null>(null);
  const [revision, setRevision] = useState(0);
  const [proof, setProof] = useState(false);
  const [reason, setReason] = useState("");
  const [confirmation, setConfirmation] = useState<"approve" | "reject" | null>(
    null,
  );
  useEffect(() => {
    const controller = new AbortController();
    setPayment(null);
    setProof(false);
    setError(null);
    if (!selected) return;
    setLoading(true);
    api<{ payment: AdminPayment }>(`payments/${encodeURIComponent(selected)}`, {
      signal: controller.signal,
    })
      .then((result) => {
        if (controller.signal.aborted) return;
        if (result.payment.orderPublicId !== order.publicId) {
          setError("access");
          return;
        }
        setPayment(result.payment);
      })
      .catch((error) => {
        if (!controller.signal.aborted) setError(orderError(error));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [selected, order, revision]);
  const currentAttempt = order.paymentAttempts.find(
    (item) => item.id === selected,
  );
  const reviewable =
    payment?.status === "SUBMITTED" &&
    currentAttempt?.status === "SUBMITTED" &&
    (payment.type === "PREPAYMENT"
      ? order.status === "PREPAYMENT_SUBMITTED"
      : order.status === "FINAL_PAYMENT_SUBMITTED");
  async function confirm() {
    if (!confirmation || !payment || !reviewable || disabled) return;
    const saved = await perform(
      `payments/${encodeURIComponent(payment.id)}/${confirmation}`,
      "POST",
      confirmation === "reject" ? { reason: reason.trim() || null } : undefined,
    );
    if (saved) setReason("");
    setConfirmation(null);
  }
  return (
    <section className="editor" id="payments">
      <h2>{t("paymentReview")}</h2>
      {order.paymentAttempts.length === 0 ? (
        <p className="muted section-empty">{t("noPayments")}</p>
      ) : (
        <>
          <h3 className="section-intro">{t("paymentHistory")}</h3>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>{t("paymentType")}</th>
                  <th>{t("expectedAmount")}</th>
                  <th>{t("paymentSubmitted")}</th>
                  <th>{t("status")}</th>
                  <th>{t("actions")}</th>
                </tr>
              </thead>
              <tbody>
                {order.paymentAttempts.map((attempt) => (
                  <tr
                    key={attempt.id}
                    className={
                      attempt.status === "SUBMITTED"
                        ? "attention-row"
                        : undefined
                    }
                  >
                    <td>{t(paymentTypeKey(attempt.type))}</td>
                    <td className="nowrap">
                      {uzs(attempt.expectedAmount, locale)} {t("sum")}
                    </td>
                    <td>{dateTime(attempt.submittedAt, locale)}</td>
                    <td>
                      <span
                        className={`badge ${attempt.status === "SUBMITTED" ? "active" : ""}`}
                      >
                        {t(paymentStatusKey(attempt.status))}
                      </span>
                    </td>
                    <td>
                      <button
                        className="secondary"
                        disabled={busy}
                        aria-pressed={selected === attempt.id}
                        onClick={() => {
                          setSelected(attempt.id);
                          setReason("");
                        }}
                      >
                        {t("viewPayment")}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
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
          ) : (
            payment && (
              <div className="payment-review-card">
                <h3>
                  {t(paymentTypeKey(payment.type))} ·{" "}
                  {t(paymentStatusKey(payment.status))}
                </h3>
                <dl className="detail-grid">
                  <div>
                    <dt>{t("expectedAmount")}</dt>
                    <dd>
                      {uzs(payment.expectedAmount, locale)} {t("sum")}
                    </dd>
                  </div>
                  <div>
                    <dt>{t("paymentSubmitted")}</dt>
                    <dd>{dateTime(payment.submittedAt, locale)}</dd>
                  </div>
                  <div>
                    <dt>{t("paymentReviewed")}</dt>
                    <dd>
                      {payment.reviewedAt
                        ? dateTime(payment.reviewedAt, locale)
                        : "—"}
                    </dd>
                  </div>
                  {payment.rejectionReason && (
                    <div>
                      <dt>{t("rejectReason")}</dt>
                      <dd>{payment.rejectionReason}</dd>
                    </div>
                  )}
                </dl>
                <button
                  className="secondary"
                  onClick={() => setProof((value) => !value)}
                >
                  {t(proof ? "closeProof" : "viewProof")}
                </button>
                {proof && <PaymentProof paymentId={payment.id} />}
                {reviewable ? (
                  <>
                    <p className="review-hint">{t("reviewHint")}</p>
                    <label>
                      {t("rejectReason")}
                      <textarea
                        value={reason}
                        maxLength={500}
                        rows={3}
                        disabled={disabled}
                        onChange={(event) => setReason(event.target.value)}
                      />
                    </label>
                    <div className="form-actions">
                      <button
                        className="primary"
                        disabled={disabled}
                        onClick={() => setConfirmation("approve")}
                      >
                        {t("approvePayment")}
                      </button>
                      <button
                        className="secondary"
                        disabled={disabled}
                        onClick={() => setConfirmation("reject")}
                      >
                        {t("rejectPayment")}
                      </button>
                    </div>
                  </>
                ) : (
                  <p className="muted section-empty">
                    {t(
                      payment.status === "SUBMITTED"
                        ? "reviewUnavailable"
                        : "reviewedAlready",
                    )}
                  </p>
                )}
              </div>
            )
          )}
        </>
      )}
      {confirmation && payment && (
        <ConfirmAction
          title={t(
            confirmation === "approve" ? "approvePayment" : "rejectPayment",
          )}
          busy={busy}
          onCancel={() => setConfirmation(null)}
          onConfirm={confirm}
        >
          <p>
            {t(confirmation === "approve" ? "approveConfirm" : "rejectConfirm")}
          </p>
          <p className="confirmation-value">
            {order.publicId} · {t(paymentTypeKey(payment.type))} ·{" "}
            {uzs(payment.expectedAmount, locale)} {t("sum")}
          </p>
          {confirmation === "reject" && reason.trim() && <p>{reason.trim()}</p>}
        </ConfirmAction>
      )}
    </section>
  );
}
