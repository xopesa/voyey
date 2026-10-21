"use client";
import { usePreferences } from "../PreferencesProvider";
import { Button, Card, Page } from "../ui/foundation";
import { CartPhoto } from "../cart/CartItemCard";
import { formatCartAmount } from "../../lib/cart";
import { cancellationReasonText } from "@stenzo/shared";
import {
  orderTimeline,
  orderStatusMeta,
  type CustomerOrder,
  type OrdersError,
} from "../../lib/orders";
import {
  OrderDate,
  OrderStatusBadge,
  OrderPaymentAction,
  OrdersFailure,
} from "./OrderParts";

export function OrderTracking({ order }: { order: CustomerOrder }) {
  const { t, locale } = usePreferences();
  const eta = order.estimatedWarehouseArrival;
  const awaitingWarehouse = [
    "AWAITING_PURCHASE",
    "PURCHASED",
    "IN_TRANSIT",
  ].includes(order.status);
  const format = (value: string, withTime = false) =>
    new Intl.DateTimeFormat(locale === "ru" ? "ru-RU" : "uz-UZ", {
      timeZone: "Asia/Tashkent",
      dateStyle: "short",
      ...(withTime ? { timeStyle: "short" as const } : {}),
    }).format(new Date(withTime ? value : `${value}T00:00:00+05:00`));
  return (
    <Card className="order-tracking">
      <h2>{t("orders.tracking")}</h2>
      <p className="order-section-hint">{t("orders.trackingHint")}</p>
      <ol className="order-timeline">
        {orderTimeline(order.status).map((step, index) => {
          const confirmed =
            step.status === "AWAITING_PURCHASE"
              ? order.paymentConfirmations?.prepayment
              : step.status === "PAID_FULL"
                ? order.paymentConfirmations?.final
                : null;
          return (
            <li
              key={step.status}
              data-state={step.state}
              data-cancelled={step.status === "CANCELLED"}
              aria-current={step.state === "current" ? "step" : undefined}
            >
              <span className="order-timeline__marker" aria-hidden="true">
                {step.state === "completed"
                  ? "✓"
                  : step.status === "CANCELLED"
                    ? "×"
                    : index + 1}
              </span>
              <div>
                <strong>{t(orderStatusMeta[step.status].label)}</strong>
                <span>{t(`orders.stage.${step.state}`)}</span>
                {confirmed && step.state !== "upcoming" && (
                  <small className="order-tracking-note">
                    {t("orders.adminConfirmed")}:{" "}
                    <time dateTime={confirmed}>{format(confirmed, true)}</time>{" "}
                    · {t("orders.tashkentTime")}
                  </small>
                )}
                {step.status === "ARRIVED" && awaitingWarehouse && eta && (
                  <small className="order-tracking-note">
                    {t("orders.warehouseEstimate")}:{" "}
                    <time dateTime={eta}>{format(eta)}</time>
                    <br />
                    {t("orders.warehouseEstimateHint")}
                  </small>
                )}
              </div>
            </li>
          );
        })}
      </ol>
      {order.status === "IN_TRANSIT" && !eta && (
        <p className="order-delivery">{t("orders.inTransit")}</p>
      )}
      {order.status === "CANCELLED" && (
        <p className="order-delivery">{t("orders.cancelledHint")}</p>
      )}
    </Card>
  );
}
export function OrderDetailView({
  order,
  loading,
  error,
  refresh,
}: {
  order: CustomerOrder;
  loading: boolean;
  error?: OrdersError;
  refresh: () => void;
}) {
  const { t, localizedText, locale } = usePreferences();
  const format = (value: number) => formatCartAmount(value, t("cart.currency"));
  const recipient = order.recipient;
  return (
    <Page className="orders-page order-detail" aria-busy={loading}>
      <header className="orders-heading">
        <p className="ui-eyebrow">{t("orders.eyebrow")}</p>
        <h1 className="order-public-id">{order.publicId}</h1>
        <OrderDate value={order.createdAt} />
        <OrderStatusBadge order={order} />
        <Button variant="secondary" disabled={loading} onClick={refresh}>
          {t(loading ? "orders.refreshing" : "orders.refresh")}
        </Button>
      </header>
      {error && <OrdersFailure error={error} retry={refresh} />}
      {order.status === "CANCELLED" && (
        <Card>
          <h2>{t("orders.cancelledTitle")}</h2>
          <p>
            {order.cancellation?.reason
              ? cancellationReasonText[order.cancellation.reason][locale]
              : t("orders.cancellationUnknown")}
          </p>
          {order.cancellation?.refund && (
            <>
              <p>
                {t("orders.refund")}: {format(order.cancellation.refund.amount)}
              </p>
              <p>
                {t(
                  order.cancellation.refund.status === "PENDING"
                    ? "orders.refundPending"
                    : "orders.refundDone",
                )}
              </p>
            </>
          )}
        </Card>
      )}
      <Card className="order-receipt">
        <div className="order-receipt__total">
          <p>{t("cart.fullTotal")}</p>
          <strong>{format(order.total)}</strong>
          <span>{t("cart.count", { count: order.items.length })}</span>
        </div>
        <dl className="order-finance">
          {!!order.discountAmount && (
            <>
              <div>
                <dt>{t("promo.subtotal")}</dt>
                <dd>
                  {format(order.subtotal ?? order.total + order.discountAmount)}
                </dd>
              </div>
              <div>
                <dt>
                  {t("promo.label")} {order.promoCodeSnapshot}
                </dt>
                <dd>−{format(order.discountAmount)}</dd>
              </div>
            </>
          )}
          <div>
            <dt>{t("orders.requiredPrepayment")}</dt>
            <dd>{format(order.requiredPrepayment)}</dd>
          </div>
          <div>
            <dt>{t("payment.paid")}</dt>
            <dd>{format(order.paidAmount)}</dd>
          </div>
          <div>
            <dt>{t("checkout.remaining")}</dt>
            <dd>{format(order.remainingAmount)}</dd>
          </div>
          <div>
            <dt>{t("payment.cargo")}</dt>
            <dd>
              {order.cargoAmount === null
                ? t("orders.cargoNotSet")
                : format(order.cargoAmount)}
            </dd>
          </div>
          <div>
            <dt>{t("payment.cargoPaid")}</dt>
            <dd>{format(order.cargoPaidAmount)}</dd>
          </div>
          <div className="order-finance__due">
            <dt>{t("payment.due")}</dt>
            <dd>{format(order.payment.amountDue)}</dd>
          </div>
        </dl>
        {!error && !loading && (
          <div className="order-payment-action">
            <OrderPaymentAction order={order} />
          </div>
        )}
      </Card>
      <OrderTracking order={order} />
      <section className="order-items" aria-labelledby="order-items-heading">
        <h2 id="order-items-heading">{t("orders.items")}</h2>
        {order.items.map((item, index) => {
          const name = localizedText({
            ru: item.productNameRu,
            uz: item.productNameUz,
          });
          return (
            <Card className="order-item" key={index}>
              <div className="order-item__photo">
                <CartPhoto src={item.imageUrl ?? undefined} name={name} />
              </div>
              <div className="order-item__info">
                <h3>{name}</h3>
                <p>
                  {t("product.size")}: {item.size}
                  {item.color && ` · ${t("product.color")}: ${item.color}`}
                </p>
                <p>{t("checkout.quantity", { count: item.quantity })}</p>
                <p>
                  {t("product.height")}: {item.heightCm ?? t("payment.notSet")}
                  <br />
                  {t("product.weight")}: {item.weightKg ?? t("payment.notSet")}
                </p>
                <dl className="order-item__prices">
                  <div>
                    <dt>{t("cart.unitPrice")}</dt>
                    <dd>{format(item.unitPrice)}</dd>
                  </div>
                  <div>
                    <dt>{t("cart.lineTotal")}</dt>
                    <dd>{format(item.lineTotal)}</dd>
                  </div>
                </dl>
              </div>
            </Card>
          );
        })}
      </section>
      <Card className="order-recipient">
        <details>
          <summary>
            {t("orders.recipient")}
            <span aria-hidden="true">⌄</span>
          </summary>
          <dl>
            {(
              [
                "fullName",
                "phone",
                "city",
                "address",
                "apartment",
                "comment",
              ] as const
            )
              .filter((key) => recipient[key] !== null && recipient[key] !== "")
              .map((key) => (
                <div key={key}>
                  <dt>{t(`orders.recipient.${key}`)}</dt>
                  <dd>{recipient[key]}</dd>
                </div>
              ))}
          </dl>
        </details>
      </Card>
    </Page>
  );
}
