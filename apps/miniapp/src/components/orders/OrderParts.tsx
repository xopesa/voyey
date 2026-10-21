"use client";
import Link from "next/link";
import { usePreferences } from "../PreferencesProvider";
import { Badge, Button, Card, Page, Skeleton } from "../ui/foundation";
import { CartPhoto } from "../cart/CartItemCard";
import { formatCartAmount } from "../../lib/cart";
import {
  orderHref,
  orderPaymentHref,
  orderStatusMeta,
  type CustomerOrder,
  type OrdersError,
} from "../../lib/orders";

export function OrderDate({ value }: { value: string }) {
  const { locale } = usePreferences();
  return (
    <time dateTime={value}>
      {new Intl.DateTimeFormat(locale === "uz" ? "uz-UZ" : "ru-RU", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
      }).format(new Date(value))}
    </time>
  );
}
export function OrderStatusBadge({ order }: { order: CustomerOrder }) {
  const { t } = usePreferences();
  return (
    <Badge
      tone={order.status === "CANCELLED" ? "neutral" : "accent"}
      className="order-status-badge"
      data-cancelled={order.status === "CANCELLED"}
    >
      {t(orderStatusMeta[order.status].label)}
    </Badge>
  );
}
export function OrdersLoading({ detail = false }: { detail?: boolean }) {
  const { t } = usePreferences();
  return (
    <Page
      className="orders-page"
      role="status"
      aria-label={t("orders.loading")}
    >
      <span className="visually-hidden">{t("orders.loading")}</span>
      {(detail ? [0, 1] : [0, 1, 2]).map((id) => (
        <Skeleton key={id} className="orders-skeleton" />
      ))}
    </Page>
  );
}
export function OrdersFailure({
  error,
  retry,
}: {
  error: OrdersError;
  retry: () => void;
}) {
  const { t } = usePreferences();
  return (
    <Card className="cart-state" role="alert">
      <h2>
        {t(
          error === "auth"
            ? "cart.authTitle"
            : error === "missing"
              ? "orders.missing"
              : "orders.error",
        )}
      </h2>
      <p>
        {t(
          error === "auth"
            ? "cart.authHint"
            : error === "missing"
              ? "orders.missingHint"
              : "home.errorHint",
        )}
      </p>
      <Button onClick={retry}>{t("home.retry")}</Button>
      {error === "missing" && (
        <Link className="ui-button ui-button--secondary" href="/orders">
          {t("orders.back")}
        </Link>
      )}
    </Card>
  );
}
export function OrderPaymentAction({ order }: { order: CustomerOrder }) {
  const { t } = usePreferences();
  const action = orderStatusMeta[order.status].action;
  if (action === null) return null;
  if (action === "prepaymentReview" || action === "finalReview")
    return (
      <p role="status" className="order-review">
        {t(
          action === "finalReview"
            ? "orders.finalReview"
            : "orders.prepaymentReview",
        )}
      </p>
    );
  return (
    <Link
      className="ui-button ui-button--primary"
      href={orderPaymentHref(order.publicId)}
    >
      {t(action === "final" ? "orders.payFinal" : "orders.payPrepayment")}
    </Link>
  );
}
export function OrderListCard({ order }: { order: CustomerOrder }) {
  const { t, localizedText } = usePreferences();
  const format = (value: number) => formatCartAmount(value, t("cart.currency"));
  return (
    <Link
      className="order-list-card ui-card"
      href={orderHref(order.publicId)}
      aria-label={t("orders.open", { id: order.publicId })}
    >
      <div className="order-list-card__meta">
        <strong>{order.publicId}</strong>
        <OrderDate value={order.createdAt} />
      </div>
      <OrderStatusBadge order={order} />
      <div className="order-list-card__summary">
        <div className="order-thumbnails">
          {order.items.slice(0, 3).map((item, index) => (
            <div key={index}>
              <CartPhoto
                src={item.imageUrl ?? undefined}
                name={localizedText({
                  ru: item.productNameRu,
                  uz: item.productNameUz,
                })}
              />
            </div>
          ))}
        </div>
        <div>
          <p>{t("cart.count", { count: order.items.length })}</p>
          <strong>{format(order.total)}</strong>
        </div>
      </div>
      <dl className="order-finance order-finance--compact">
        <div>
          <dt>{t("payment.paid")}</dt>
          <dd>{format(order.paidAmount)}</dd>
        </div>
        <div>
          <dt>{t("checkout.remaining")}</dt>
          <dd>{format(order.remainingAmount)}</dd>
        </div>
        {order.cargoAmount !== null && (
          <div>
            <dt>{t("payment.cargo")}</dt>
            <dd>{format(order.cargoAmount)}</dd>
          </div>
        )}
      </dl>
      <span className="order-open-label">
        {t("orders.details")} <span aria-hidden="true">↗</span>
      </span>
    </Link>
  );
}
