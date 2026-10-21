"use client";
import { useEffect, useId, useState } from "react";
import type { CartItem, CartItemPatch } from "../../lib/cart";
import { measurement } from "../../lib/product";
import { usePreferences } from "../PreferencesProvider";
import { Button } from "../ui/foundation";
export function CheckoutMeasurements({
  item,
  disabled,
  update,
  onDraft,
}: {
  item: CartItem;
  disabled: boolean;
  update: (id: string, patch: CartItemPatch) => Promise<boolean>;
  onDraft: (id: string, dirty: boolean) => void;
}) {
  const { t, localizedText } = usePreferences();
  const id = useId();
  const [height, setHeight] = useState(
    item.heightCm === null ? "" : String(item.heightCm),
  );
  const [weight, setWeight] = useState(
    item.weightKg === null ? "" : String(item.weightKg),
  );
  const heightCm = measurement(height, 100, 250),
    weightKg = measurement(weight, 30, 300);
  const dirty = heightCm !== item.heightCm || weightKg !== item.weightKg;
  useEffect(() => {
    setHeight(item.heightCm === null ? "" : String(item.heightCm));
    setWeight(item.weightKg === null ? "" : String(item.weightKg));
  }, [item.heightCm, item.weightKg]);
  useEffect(() => {
    onDraft(item.id, dirty);
    return () => onDraft(item.id, false);
  }, [item.id, dirty, onDraft]);
  return (
    <div className="checkout-measurements">
      <h3>
        {localizedText({ ru: item.product.nameRu, uz: item.product.nameUz })}
      </h3>
      <p className="ui-copy">
        {item.variant.size}
        {item.variant.color ? ` / ${item.variant.color}` : ""} ·{" "}
        {t("checkout.quantity", { count: item.quantity })}
      </p>
      <div className="cart-item__fields">
        <label htmlFor={`${id}-height`}>
          {t("product.height")} *
          <input
            id={`${id}-height`}
            type="number"
            inputMode="numeric"
            min={100}
            max={250}
            step={1}
            value={height}
            disabled={disabled}
            aria-invalid={heightCm === undefined}
            aria-describedby={`${id}-hint`}
            onChange={(event) => setHeight(event.target.value)}
          />
        </label>
        <label htmlFor={`${id}-weight`}>
          {t("product.weight")} *
          <input
            id={`${id}-weight`}
            type="number"
            inputMode="numeric"
            min={30}
            max={300}
            step={1}
            value={weight}
            disabled={disabled}
            aria-invalid={weightKg === undefined}
            aria-describedby={`${id}-hint`}
            onChange={(event) => setWeight(event.target.value)}
          />
        </label>
      </div>
      <div id={`${id}-hint`} className="checkout-field-hint">
        {heightCm === undefined && (
          <p className="cart-error" role="alert">
            {t("product.heightError")}
          </p>
        )}
        {weightKg === undefined && (
          <p className="cart-error" role="alert">
            {t("product.weightError")}
          </p>
        )}
        {(item.heightCm === null || item.weightKg === null) && (
          <p>{t("checkout.measurementsHint")}</p>
        )}
      </div>
      {dirty && (
        <Button
          variant="secondary"
          disabled={disabled || heightCm == null || weightKg == null}
          onClick={() =>
            void update(item.id, { heightCm: heightCm!, weightKg: weightKg! })
          }
        >
          {t("cart.saveMeasurements")}
        </Button>
      )}
    </div>
  );
}
