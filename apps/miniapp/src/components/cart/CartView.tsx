"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import { displayedPrepayment, formatCartAmount } from "../../lib/cart";
import type { CartResource, CartState } from "../../lib/cart-resource";
import type { TranslationKey } from "../../lib/i18n";
import { usePreferences } from "../PreferencesProvider";
import { Button, Card, IconButton, Page, Skeleton } from "../ui/foundation";
import { Icon } from "../ui/Icon";
import { ShellActionBar } from "../ui/ShellActionBar";
import { CartClearDialog } from "./CartClearDialog";
import { CartItemCard } from "./CartItemCard";

export function cartFailureKey(state: CartState): TranslationKey {
  switch (state.failure?.kind) {
    case "auth":
      return "cart.authHint";
    case "access":
      return "cart.accessError";
    case "stock":
      return "cart.stockError";
    case "missing":
      return "cart.missingError";
    default:
      return state.failure?.operation?.type === "remove"
        ? "cart.removeError"
        : state.failure?.operation?.type === "clear"
          ? "cart.clearError"
          : state.failure?.operation
            ? "cart.updateError"
            : "home.errorHint";
  }
}

export function CartView({
  state,
  resource,
}: {
  state: CartState;
  resource: CartResource;
}) {
  const { t } = usePreferences();
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, boolean>>({});
  const onDraft = useCallback(
    (id: string, dirty: boolean) =>
      setDrafts((current) =>
        current[id] === dirty ? current : { ...current, [id]: dirty },
      ),
    [],
  );
  const cart = state.cart;
  const busy = state.refreshing || !!state.operation;
  const hasDraft = cart?.items.some((item) => drafts[item.id]) ?? false;
  const authError =
    state.failure?.kind === "auth" || state.failure?.kind === "access";
  const format = (value: number) => formatCartAmount(value, t("cart.currency"));
  const successKey =
    state.success?.type === "remove"
      ? "cart.removed"
      : state.success?.type === "clear"
        ? "cart.cleared"
        : "cart.updated";
  async function clear() {
    if (await resource.clear()) setConfirming(false);
  }
  return (
    <Page className="cart-page">
      <header className="cart-heading">
        <p className="ui-eyebrow">{t("cart.eyebrow")}</p>
        <h1 className="ui-heading">{t("nav.cart")}</h1>
        <p className="ui-copy">{t("cart.subtitle")}</p>
      </header>
      {state.status === "loading" ? (
        <div
          className="cart-loading"
          role="status"
          aria-label={t("cart.loading")}
        >
          <span className="visually-hidden">{t("cart.loading")}</span>
          {[0, 1].map((index) => (
            <div key={index} className="cart-skeleton ui-card">
              <Skeleton className="cart-skeleton__photo" />
              <div>
                <Skeleton className="cart-skeleton__name" />
                <Skeleton className="cart-skeleton__price" />
              </div>
              <Skeleton className="cart-skeleton__controls" />
            </div>
          ))}
        </div>
      ) : !cart ? (
        <Card className="cart-state" role="alert">
          <Icon name={authError ? "profile" : "retry"} />
          <h2>{t(authError ? "cart.authTitle" : "cart.error")}</h2>
          <p className="ui-copy">{t(cartFailureKey(state))}</p>
          <Button onClick={() => void resource.load()}>
            {t("home.retry")}
          </Button>
          <Link href="/catalog" className="ui-button ui-button--secondary">
            {t("cart.toCatalog")}
          </Link>
        </Card>
      ) : (
        <>
          <div
            className="cart-feedback"
            role="status"
            aria-live="polite"
            aria-atomic="true"
          >
            {state.success && <p>{t(successKey)}</p>}
            {state.failure && !state.failure.operation?.itemId && (
              <div className="cart-feedback__error">
                <p className="cart-error">{t(cartFailureKey(state))}</p>
                <Button
                  variant="secondary"
                  disabled={busy}
                  onClick={() => void resource.load()}
                >
                  {t("cart.refresh")}
                </Button>
              </div>
            )}
          </div>
          {cart.items.length === 0 ? (
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
              <div className="cart-tools">
                <p>{t("cart.count", { count: cart.items.length })}</p>
                <div>
                  <IconButton
                    label={t("cart.refresh")}
                    disabled={busy}
                    onClick={() => void resource.load()}
                  >
                    <Icon name="retry" />
                  </IconButton>
                  <button
                    type="button"
                    className="cart-clear"
                    disabled={busy || authError}
                    onClick={() => setConfirming(true)}
                  >
                    {t("cart.clear")}
                  </button>
                </div>
              </div>
              <div className="cart-items">
                {cart.items.map((item) => (
                  <CartItemCard
                    key={item.id}
                    item={item}
                    disabled={busy || authError}
                    operation={
                      state.operation?.itemId === item.id
                        ? (state.operation.type as "update" | "remove")
                        : undefined
                    }
                    update={resource.update}
                    remove={resource.remove}
                    onDraft={onDraft}
                    feedback={
                      state.failure?.operation?.itemId === item.id
                        ? t(cartFailureKey(state))
                        : undefined
                    }
                    retry={() => void resource.load()}
                  />
                ))}
              </div>
              <Card className="cart-summary">
                <h2>{t("cart.summary")}</h2>
                <dl>
                  <div>
                    <dt>{t("cart.fullTotal")}</dt>
                    <dd>{format(cart.subtotal)}</dd>
                  </div>
                  <div>
                    <dt>{t("cart.prepayment")}</dt>
                    <dd>{format(displayedPrepayment(cart.subtotal))}</dd>
                  </div>
                </dl>
                <p className="ui-copy">{t("cart.estimate")}</p>
              </Card>
              <ShellActionBar
                className="cart-actions"
                reserveProperty="--cart-action-height"
              >
                <dl>
                  <div>
                    <dt>{t("product.total")}</dt>
                    <dd>{format(cart.subtotal)}</dd>
                  </div>
                  <div>
                    <dt>{t("cart.prepayment")}</dt>
                    <dd>{format(displayedPrepayment(cart.subtotal))}</dd>
                  </div>
                </dl>
                <Button
                  disabled={busy || authError || hasDraft}
                  onClick={() => {
                    if (!busy && !authError && !hasDraft)
                      router.push("/checkout");
                  }}
                >
                  {t("cart.checkout")}
                  <Icon name="arrow" />
                </Button>
                {hasDraft && (
                  <p className="cart-actions__hint">{t("cart.unsaved")}</p>
                )}
              </ShellActionBar>
            </>
          )}
          {confirming && (
            <CartClearDialog
              pending={state.operation?.type === "clear"}
              error={
                state.failure?.operation?.type === "clear"
                  ? t(cartFailureKey(state))
                  : undefined
              }
              cancel={() => setConfirming(false)}
              confirm={() => void clear()}
            />
          )}
        </>
      )}
    </Page>
  );
}
