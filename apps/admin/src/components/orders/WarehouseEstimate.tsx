"use client";
import { useEffect, useState, type FormEvent } from "react";
import type { AdminOrder } from "../../lib/orders";
import { usePreferences } from "../Preferences";
import type { OrderMutation } from "./OrderFinance";

export function WarehouseEstimate({
  order,
  disabled,
  perform,
}: {
  order: AdminOrder;
  disabled: boolean;
  perform: OrderMutation;
}) {
  const { t } = usePreferences();
  const [date, setDate] = useState(order.estimatedWarehouseArrival ?? "");
  useEffect(
    () => setDate(order.estimatedWarehouseArrival ?? ""),
    [order.publicId, order.estimatedWarehouseArrival],
  );
  const editable = ["AWAITING_PURCHASE", "PURCHASED", "IN_TRANSIT"].includes(
    order.status,
  );
  async function save(event: FormEvent) {
    event.preventDefault();
    if (
      disabled ||
      !editable ||
      date === (order.estimatedWarehouseArrival ?? "")
    )
      return;
    await perform(
      `orders/${encodeURIComponent(order.publicId)}/warehouse-estimate`,
      "PATCH",
      { estimatedWarehouseArrival: date || null },
    );
  }
  return (
    <section className="editor">
      <h2>{t("warehouseEstimateTitle")}</h2>
      <p className="muted">{t("warehouseEstimateHint")}</p>
      <form onSubmit={save}>
        <label>
          {t("warehouseEstimateDate")}
          <input
            type="date"
            value={date}
            disabled={disabled || !editable}
            onChange={(event) => setDate(event.target.value)}
          />
        </label>
        {editable ? (
          <div className="form-actions">
            <button
              className="primary"
              disabled={
                disabled || date === (order.estimatedWarehouseArrival ?? "")
              }
            >
              {t("save")}
            </button>
          </div>
        ) : (
          <p className="muted">{t("warehouseEstimateLocked")}</p>
        )}
      </form>
    </section>
  );
}
