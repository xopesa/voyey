"use client";
import Image from "next/image";
import { useEffect, useId, useState, type FormEvent } from "react";
import {
  cartCanDecrease,
  cartDecreasedQuantity,
  cartQuantityLimit,
  cartImageSource,
  formatCartAmount,
  type CartItem,
  type CartItemPatch,
} from "../../lib/cart";
import { measurement } from "../../lib/product";
import { usePreferences } from "../PreferencesProvider";
import { Button, IconButton } from "../ui/foundation";
import { Icon } from "../ui/Icon";

export function CartPhoto({ src, name }: { src?: string; name: string }) {
  const { t } = usePreferences();
  const [failed, setFailed] = useState(false);
  return (
    <div className="cart-item__photo">
      {src && !failed ? (
        <Image
          src={src}
          alt={name}
          fill
          unoptimized
          sizes="(max-width: 480px) 35vw, 150px"
          onError={() => setFailed(true)}
        />
      ) : (
        <span
          role="img"
          aria-label={t("home.productNoImage")}
          className="cart-item__placeholder"
        >
          <Icon name="image" />
          <span>{t("home.productNoImage")}</span>
        </span>
      )}
    </div>
  );
}

export function CartItemCard({
  item,
  disabled,
  operation,
  update,
  remove,
  onDraft,
  feedback,
  retry,
}: {
  item: CartItem;
  disabled: boolean;
  operation?: "update" | "remove";
  update: (id: string, input: CartItemPatch) => Promise<boolean>;
  remove: (id: string) => Promise<boolean>;
  onDraft: (id: string, dirty: boolean) => void;
  feedback?: string;
  retry: () => void;
}) {
  const { t, localizedText } = usePreferences();
  const id = useId();
  const name = localizedText({
    ru: item.product.nameRu,
    uz: item.product.nameUz,
  });
  const [height, setHeight] = useState(
    item.heightCm === null ? "" : String(item.heightCm),
  );
  const [weight, setWeight] = useState(
    item.weightKg === null ? "" : String(item.weightKg),
  );
  const heightCm = measurement(height, 100, 250);
  const weightKg = measurement(weight, 30, 300);
  const dirty = heightCm !== item.heightCm || weightKg !== item.weightKg;
  useEffect(() => {
    setHeight(item.heightCm === null ? "" : String(item.heightCm));
    setWeight(item.weightKg === null ? "" : String(item.weightKg));
  }, [item.heightCm, item.weightKg]);
  useEffect(() => {
    onDraft(item.id, dirty);
    return () => onDraft(item.id, false);
  }, [item.id, dirty, onDraft]);
  function save(event: FormEvent) {
    event.preventDefault();
    if (!disabled && dirty && heightCm !== undefined && weightKg !== undefined)
      void update(item.id, { heightCm, weightKg });
  }
  const src = cartImageSource(item);
  const format = (price: number) => formatCartAmount(price, t("cart.currency"));
  return (
    <article
      className="cart-item ui-card"
      aria-labelledby={`${id}-name`}
      aria-busy={!!operation}
      data-unavailable={!item.isAvailable}
    >
      <div className="cart-item__top">
        <CartPhoto key={src ?? "empty"} src={src} name={name} />
        <div className="cart-item__info">
          <h2 id={`${id}-name`}>{name}</h2>
          <dl className="cart-item__variant">
            <div>
              <dt>{t("product.size")}</dt>
              <dd>{item.variant.size}</dd>
            </div>
            {item.variant.color && (
              <div>
                <dt>{t("product.color")}</dt>
                <dd>{item.variant.color}</dd>
              </div>
            )}
          </dl>
          <p className="cart-item__unit">
            <span>{t("cart.unitPrice")}</span>
            <strong>
              {item.isOnSale && item.originalUnitPrice != null && (
                <del className="sale-original">
                  {format(item.originalUnitPrice)}
                </del>
              )}
              {format(item.unitPrice)}
            </strong>
          </p>
        </div>
      </div>
      {!item.isAvailable && (
        <p className="cart-item__unavailable" role="status">
          {item.variant.stock !== null &&
          item.variant.stock > 0 &&
          item.quantity > item.variant.stock
            ? t("cart.stockChanged", { count: item.variant.stock })
            : t("cart.unavailable")}
        </p>
      )}
      <div className="cart-item__quantity-row">
        <div
          className="cart-item__quantity"
          role="group"
          aria-label={t("product.quantity")}
        >
          <IconButton
            label={t("product.decrease")}
            disabled={disabled || !cartCanDecrease(item)}
            onClick={() =>
              void update(item.id, { quantity: cartDecreasedQuantity(item) })
            }
          >
            <Icon name="minus" />
          </IconButton>
          <output aria-live="polite">{item.quantity}</output>
          <IconButton
            label={t("product.increase")}
            disabled={
              disabled ||
              !item.isAvailable ||
              item.quantity >= cartQuantityLimit(item)
            }
            onClick={() =>
              void update(item.id, { quantity: item.quantity + 1 })
            }
          >
            <Icon name="plus" />
          </IconButton>
        </div>
        <IconButton
          label={t("cart.remove", { name })}
          disabled={disabled}
          className="cart-item__remove"
          onClick={() => void remove(item.id)}
        >
          <Icon name="close" />
        </IconButton>
      </div>
      <div className="cart-item__line-total">
        <span>{t("cart.lineTotal")}</span>
        <strong>{format(item.lineTotal)}</strong>
      </div>
      <form className="cart-item__measurements" onSubmit={save}>
        <div className="cart-item__fields">
          <label htmlFor={`${id}-height`}>
            {t("product.height")}
            <input
              id={`${id}-height`}
              type="number"
              min={100}
              max={250}
              step={1}
              inputMode="numeric"
              value={height}
              disabled={disabled}
              aria-invalid={heightCm === undefined}
              aria-describedby={`${id}-hint${heightCm === undefined ? ` ${id}-height-error` : ""}`}
              onChange={(event) => setHeight(event.target.value)}
            />
          </label>
          <label htmlFor={`${id}-weight`}>
            {t("product.weight")}
            <input
              id={`${id}-weight`}
              type="number"
              min={30}
              max={300}
              step={1}
              inputMode="numeric"
              value={weight}
              disabled={disabled}
              aria-invalid={weightKg === undefined}
              aria-describedby={`${id}-hint${weightKg === undefined ? ` ${id}-weight-error` : ""}`}
              onChange={(event) => setWeight(event.target.value)}
            />
          </label>
        </div>
        <p id={`${id}-hint`} className="cart-item__hint">
          {(item.heightCm === null || item.weightKg === null) &&
            t("cart.measurementsMissing")}
        </p>
        {heightCm === undefined && (
          <p id={`${id}-height-error`} role="alert" className="cart-error">
            {t("product.heightError")}
          </p>
        )}
        {weightKg === undefined && (
          <p id={`${id}-weight-error`} role="alert" className="cart-error">
            {t("product.weightError")}
          </p>
        )}
        {dirty && (
          <Button
            type="submit"
            variant="secondary"
            disabled={
              disabled || heightCm === undefined || weightKg === undefined
            }
          >
            {t("cart.saveMeasurements")}
          </Button>
        )}
      </form>
      {operation && (
        <p className="cart-item__pending" role="status">
          {t(operation === "remove" ? "cart.removing" : "cart.updating")}
        </p>
      )}
      {feedback && (
        <div className="cart-item__feedback">
          <p className="cart-error" role="alert">
            {feedback}
          </p>
          <Button variant="secondary" disabled={!!operation} onClick={retry}>
            {t("cart.refresh")}
          </Button>
        </div>
      )}
    </article>
  );
}
