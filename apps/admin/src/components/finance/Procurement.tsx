"use client";
import { useEffect, useState } from "react";
import type { AdminOrderFinance } from "@stenzo/shared";
import { api, errorKey } from "../../lib/api";
import { uzs, dateTime } from "../../lib/orders";
import type { MessageKey } from "../../lib/i18n";
import { usePreferences } from "../Preferences";
import type { OrderMutation } from "../orders/OrderFinance";
import "../../styles/finance.css";

export function Procurement({
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
  const [data, setData] = useState<AdminOrderFinance | null>(null),
    [error, setError] = useState<MessageKey | null>(null);
  useEffect(() => {
    const c = new AbortController();
    setData(null);
    setError(null);
    void api<AdminOrderFinance>(
      `orders/${encodeURIComponent(publicId)}/finance`,
      { signal: c.signal },
    )
      .then((r) => {
        if (!c.signal.aborted) setData(r);
      })
      .catch((e) => {
        if (!c.signal.aborted) setError(errorKey(e));
      });
    return () => c.abort();
  }, [publicId, revision]);
  const money = (n: number | null) =>
    n === null ? "—" : `${uzs(n, locale)} UZS`;
  return (
    <section className="editor finance-section">
      <h2>{t("financeProcurement")}</h2>
      <p className="muted">{t("financePrivate")}</p>
      {error ? (
        <p role="alert" className="error">
          {t(error)}
        </p>
      ) : !data ? (
        <p role="status">{t("loading")}</p>
      ) : (
        <>
          <div className="finance-items">
            {data.items.map((item) => (
              <CostEditor
                key={item.id + ":" + (item.procurementUpdatedAt ?? "")}
                item={item}
                disabled={disabled}
                perform={perform}
                publicId={publicId}
              />
            ))}
          </div>
          <h2>{t("financeOrderProfit")}</h2>
          <dl className="finance-grid">
            {(
              [
                ["financeGoodsSubtotal", data.goodsSubtotal],
                ["marketingDiscount", data.discountAmount],
                ["financeGoodsRevenue", data.goodsRevenue],
                ["financeCustomerCargo", data.customerCargo],
                ["financeRevenue", data.revenue],
                ["financeKnownCost", data.procurementCost],
                ["financeLinkedExpenses", data.linkedExpenses],
                ["financeDirectCost", data.directCost],
                ["financeOperatingProfit", data.profit],
                ["financeReceived", data.received],
                ["financeOutstanding", data.outstanding],
              ] as const
            ).map(([k, v]) => (
              <div key={k}>
                <dt>{t(k)}</dt>
                <dd className={v !== null && v < 0 ? "error" : undefined}>
                  {money(v)}
                </dd>
              </div>
            ))}
            <div>
              <dt>{t("financeMargin")}</dt>
              <dd>
                {data.marginPercent === null
                  ? "—"
                  : new Intl.NumberFormat(locale, {
                      maximumFractionDigits: 1,
                      minimumFractionDigits: 1,
                    }).format(data.marginPercent) + "%"}
              </dd>
            </div>
          </dl>
          {!data.costComplete && (
            <p role="status" className="notice">
              {t("financeIncomplete")}
            </p>
          )}
          <p className="muted">{t("financeProfitHint")}</p>
          {data.completedAt && (
            <p>
              {t("financeCompletedAt")}: {dateTime(data.completedAt, locale)}
            </p>
          )}
          <a
            href={`/admin/finance/expenses?order=${encodeURIComponent(publicId)}`}
          >
            {t("financeLinkedExpenses")} →
          </a>
        </>
      )}
    </section>
  );
}
function CostEditor({
  item,
  disabled,
  perform,
  publicId,
}: {
  item: AdminOrderFinance["items"][number];
  disabled: boolean;
  perform: OrderMutation;
  publicId: string;
}) {
  const { t, locale } = usePreferences();
  const [value, setValue] = useState(
      item.procurementUnitCost === null ? "" : String(item.procurementUnitCost),
    ),
    [invalid, setInvalid] = useState(false);
  const path = `orders/${encodeURIComponent(publicId)}/items/${encodeURIComponent(item.id)}/procurement-cost`;
  const money = (n: number | null) =>
    n === null ? "—" : uzs(n, locale) + " UZS";
  return (
    <form
      className="finance-cost"
      onSubmit={(e) => {
        e.preventDefault();
        const n = Number(value);
        if (
          !/^\d+$/.test(value) ||
          !Number.isInteger(n) ||
          n <= 0 ||
          n > 2147483647
        ) {
          setInvalid(true);
          return;
        }
        setInvalid(false);
        void perform(path, "PATCH", { procurementUnitCost: n });
      }}
    >
      <h3>
        {locale === "ru" ? item.productNameRu : item.productNameUz} · {item.sku}
      </h3>
      <p className="muted">
        {t("financeSalePrice")}: {money(item.unitPrice)} · {t("manualQuantity")}
        : {item.quantity}
      </p>
      <dl className="finance-grid">
        <div>
          <dt>{t("financeLineCost")}</dt>
          <dd>{money(item.procurementLineCost)}</dd>
        </div>
        <div>
          <dt>{t("financeLineMargin")}</dt>
          <dd>{money(item.lineMargin)}</dd>
        </div>
      </dl>
      <label>
        {t("financeUnitCost")}
        <input
          inputMode="numeric"
          value={value}
          maxLength={10}
          onChange={(e) => setValue(e.target.value)}
          disabled={disabled}
        />
      </label>
      {invalid && (
        <p role="alert" className="error">
          {t("financeInvalidCost")}
        </p>
      )}
      <div className="finance-actions">
        <button
          className="primary"
          disabled={disabled || value === String(item.procurementUnitCost)}
        >
          {t("financeSaveCost")}
        </button>
        {item.procurementUnitCost !== null && (
          <button
            type="button"
            disabled={disabled}
            onClick={() => {
              if (window.confirm(t("financeClearConfirm")))
                void perform(path, "PATCH", { procurementUnitCost: null });
            }}
          >
            {t("financeClearCost")}
          </button>
        )}
      </div>
    </form>
  );
}
