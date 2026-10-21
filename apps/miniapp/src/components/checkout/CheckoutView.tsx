"use client";
import Link from "next/link";
import type { PromoCartQuote } from "@stenzo/shared";
import { validatePromoCode } from "../../lib/api-client";
import { readAccessToken } from "../../lib/auth-storage";
import { formatCartAmount } from "../../lib/cart";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { CartResource, CartState } from "../../lib/cart-resource";
import {
  checkoutCartIssue,
  checkoutCartVersion,
  emptyRecipient,
  recipientErrors,
  recipientLimits,
  recipientPayload,
  type RecipientDraft,
  type RecipientInput,
} from "../../lib/checkout";
import type { CheckoutFlow, CheckoutState } from "../../lib/checkout-flow";
import type { TranslationKey } from "../../lib/i18n";
import { cartFailureKey } from "../cart/CartView";
import { usePreferences } from "../PreferencesProvider";
import { Button, Card, Page, Skeleton } from "../ui/foundation";
import { ShellActionBar } from "../ui/ShellActionBar";
import { Icon } from "../ui/Icon";
import { CheckoutMeasurements } from "./CheckoutMeasurements";
import { CheckoutSummary } from "./CheckoutSummary";
export function CheckoutView({
  state,
  cartResource,
  checkout,
  flow,
}: {
  state: CartState;
  cartResource: CartResource;
  checkout: CheckoutState;
  flow: CheckoutFlow;
}) {
  const { t } = usePreferences();
  const id = useId();
  const form = useRef<HTMLFormElement>(null);
  const feedback = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (checkout.failure || state.failure) {
      feedback.current?.focus({ preventScroll: true });
      feedback.current?.scrollIntoView({ block: "center" });
    }
  }, [checkout.failure, checkout.phase, state.failure]);
  const [draft, setDraft] = useState<RecipientDraft>(emptyRecipient);
  const [submitted, setSubmitted] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, boolean>>({});
  const onDraft = useCallback(
    (id: string, dirty: boolean) =>
      setDrafts((current) =>
        current[id] === dirty ? current : { ...current, [id]: dirty },
      ),
    [],
  );
  const [promoCode, setPromoCode] = useState("");
  const [promo, setPromo] = useState<{
    result: PromoCartQuote;
    version: string;
  } | null>(null);
  const [promoPending, setPromoPending] = useState(false);
  const [promoError, setPromoError] = useState(false);
  const [promoChanged, setPromoChanged] = useState(false);
  const promoLock = useRef(false),
    promoGeneration = useRef(0);
  const cart = state.cart;
  const version = cart ? checkoutCartVersion(cart) : "";
  const applied =
    promo?.version === version && promo.result.valid ? promo.result : undefined;
  async function applyPromo() {
    if (promoLock.current || !promoCode.trim()) return;
    promoLock.current = true;
    setPromoPending(true);
    setPromoError(false);
    setPromo(null);
    setPromoChanged(false);
    const generation = ++promoGeneration.current;
    const token = readAccessToken();
    try {
      const result = await validatePromoCode(promoCode.trim(), token ?? "");
      if (
        generation === promoGeneration.current &&
        token === readAccessToken()
      ) {
        if (result.cartVersion !== version) {
          setPromo(null);
          setPromoChanged(true);
          await cartResource.load();
        } else {
          setPromo({ result, version: result.cartVersion });
        }
      }
    } catch {
      if (generation === promoGeneration.current) setPromoError(true);
    } finally {
      promoLock.current = false;
      setPromoPending(false);
    }
  }
  const issue = cart ? checkoutCartIssue(cart) : undefined;
  const hasDraft = cart?.items.some((item) => drafts[item.id]) ?? false;
  const sending =
    checkout.phase === "checking" || checkout.phase === "submitting";
  const busy = sending || promoPending || state.refreshing || !!state.operation;
  const auth =
    state.failure?.kind === "auth" || state.failure?.kind === "access";
  const errors = recipientErrors(draft);
  const canSubmit =
    !!cart &&
    !busy &&
    !auth &&
    !hasDraft &&
    (!promoCode.trim() || !!applied || checkout.recoverable) &&
    checkout.phase !== "success" &&
    (!issue || checkout.recoverable);
  const labels: Record<keyof RecipientInput, TranslationKey> = {
    fullName: "checkout.fullName",
    phone: "checkout.phone",
    city: "checkout.city",
    address: "checkout.address",
    apartment: "checkout.apartment",
    comment: "checkout.comment",
  };
  function field(key: keyof RecipientInput, autoComplete?: string) {
    const error = submitted && !!errors[key];
    const required = key !== "apartment" && key !== "comment";
    const props = {
      id: `${id}-${key}`,
      name: key,
      value: draft[key],
      disabled: busy,
      onChange: (
        event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
      ) => setDraft((current) => ({ ...current, [key]: event.target.value })),
      maxLength: recipientLimits[key][1],
      required,
      autoComplete,
      "aria-invalid": error,
      "aria-describedby": `${id}-${key}-hint`,
    };
    return (
      <label className="checkout-field" key={key} htmlFor={props.id}>
        {t(labels[key])}
        {required ? " *" : ` · ${t("checkout.optional")}`}
        {key === "comment" ? (
          <textarea {...props} rows={3} />
        ) : (
          <input
            {...props}
            type={key === "phone" ? "tel" : "text"}
            inputMode={key === "phone" ? "tel" : "text"}
          />
        )}
        <span
          id={`${id}-${key}-hint`}
          className={error ? "cart-error" : "checkout-field-hint"}
        >
          {error
            ? t(
                key === "phone" ? "checkout.phoneError" : "checkout.fieldError",
                { min: recipientLimits[key][0], max: recipientLimits[key][1] },
              )
            : key === "phone"
              ? t("checkout.phoneHint")
              : ""}
        </span>
      </label>
    );
  }
  return (
    <Page className="checkout-page">
      <header className="checkout-heading">
        <p className="ui-eyebrow">{t("checkout.eyebrow")}</p>
        <h1 className="ui-heading">{t("checkout.title")}</h1>
        <p className="ui-copy">{t("checkout.subtitle")}</p>
      </header>
      {state.status === "loading" ? (
        <div
          role="status"
          aria-label={t("checkout.loading")}
          className="checkout-loading"
        >
          {[0, 1, 2].map((index) => (
            <Card key={index}>
              <Skeleton className="checkout-skeleton" />
              <Skeleton className="checkout-skeleton" />
            </Card>
          ))}
        </div>
      ) : !cart ? (
        <Card className="cart-state" role="alert">
          <h2>{t(auth ? "cart.authTitle" : "checkout.loadError")}</h2>
          <p>{t(cartFailureKey(state))}</p>
          <Button onClick={() => void cartResource.load()}>
            {t("home.retry")}
          </Button>
          <Link href="/cart" className="ui-button ui-button--secondary">
            {t("checkout.back")}
          </Link>
        </Card>
      ) : cart.items.length === 0 && !checkout.recoverable ? (
        <Card className="cart-state">
          <Icon name="cart" />
          <h2>{t("cart.empty")}</h2>
          <p className="ui-copy">{t("cart.emptyHint")}</p>
          <Link href="/catalog" className="ui-button ui-button--primary">
            {t("cart.toCatalog")}
          </Link>
        </Card>
      ) : (
        <>
          <form
            ref={form}
            id={`${id}-form`}
            noValidate
            className="checkout-form"
            onSubmit={(event) => {
              event.preventDefault();
              setSubmitted(true);
              if (Object.keys(errors).length) {
                form.current
                  ?.querySelector<HTMLInputElement>(
                    `[name="${Object.keys(errors)[0]}"]`,
                  )
                  ?.focus();
                return;
              }
              if (canSubmit)
                void flow.submit(cart, {
                  ...recipientPayload(draft),
                  ...(applied ? { promoCode: applied.code } : {}),
                });
            }}
          >
            {checkout.recoverable && (
              <Card role="status" className="checkout-notice">
                <p>{t("checkout.recovery")}</p>
                {checkout.promoCode && (
                  <p>
                    {t("promo.label")}: {checkout.promoCode}
                  </p>
                )}
              </Card>
            )}
            {checkout.failure && (
              <div ref={feedback} tabIndex={-1}>
                <Card role="alert" className="checkout-notice">
                  <p className="cart-error">
                    {t(`checkout.error.${checkout.failure}` as TranslationKey)}
                  </p>
                </Card>
              </div>
            )}
            {state.failure && (
              <div ref={checkout.failure ? undefined : feedback} tabIndex={-1}>
                <Card role="alert" className="checkout-notice">
                  <p className="cart-error">{t(cartFailureKey(state))}</p>
                  <Button
                    variant="secondary"
                    disabled={busy}
                    onClick={() => void cartResource.load()}
                  >
                    {t("cart.refresh")}
                  </Button>
                </Card>
              </div>
            )}
            <Card className="checkout-section">
              <h2>
                <span>1</span>
                {t("checkout.contacts")}
              </h2>
              {field("fullName", "name")}
              {field("phone", "tel")}
            </Card>
            <Card className="checkout-section">
              <h2>
                <span>2</span>
                {t("checkout.delivery")}
              </h2>
              {field("city", "address-level2")}
              {field("address", "street-address")}
              {field("apartment", "address-line2")}
              {field("comment")}
            </Card>
            {!!cart.items.length && (
              <>
                <Card className="checkout-section">
                  <h2>
                    <span>3</span>
                    {t("checkout.measurements")}
                  </h2>
                  <p className="ui-copy">{t("checkout.measurementsHint")}</p>
                  {cart.items.map((item) => (
                    <CheckoutMeasurements
                      key={item.id}
                      item={item}
                      disabled={busy}
                      update={cartResource.update}
                      onDraft={onDraft}
                    />
                  ))}
                  {issue === "measurements" && (
                    <p className="cart-error" role="alert">
                      {t("checkout.error.measurements")}
                    </p>
                  )}
                  <Link href="/cart" className="checkout-text-link">
                    {t("checkout.editCart")}
                  </Link>
                </Card>
                <Card className="checkout-section checkout-promo">
                  <label htmlFor={`${id}-promo`}>{t("promo.label")}</label>
                  <div className="checkout-promo__input">
                    <input
                      id={`${id}-promo`}
                      value={promoCode}
                      maxLength={32}
                      disabled={busy || checkout.recoverable}
                      autoComplete="off"
                      autoCapitalize="characters"
                      onChange={(e) => {
                        setPromoCode(e.target.value);
                        setPromo(null);
                        setPromoError(false);
                        setPromoChanged(false);
                        promoGeneration.current++;
                      }}
                    />
                    <Button
                      type="button"
                      variant="secondary"
                      disabled={
                        busy || checkout.recoverable || !promoCode.trim()
                      }
                      onClick={() => void applyPromo()}
                    >
                      {t(promoPending ? "promo.checking" : "promo.apply")}
                    </Button>
                  </div>
                  {promoCode && (
                    <button
                      type="button"
                      className="checkout-text-link"
                      disabled={busy || checkout.recoverable}
                      onClick={() => {
                        setPromoCode("");
                        setPromo(null);
                        setPromoError(false);
                        setPromoChanged(false);
                        promoGeneration.current++;
                      }}
                    >
                      {t("promo.remove")}
                    </button>
                  )}
                  <p
                    className={applied ? "ui-copy" : "cart-error"}
                    role="status"
                  >
                    {applied
                      ? `${t("promo.label")} ${applied.code} · ${t("promo.discount")}: ${formatCartAmount(applied.discountAmount, t("cart.currency"))}`
                      : promoError
                        ? t("promo.requestError")
                        : promoChanged || (promo && promo.version !== version)
                          ? t("promo.changed")
                          : promo && !promo.result.valid
                            ? t(
                                `promo.${promo.result.reason}` as TranslationKey,
                              )
                            : promoCode.trim()
                              ? t("promo.applyHint")
                              : t("promo.optional")}
                  </p>
                </Card>
                <CheckoutSummary cart={cart} promo={applied} />
              </>
            )}
            {issue === "unavailable" && (
              <Card className="checkout-notice" role="alert">
                <p className="cart-error">{t("checkout.error.stock")}</p>
                <Link href="/cart" className="ui-button ui-button--secondary">
                  {t("checkout.editCart")}
                </Link>
              </Card>
            )}
          </form>
          <ShellActionBar
            className="checkout-actions"
            reserveProperty="--checkout-action-height"
          >
            <Button type="submit" form={`${id}-form`} disabled={!canSubmit}>
              {t(
                sending
                  ? "checkout.submitting"
                  : checkout.recoverable
                    ? "checkout.retryAttempt"
                    : "cart.checkout",
              )}
              <Icon name="arrow" />
            </Button>
            <p className="checkout-field-hint" role="status">
              {t(
                hasDraft
                  ? "cart.unsaved"
                  : issue === "measurements" && !checkout.recoverable
                    ? "checkout.error.measurements"
                    : "checkout.actionHint",
              )}
            </p>
          </ShellActionBar>
        </>
      )}
    </Page>
  );
}
