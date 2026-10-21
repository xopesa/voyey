import {
  isPaymentOrder,
  orderStatuses,
  type PaymentOrder,
  type OrderStatus,
} from "./payment";
import type { RecipientInput } from "./checkout";
import type { TranslationKey } from "./i18n";

export interface CustomerOrder extends PaymentOrder {
  cancellation?: import("@stenzo/shared").CustomerCancellation;
  recipient: RecipientInput;
}
export interface OrdersPage {
  orders: CustomerOrder[];
  nextCursor: string | null;
}
export type OrdersFilter = "all" | "active" | "completed";
export type OrderAction =
  "prepayment" | "prepaymentReview" | "final" | "finalReview" | null;
interface StatusMeta {
  label: TranslationKey;
  group: "active" | "completed";
  action: OrderAction;
}
export const orderStatusMeta = {
  AWAITING_PREPAYMENT: {
    label: "payment.orderStatus.AWAITING_PREPAYMENT",
    group: "active",
    action: "prepayment",
  },
  PREPAYMENT_SUBMITTED: {
    label: "payment.orderStatus.PREPAYMENT_SUBMITTED",
    group: "active",
    action: "prepaymentReview",
  },
  AWAITING_PURCHASE: {
    label: "payment.orderStatus.AWAITING_PURCHASE",
    group: "active",
    action: null,
  },
  PURCHASED: {
    label: "payment.orderStatus.PURCHASED",
    group: "active",
    action: null,
  },
  IN_TRANSIT: {
    label: "payment.orderStatus.IN_TRANSIT",
    group: "active",
    action: null,
  },
  ARRIVED: {
    label: "payment.orderStatus.ARRIVED",
    group: "active",
    action: null,
  },
  WEIGHING: {
    label: "payment.orderStatus.WEIGHING",
    group: "active",
    action: null,
  },
  AWAITING_FINAL_PAYMENT: {
    label: "payment.orderStatus.AWAITING_FINAL_PAYMENT",
    group: "active",
    action: "final",
  },
  FINAL_PAYMENT_SUBMITTED: {
    label: "payment.orderStatus.FINAL_PAYMENT_SUBMITTED",
    group: "active",
    action: "finalReview",
  },
  PAID_FULL: {
    label: "payment.orderStatus.PAID_FULL",
    group: "active",
    action: null,
  },
  READY_TO_SHIP: {
    label: "payment.orderStatus.READY_TO_SHIP",
    group: "active",
    action: null,
  },
  SHIPPED: {
    label: "payment.orderStatus.SHIPPED",
    group: "active",
    action: null,
  },
  COMPLETED: {
    label: "payment.orderStatus.COMPLETED",
    group: "completed",
    action: null,
  },
  CANCELLED: {
    label: "payment.orderStatus.CANCELLED",
    group: "completed",
    action: null,
  },
} as const satisfies Record<OrderStatus, StatusMeta>;
export function orderTimeline(status: OrderStatus) {
  // Cancellation alone cannot tell us which prior stages happened. Don't invent history.
  if (status === "CANCELLED") return [{ status, state: "current" as const }];
  const stages = orderStatuses.filter((s) => s !== "CANCELLED"),
    current = stages.indexOf(status);
  return stages.map((stage, index) => ({
    status: stage,
    state:
      index < current
        ? ("completed" as const)
        : index === current
          ? ("current" as const)
          : ("upcoming" as const),
  }));
}
export function filterOrders(orders: CustomerOrder[], filter: OrdersFilter) {
  return filter === "all"
    ? orders
    : orders.filter((order) => orderStatusMeta[order.status].group === filter);
}
export function orderHref(publicId: string) {
  return `/orders/${encodeURIComponent(publicId)}`;
}
export function orderPaymentHref(publicId: string) {
  return `${orderHref(publicId)}/payment`;
}
export function isCustomerOrder(value: unknown): value is CustomerOrder {
  if (!isPaymentOrder(value)) return false;
  const c = (value as CustomerOrder).cancellation;
  if (c !== undefined) {
    if (
      !c ||
      typeof c !== "object" ||
      Object.keys(c).some(
        (k) => !["reason", "cancelledAt", "refund"].includes(k),
      )
    )
      return false;
    if (
      c.reason !== null &&
      ![
        "CUSTOMER_REQUEST",
        "OUT_OF_STOCK",
        "SUPPLIER_UNAVAILABLE",
        "DUPLICATE_ORDER",
        "PAYMENT_ISSUE",
        "OTHER",
      ].includes(c.reason)
    )
      return false;
    if (
      c.cancelledAt !== null &&
      (typeof c.cancelledAt !== "string" ||
        !Number.isFinite(Date.parse(c.cancelledAt)))
    )
      return false;
    if (
      c.refund !== null &&
      (!c.refund ||
        typeof c.refund !== "object" ||
        !["PENDING", "COMPLETED"].includes(c.refund.status) ||
        !Number.isSafeInteger(c.refund.amount) ||
        c.refund.amount <= 0 ||
        Object.keys(c.refund).some((k) => !["amount", "status"].includes(k)))
    )
      return false;
  }
  const recipient = (value as PaymentOrder & { recipient?: unknown }).recipient;
  if (typeof recipient !== "object" || recipient === null) return false;
  const fields = recipient as Record<string, unknown>;
  return (
    ["fullName", "phone", "city", "address"].every(
      (key) => typeof fields[key] === "string",
    ) &&
    ["apartment", "comment"].every(
      (key) => fields[key] === null || typeof fields[key] === "string",
    )
  );
}
export type OrdersError = "auth" | "missing" | "request";
export function ordersError(error: unknown): OrdersError {
  const status =
    typeof error === "object" && error !== null && "status" in error
      ? error.status
      : undefined;
  return status === 401 || status === 403
    ? "auth"
    : status === 404
      ? "missing"
      : "request";
}
