"use client";
import { effectiveProductPrice } from "@stenzo/shared";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useCart } from "../cart/useCart";
import { formatProductPrice, productIsAvailable } from "../../lib/catalog";
import {
  measurement,
  quantityLimit,
  selectedVariant,
  type ProductDetails,
} from "../../lib/product";
import type { TranslationKey } from "../../lib/i18n";
import { usePreferences } from "../PreferencesProvider";
import { Button, Card, Divider, IconButton } from "../ui/foundation";
import { Icon } from "../ui/Icon";
import { ProductActions } from "./ProductActions";
import { ProductGallery } from "./ProductGallery";

export function ProductView({
  product,
  reload,
}: {
  product: ProductDetails;
  reload: () => void;
}) {
  const { t, locale, localizedText } = usePreferences();
  const router = useRouter();
  const { resource, state: cartState } = useCart();
  const sizes = [...new Set(product.variants.map((v) => v.size))];
  const colors = [...new Set(product.variants.map((v) => v.color))];
  const [size, setSize] = useState<string>();
  const [color, setColor] = useState<string | null | undefined>(
    colors.length === 1 ? colors[0] : undefined,
  );
  const [quantity, setQuantity] = useState(1);
  const [height, setHeight] = useState("");
  const [weight, setWeight] = useState("");
  const [pending, setPending] = useState(false);
  const [feedback, setFeedback] = useState<TranslationKey>();
  const active = useRef(true);
  const submitting = useRef(false);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  const variant = selectedVariant(product, size, color);
  const limit = quantityLimit(variant);
  const heightCm = measurement(height, 100, 250);
  const weightKg = measurement(weight, 30, 300);
  const available = productIsAvailable(product);
  const name = localizedText({ ru: product.nameRu, uz: product.nameUz });
  const description = localizedText({
    ru: product.descriptionRu,
    uz: product.descriptionUz,
  });
  const canSubmit =
    !!variant &&
    quantity >= 1 &&
    quantity <= limit &&
    heightCm !== undefined &&
    weightKg !== undefined &&
    !pending &&
    !cartState.refreshing &&
    !cartState.operation;

  function chooseSize(value: string) {
    setSize(value);
    setQuantity(1);
    setFeedback(undefined);
  }
  function chooseColor(value: string | null) {
    setColor(value);
    if (!selectedVariant(product, size, value)) setSize(undefined);
    setQuantity(1);
    setFeedback(undefined);
  }
  async function purchase(buy: boolean) {
    if (
      submitting.current ||
      !canSubmit ||
      !variant ||
      heightCm === undefined ||
      weightKg === undefined
    )
      return;
    submitting.current = true;
    setPending(true);
    setFeedback(undefined);
    try {
      const confirmed = await resource.add({
        productId: product.id,
        variantId: variant.id,
        quantity,
        heightCm,
        weightKg,
      });
      if (!active.current) return;
      if (!confirmed) {
        const failure = resource.snapshot().failure?.kind;
        setFeedback(
          failure === "auth"
            ? "product.authError"
            : failure === "access"
              ? "product.accessError"
              : failure === "stock"
                ? "product.stockError"
                : "product.submitError",
        );
        return;
      }
      setFeedback("product.saved");
      if (buy) router.push("/cart");
    } catch {
      if (active.current) setFeedback("product.submitError");
    } finally {
      submitting.current = false;
      if (active.current) setPending(false);
    }
  }

  return (
    <>
      <ProductGallery product={product} name={name} />
      <div className="product-info">
        <header className="product-info__heading">
          <p className="ui-eyebrow">
            {localizedText({
              ru: product.category.nameRu,
              uz: product.category.nameUz,
            })}
          </p>
          <h1>{name}</h1>
          <p className="product-info__price">
            {effectiveProductPrice(product).isOnSale && (
              <del className="sale-original">
                {formatProductPrice(product.price, locale)}
              </del>
            )}
            {formatProductPrice(
              effectiveProductPrice(product).effectivePrice,
              locale,
            )}
          </p>
          {!available && (
            <p className="product-unavailable" role="status">
              {t("catalog.unavailable")}
            </p>
          )}
        </header>
        {sizes.length > 0 && (
          <fieldset disabled={pending} className="product-options">
            <legend>{t("product.size")}</legend>
            <div className="product-options__row">
              {sizes.map((value) => {
                const enabled = product.variants.some(
                  (v) =>
                    v.size === value &&
                    (color === undefined || v.color === color) &&
                    quantityLimit(v) > 0,
                );
                return (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={size === value}
                    disabled={!enabled}
                    onClick={() => chooseSize(value)}
                  >
                    {value}
                  </button>
                );
              })}
            </div>
          </fieldset>
        )}
        {colors.some((value) => value !== null) && (
          <fieldset
            disabled={pending}
            className="product-options product-options--colors"
          >
            <legend>{t("product.color")}</legend>
            <div className="product-options__row">
              {colors.map((value) => (
                <button
                  key={value === null ? "null" : `color:${value}`}
                  type="button"
                  aria-pressed={color === value}
                  disabled={
                    !product.variants.some(
                      (v) => v.color === value && quantityLimit(v) > 0,
                    )
                  }
                  onClick={() => chooseColor(value)}
                >
                  {value ?? t("product.standardColor")}
                </button>
              ))}
            </div>
          </fieldset>
        )}
        <div className="product-quantity">
          <div>
            <h2>{t("product.quantity")}</h2>
            <p className="ui-copy" aria-live="polite">
              {variant
                ? t(
                    variant.stock === null
                      ? "product.available"
                      : "product.stock",
                    { count: variant.stock ?? 0 },
                  )
                : available
                  ? t("product.chooseVariant")
                  : t("catalog.unavailable")}
            </p>
          </div>
          <div
            className="product-quantity__controls"
            role="group"
            aria-label={t("product.quantity")}
          >
            <IconButton
              label={t("product.decrease")}
              disabled={pending || !variant || quantity <= 1}
              onClick={() => {
                setQuantity((q) => q - 1);
                setFeedback(undefined);
              }}
            >
              <Icon name="minus" />
            </IconButton>
            <output aria-live="polite">{quantity}</output>
            <IconButton
              label={t("product.increase")}
              disabled={pending || !variant || quantity >= limit}
              onClick={() => {
                setQuantity((q) => q + 1);
                setFeedback(undefined);
              }}
            >
              <Icon name="plus" />
            </IconButton>
          </div>
        </div>
        <Divider />
        <section
          className="product-description"
          aria-labelledby="product-description-title"
        >
          <h2 id="product-description-title">{t("product.description")}</h2>
          {description && <p>{description}</p>}
          <dl>
            <dt>{t("product.category")}</dt>
            <dd>
              {localizedText({
                ru: product.category.nameRu,
                uz: product.category.nameUz,
              })}
            </dd>
          </dl>
        </section>
        <Card className="product-measurements">
          <h2>{t("product.measurements")}</h2>
          <p className="ui-copy" id="product-measurements-hint">
            {t("product.measurementsHint")}
          </p>
          <div className="product-measurements__fields">
            <label htmlFor="product-height">
              {t("product.height")}
              <input
                id="product-height"
                type="number"
                inputMode="numeric"
                min={100}
                max={250}
                step={1}
                value={height}
                disabled={pending}
                aria-invalid={heightCm === undefined}
                aria-describedby={
                  heightCm === undefined
                    ? "product-height-error product-measurements-hint"
                    : "product-measurements-hint"
                }
                onChange={(event) => {
                  setHeight(event.target.value);
                  setFeedback(undefined);
                }}
              />
            </label>
            <label htmlFor="product-weight">
              {t("product.weight")}
              <input
                id="product-weight"
                type="number"
                inputMode="numeric"
                min={30}
                max={300}
                step={1}
                value={weight}
                disabled={pending}
                aria-invalid={weightKg === undefined}
                aria-describedby={
                  weightKg === undefined
                    ? "product-weight-error product-measurements-hint"
                    : "product-measurements-hint"
                }
                onChange={(event) => {
                  setWeight(event.target.value);
                  setFeedback(undefined);
                }}
              />
            </label>
          </div>
          {heightCm === undefined && (
            <p id="product-height-error" className="product-error" role="alert">
              {t("product.heightError")}
            </p>
          )}
          {weightKg === undefined && (
            <p id="product-weight-error" className="product-error" role="alert">
              {t("product.weightError")}
            </p>
          )}
        </Card>
        <section
          className="product-delivery"
          aria-labelledby="product-delivery-title"
        >
          <Icon name="orders" />
          <div>
            <h2 id="product-delivery-title">{t("product.delivery")}</h2>
            <p>{t("product.deliveryTime")}</p>
            <p className="ui-copy">{t("product.cargo")}</p>
          </div>
        </section>
      </div>
      <ProductActions>
        <div className="product-actions__summary">
          <span>{t("product.total")}</span>
          <strong>
            {formatProductPrice(
              effectiveProductPrice(product).effectivePrice * quantity,
              locale,
            )}
          </strong>
        </div>
        <div className="product-actions__buttons">
          <Button
            variant="secondary"
            disabled={!canSubmit}
            onClick={() => void purchase(false)}
          >
            {t(pending ? "product.saving" : "product.add")}
          </Button>
          <Button disabled={!canSubmit} onClick={() => void purchase(true)}>
            {t("product.buy")}
          </Button>
        </div>
        <div
          className="product-actions__feedback"
          role="status"
          aria-live="polite"
          aria-atomic="true"
          data-error={!!feedback && feedback !== "product.saved"}
        >
          {feedback && (
            <>
              <span>{t(feedback)}</span>
              {(feedback === "product.saved" ||
                feedback === "product.submitError" ||
                feedback === "product.stockError") && (
                <Link href="/cart">{t("product.checkCart")}</Link>
              )}
              {feedback === "product.stockError" && (
                <button type="button" onClick={reload}>
                  {t("home.retry")}
                </button>
              )}
            </>
          )}
        </div>
      </ProductActions>
    </>
  );
}
