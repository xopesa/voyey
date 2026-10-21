export const cancellationReasons = [
  "CUSTOMER_REQUEST",
  "OUT_OF_STOCK",
  "SUPPLIER_UNAVAILABLE",
  "DUPLICATE_ORDER",
  "PAYMENT_ISSUE",
  "OTHER",
] as const;
export type CancellationReason = (typeof cancellationReasons)[number];
export const cancellableStatuses = [
  "AWAITING_PREPAYMENT",
  "AWAITING_PURCHASE",
  "PURCHASED",
  "IN_TRANSIT",
  "ARRIVED",
  "WEIGHING",
  "AWAITING_FINAL_PAYMENT",
  "PAID_FULL",
  "READY_TO_SHIP",
] as const;
export type RefundSummary = { amount: number; status: "PENDING" | "COMPLETED" };
export type CustomerCancellation = {
  reason: CancellationReason | null;
  cancelledAt: string | null;
  refund: RefundSummary | null;
};
export type AdminRefund = RefundSummary & {
  id: string;
  orderPublicId: string;
  customer: string;
  createdAt: string;
  completedAt: string | null;
  reference: string | null;
  note: string | null;
};
export type RefundPage = { refunds: AdminRefund[]; nextCursor: string | null };
export type OrderLifecycle = {
  status: string;
  canCancel: boolean;
  hasSubmitted: boolean;
  approvedCash: number;
  reason: CancellationReason | null;
  note: string | null;
  cancelledAt: string | null;
  stockReleaseStatus: "NOT_RELEASED" | "RELEASED" | "REVIEW_REQUIRED";
  stockReleasedAt: string | null;
  refund: AdminRefund | null;
};
export const cancellationReasonText: Record<
  CancellationReason,
  Record<"ru" | "uz", string>
> = {
  CUSTOMER_REQUEST: { ru: "По просьбе клиента", uz: "Mijoz so‘rovi" },
  OUT_OF_STOCK: { ru: "Нет в наличии", uz: "Mavjud emas" },
  SUPPLIER_UNAVAILABLE: {
    ru: "Товар недоступен у поставщика",
    uz: "Yetkazib beruvchida mavjud emas",
  },
  DUPLICATE_ORDER: { ru: "Повторный заказ", uz: "Takroriy buyurtma" },
  PAYMENT_ISSUE: { ru: "Проблема с оплатой", uz: "To‘lov muammosi" },
  OTHER: { ru: "Другая причина", uz: "Boshqa sabab" },
};
