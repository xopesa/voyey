"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { ApiRequestError, getCheckoutOrder } from "../../lib/api-client";
import { readAccessToken } from "../../lib/auth-storage";
import type { CheckoutOrder } from "../../lib/checkout";
import { formatCartAmount } from "../../lib/cart";
import { useTelegramSession } from "../TelegramSession";
import { usePreferences } from "../PreferencesProvider";
import { Button, Card, Page, Skeleton } from "../ui/foundation";
export function PaymentPlaceholder({ publicId }: { publicId: string }) {
  const { status } = useTelegramSession();
  const { t } = usePreferences();
  const [order, setOrder] = useState<CheckoutOrder>();
  const [error, setError] = useState<"auth" | "missing" | "request">();
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    setOrder(undefined);
    setError(undefined);
    if (status === "loading") return;
    if (status !== "authenticated") {
      setError("auth");
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    let disposed = false;
    async function load() {
      try {
        const token = readAccessToken();
        if (!token) throw new ApiRequestError(401);
        const order = await getCheckoutOrder(
          publicId,
          token,
          controller.signal,
        );
        if (!disposed && !controller.signal.aborted) setOrder(order);
      } catch (error) {
        if (!disposed)
          setError(
            error instanceof ApiRequestError &&
              (error.status === 401 || error.status === 403)
              ? "auth"
              : error instanceof ApiRequestError && error.status === 404
                ? "missing"
                : "request",
          );
      } finally {
        clearTimeout(timer);
      }
    }
    void load();
    return () => {
      disposed = true;
      clearTimeout(timer);
      controller.abort();
    };
  }, [status, publicId, retry]);
  const format = (value: number) => formatCartAmount(value, t("cart.currency"));
  return (
    <Page className="checkout-page">
      <header className="checkout-heading">
        <p className="ui-eyebrow">{t("checkout.eyebrow")}</p>
        <h1 className="ui-heading">
          {t(order ? "checkout.confirmation" : "checkout.order")}
        </h1>
      </header>
      {order ? (
        <Card className="checkout-section checkout-total" role="status">
          <h2>{t("checkout.saved", { id: order.publicId })}</h2>
          <p className="ui-copy">{t("checkout.paymentPlaceholder")}</p>
          <dl>
            <div>
              <dt>{t("cart.fullTotal")}</dt>
              <dd>{format(order.total)}</dd>
            </div>
            <div>
              <dt>{t("cart.prepayment")}</dt>
              <dd>{format(order.requiredPrepayment)}</dd>
            </div>
            <div>
              <dt>{t("checkout.remaining")}</dt>
              <dd>{format(order.remainingAmount)}</dd>
            </div>
          </dl>
          <Link className="ui-button ui-button--secondary" href="/cart">
            {t("checkout.back")}
          </Link>
        </Card>
      ) : error ? (
        <Card className="cart-state" role="alert">
          <h2>
            {t(error === "auth" ? "cart.authTitle" : "checkout.orderError")}
          </h2>
          <p>
            {t(
              error === "auth"
                ? "cart.authHint"
                : error === "missing"
                  ? "checkout.orderMissing"
                  : "home.errorHint",
            )}
          </p>
          <Button onClick={() => setRetry((value) => value + 1)}>
            {t("home.retry")}
          </Button>
        </Card>
      ) : (
        <Card role="status" aria-label={t("checkout.loading")}>
          <Skeleton className="checkout-skeleton" />
        </Card>
      )}
    </Page>
  );
}
