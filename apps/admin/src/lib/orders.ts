import { ApiError, errorKey } from "./api";
export const orderStatuses = [
  "AWAITING_PREPAYMENT",
  "PREPAYMENT_SUBMITTED",
  "AWAITING_PURCHASE",
  "PURCHASED",
  "IN_TRANSIT",
  "ARRIVED",
  "WEIGHING",
  "AWAITING_FINAL_PAYMENT",
  "FINAL_PAYMENT_SUBMITTED",
  "PAID_FULL",
  "READY_TO_SHIP",
  "SHIPPED",
  "COMPLETED",
  "CANCELLED",
] as const;
export type OrderStatus = (typeof orderStatuses)[number];
export type PaymentType = "PREPAYMENT" | "FINAL";
export type PaymentStatus = "SUBMITTED" | "APPROVED" | "REJECTED";
export type PaymentAttempt = {
  id: string;
  type: PaymentType;
  status: PaymentStatus;
  expectedAmount: number;
  submittedAt: string;
  reviewedAt: string | null;
  rejectionReason: string | null;
};
export type OrderItem = {
  productId: string | null;
  productNameRu: string;
  productNameUz: string;
  imageUrl: string | null;
  sku: string;
  size: string;
  color: string | null;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
  heightCm: number | null;
  weightKg: number | null;
  sourceUrl: string | null;
};
export type AdminOrder = {
  estimatedWarehouseArrival?: string | null;
  dashboardHiddenAt?: string | null;
  source?: "MINIAPP" | "ADMIN";
  publicId: string;
  createdAt: string;
  status: OrderStatus;
  recipient: {
    fullName: string;
    phone: string;
    city: string;
    address: string;
    apartment: string | null;
    comment: string | null;
  };
  customer: {
    telegramId: string;
    username: string | null;
    firstName: string | null;
    lastName: string | null;
  };
  items: OrderItem[];
  subtotal?: number;
  discountAmount?: number;
  promoCodeSnapshot?: string | null;
  total: number;
  requiredPrepayment: number;
  paidAmount: number;
  remainingAmount: number;
  cargoAmount: number | null;
  payment: {
    phase: PaymentType | null;
    amountDue: number;
    latestStatus: PaymentStatus | null;
  };
  paymentAttempts: PaymentAttempt[];
  nextStatus: OrderStatus | null;
  canRequestFinalPayment: boolean;
  requiresAction: boolean;
  finance: {
    confirmedPrepayment: number;
    remainingProducts: number;
    finalPaymentTotal: number | null;
  };
};
export type AdminPayment = PaymentAttempt & {
  orderPublicId: string;
  order: AdminOrder;
};
export function orderStatusKey(status: OrderStatus) {
  return `order${status}` as const;
}
export function paymentTypeKey(type: PaymentType) {
  return `payment${type}` as const;
}
export function paymentStatusKey(status: PaymentStatus) {
  return `payment${status}` as const;
}
export function orderError(error: unknown) {
  return error instanceof ApiError && error.status === 409
    ? ("orderConflict" as const)
    : errorKey(error);
}
export function uzs(amount: number, locale: "ru" | "uz") {
  return new Intl.NumberFormat(locale === "ru" ? "ru-RU" : "uz-UZ").format(
    amount,
  );
}
export function dateTime(value: string, locale: "ru" | "uz") {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "—"
    : new Intl.DateTimeFormat(locale === "ru" ? "ru-RU" : "uz-UZ", {
        dateStyle: "short",
        timeStyle: "short",
      }).format(date);
}
export function orderQuery(
  filters: { status: string; search: string },
  cursor?: string,
) {
  const query = new URLSearchParams({ limit: "20" });
  if (filters.status) query.set("status", filters.status);
  if (filters.search.trim()) query.set("search", filters.search.trim());
  if (cursor) query.set("cursor", cursor);
  return `orders?${query}`;
}
