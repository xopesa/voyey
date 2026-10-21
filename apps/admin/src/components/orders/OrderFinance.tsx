"use client";
import { useState, type FormEvent } from "react";
import { integer } from "../../lib/products";
import {
  uzs,
  orderStatusKey,
  paymentStatusKey,
  type AdminOrder,
} from "../../lib/orders";
import { usePreferences } from "../Preferences";
import { ConfirmAction } from "./ConfirmAction";
export type OrderMutation = (
  path: string,
  method: "POST" | "PATCH",
  body?: object,
) => Promise<boolean>;
export function OrderFinance({
  order,
  disabled,
  busy,
  perform,
}: {
  order: AdminOrder;
  disabled: boolean;
  busy: boolean;
  perform: OrderMutation;
}) {
  const { t, locale } = usePreferences();
  const [cargo, setCargo] = useState("");
  const [invalid, setInvalid] = useState(false);
  const [confirmation, setConfirmation] = useState<"status" | "cargo" | null>(
    null,
  );
  const [cargoValue, setCargoValue] = useState<number | null>(null);
  const money = (value: number | null) =>
    value === null ? t("cargoUnassigned") : `${uzs(value, locale)} ${t("sum")}`;
  function request(event: FormEvent) {
    event.preventDefault();
    if (disabled) return;
    try {
      setCargoValue(integer(cargo));
      setInvalid(false);
      setConfirmation("cargo");
    } catch {
      setInvalid(true);
    }
  }
  async function confirm() {
    if (disabled) return;
    if (confirmation === "status" && order.nextStatus)
      await perform(
        `orders/${encodeURIComponent(order.publicId)}/status`,
        "PATCH",
        { status: order.nextStatus },
      );
    else if (confirmation === "cargo" && cargoValue !== null) {
      const saved = await perform(
        `orders/${encodeURIComponent(order.publicId)}/request-final-payment`,
        "POST",
        { cargoAmount: cargoValue },
      );
      if (saved) setCargo("");
    }
    setConfirmation(null);
  }
  return (
    <section className="editor">
      <h2>{t("finance")}</h2>
      <dl className="finance-grid">
        {!!order.discountAmount && (
          <>
            <div>
              <dt>{t("marketingSubtotal")}</dt>
              <dd>
                {money(order.subtotal ?? order.total + order.discountAmount)}
              </dd>
            </div>
            <div>
              <dt>{t("promoCode")}</dt>
              <dd>{order.promoCodeSnapshot ?? "—"}</dd>
            </div>
            <div>
              <dt>{t("marketingDiscount")}</dt>
              <dd>−{money(order.discountAmount)}</dd>
            </div>
          </>
        )}
        <div>
          <dt>{t("goodsTotal")}</dt>
          <dd>{money(order.total)}</dd>
        </div>
        <div>
          <dt>{t("prepayment")}</dt>
          <dd>{money(order.requiredPrepayment)}</dd>
        </div>
        <div>
          <dt>{t("confirmedPrepayment")}</dt>
          <dd>{money(order.finance.confirmedPrepayment)}</dd>
        </div>
        <div>
          <dt>{t("remainingGoods")}</dt>
          <dd>{money(order.finance.remainingProducts)}</dd>
        </div>
        <div>
          <dt>{t("cargo")}</dt>
          <dd>{money(order.cargoAmount)}</dd>
        </div>
        <div>
          <dt>{t("secondPayment")}</dt>
          <dd>{money(order.finance.finalPaymentTotal)}</dd>
        </div>
        <div>
          <dt>{t("amountDue")}</dt>
          <dd>{money(order.payment.amountDue)}</dd>
        </div>
        <div>
          <dt>{t("paymentState")}</dt>
          <dd>
            {order.payment.latestStatus
              ? t(paymentStatusKey(order.payment.latestStatus))
              : t(orderStatusKey(order.status))}
          </dd>
        </div>
      </dl>
      <div className="order-next-action">
        <h3>{t("nextAction")}</h3>
        {order.nextStatus && (
          <button
            className="primary"
            disabled={disabled}
            onClick={() => setConfirmation("status")}
          >
            {t("moveTo")}: {t(orderStatusKey(order.nextStatus))}
          </button>
        )}
        {order.canRequestFinalPayment && (
          <form onSubmit={request}>
            <label className="price-field">
              {t("cargo")}
              <input
                required
                inputMode="numeric"
                pattern="[0-9]+"
                value={cargo}
                disabled={disabled}
                placeholder="0"
                onChange={(event) => {
                  setCargo(event.target.value);
                  setInvalid(false);
                }}
              />
              <small>{t("cargoHint")}</small>
            </label>
            {invalid && (
              <p className="error" role="alert">
                {t("invalidInteger")}
              </p>
            )}
            <div className="form-actions">
              <button className="primary" disabled={disabled}>
                {t("requestFinal")}
              </button>
            </div>
          </form>
        )}
        {!order.nextStatus && !order.canRequestFinalPayment && (
          <p className="muted">{t("noAdminAction")}</p>
        )}
      </div>
      {confirmation && (
        <ConfirmAction
          title={t(confirmation === "status" ? "nextAction" : "requestFinal")}
          busy={busy}
          onCancel={() => setConfirmation(null)}
          onConfirm={confirm}
        >
          <p>
            {t(confirmation === "status" ? "confirmStatus" : "confirmCargo")}
          </p>
          <p className="confirmation-value">
            {order.publicId} ·{" "}
            {confirmation === "status" && order.nextStatus
              ? t(orderStatusKey(order.nextStatus))
              : money(cargoValue)}
          </p>
        </ConfirmAction>
      )}
    </section>
  );
}
