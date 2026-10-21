"use client";
import { useEffect, useState } from "react";
import {
  cancellationReasons,
  cancellationReasonText,
  type CancellationReason,
  type OrderLifecycle as State,
} from "@stenzo/shared";
import { api, errorKey } from "../../lib/api";
import { dateTime, uzs } from "../../lib/orders";
import type { MessageKey } from "../../lib/i18n";
import { usePreferences } from "../Preferences";
import { ConfirmAction } from "./ConfirmAction";
import type { OrderMutation } from "./OrderFinance";
export function OrderLifecycle({
  publicId,
  revision,
  disabled,
  perform,
}: {
  publicId: string;
  revision: number;
  disabled: boolean;
  perform: OrderMutation;
}) {
  const { t, locale } = usePreferences();
  const [data, setData] = useState<State | null>(null),
    [error, setError] = useState<MessageKey | null>(null),
    [dialog, setDialog] = useState<"cancel" | "refund" | null>(null),
    [reason, setReason] = useState<CancellationReason | "">(""),
    [note, setNote] = useState(""),
    [reference, setReference] = useState(""),
    [refundNote, setRefundNote] = useState("");
  useEffect(() => {
    const c = new AbortController();
    setData(null);
    setError(null);
    void api<State>(`orders/${encodeURIComponent(publicId)}/lifecycle`, {
      signal: c.signal,
    })
      .then((r) => {
        if (!c.signal.aborted) setData(r);
      })
      .catch((e) => {
        if (!c.signal.aborted) setError(errorKey(e));
      });
    return () => c.abort();
  }, [publicId, revision]);
  const money = (n: number) => uzs(n, locale) + " UZS";
  return (
    <section className="editor">
      <h2>{t("lifecycleTitle")}</h2>
      {error && (
        <p className="error" role="alert">
          {t(error)}
        </p>
      )}
      {!data ? (
        <p role="status">{t("loading")}</p>
      ) : (
        <>
          {data.hasSubmitted && (
            <p className="notice">{t("lifecycleProofPending")}</p>
          )}
          {data.canCancel && (
            <button disabled={disabled} onClick={() => setDialog("cancel")}>
              {t("lifecycleCancel")}
            </button>
          )}
          {data.status === "CANCELLED" && (
            <>
              <p>
                <strong>{t("lifecycleCancelled")}</strong> ·{" "}
                {data.reason
                  ? cancellationReasonText[data.reason][locale]
                  : t("lifecycleUnknownReason")}
              </p>
              {data.cancelledAt && <p>{dateTime(data.cancelledAt, locale)}</p>}
              {data.note && <p className="muted">{data.note}</p>}
            </>
          )}
          {data.stockReleaseStatus === "REVIEW_REQUIRED" && (
            <>
              <p className="notice">{t("lifecycleStockReview")}</p>
              <button
                disabled={disabled}
                onClick={() => {
                  if (window.confirm(t("lifecycleReviewConfirm")))
                    void perform(
                      `orders/${encodeURIComponent(publicId)}/stock-reviewed`,
                      "POST",
                    );
                }}
              >
                {t("lifecycleStockReviewed")}
              </button>
            </>
          )}
          {data.refund && (
            <section>
              <h3>{t("lifecycleRefund")}</h3>
              <p>
                <strong>{money(data.refund.amount)}</strong> ·{" "}
                {t(
                  data.refund.status === "PENDING"
                    ? "lifecycleRefundPending"
                    : "lifecycleRefundDone",
                )}
              </p>
              {data.refund.status === "PENDING" ? (
                <>
                  <p className="muted">{t("lifecycleManualRefundHint")}</p>
                  <label>
                    {t("lifecycleReference")}
                    <input
                      value={reference}
                      maxLength={200}
                      disabled={disabled}
                      onChange={(e) => setReference(e.target.value)}
                    />
                  </label>
                  <label>
                    {t("lifecycleNote")}
                    <textarea
                      value={refundNote}
                      maxLength={500}
                      disabled={disabled}
                      onChange={(e) => setRefundNote(e.target.value)}
                    />
                  </label>
                  <button
                    disabled={disabled}
                    onClick={() => setDialog("refund")}
                  >
                    {t("lifecycleRefundDone")}
                  </button>
                </>
              ) : (
                <>
                  <p>
                    {data.refund.completedAt &&
                      dateTime(data.refund.completedAt, locale)}
                  </p>
                  {data.refund.reference && (
                    <p>
                      {t("lifecycleReference")}: {data.refund.reference}
                    </p>
                  )}
                  {data.refund.note && <p>{data.refund.note}</p>}
                </>
              )}
            </section>
          )}
        </>
      )}
      {dialog && data && (
        <ConfirmAction
          title={t(
            dialog === "cancel" ? "lifecycleCancel" : "lifecycleRefundDone",
          )}
          busy={disabled}
          onCancel={() => setDialog(null)}
          onConfirm={() => {
            if (disabled) return;
            if (dialog === "cancel" && !reason) {
              setError("lifecycleReasonRequired");
              return;
            }
            void perform(
              dialog === "cancel"
                ? `orders/${encodeURIComponent(publicId)}/cancel`
                : `finance/refunds/${encodeURIComponent(data!.refund!.id)}/complete`,
              "POST",
              dialog === "cancel"
                ? { reason, note: note.trim() || null }
                : {
                    reference: reference.trim() || null,
                    note: refundNote.trim() || null,
                  },
            ).then((ok) => {
              if (ok) setDialog(null);
            });
          }}
        >
          {dialog === "cancel" ? (
            <>
              <label>
                {t("lifecycleReason")}
                <select
                  value={reason}
                  disabled={disabled}
                  onChange={(e) =>
                    setReason(e.target.value as CancellationReason | "")
                  }
                >
                  <option value="">{t("lifecycleChooseReason")}</option>
                  {cancellationReasons.map((r) => (
                    <option key={r} value={r}>
                      {cancellationReasonText[r][locale]}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                {t("lifecycleNote")}
                <textarea
                  value={note}
                  maxLength={500}
                  disabled={disabled}
                  onChange={(e) => setNote(e.target.value)}
                />
              </label>
              <p>
                {data!.approvedCash > 0
                  ? t("lifecycleRefundWarning").replace(
                      "{amount}",
                      money(data!.approvedCash),
                    )
                  : t("lifecycleNoPayments")}
              </p>
              {error && <p className="error">{t(error)}</p>}
            </>
          ) : (
            <p>
              {t("lifecycleCompleteConfirm")} {money(data!.refund!.amount)}
            </p>
          )}
        </ConfirmAction>
      )}
    </section>
  );
}
