import type { CatalogOrderItemSnapshot } from "@stenzo/shared";

export type OrderStatusValue =
  | "AWAITING_PREPAYMENT"
  | "PREPAYMENT_SUBMITTED"
  | "AWAITING_PURCHASE"
  | "PURCHASED"
  | "IN_TRANSIT"
  | "ARRIVED"
  | "WEIGHING"
  | "AWAITING_FINAL_PAYMENT"
  | "FINAL_PAYMENT_SUBMITTED"
  | "PAID_FULL"
  | "READY_TO_SHIP"
  | "SHIPPED"
  | "COMPLETED"
  | "CANCELLED";

export type PaymentPhase = "PREPAYMENT" | "FINAL";
export type PaymentStatusValue = "SUBMITTED" | "APPROVED" | "REJECTED";

export interface OrderPaymentRecord {
  id: string;
  type: PaymentPhase;
  status: PaymentStatusValue;
  expectedAmount: number;
  submittedAt: Date;
  reviewedAt: Date | null;
  rejectionReason: string | null;
}

export interface RecipientInput {
  fullName: string;
  phone: string;
  city: string;
  address: string;
  apartment: string | null;
  comment: string | null;
}

export interface OrderItemRecord {
  catalogSnapshot?: unknown;
  product?: { sourceUrl: string | null } | null;
  id: string;
  orderId: string;
  productId: string | null;
  variantId: string | null;
  productNameRu: string;
  productNameUz: string;
  productSlug: string;
  imageUrl: string | null;
  sku: string;
  size: string;
  color: string | null;
  originalUnitPrice?: number | null;
  unitPrice: number;
  quantity: number;
  lineTotal: number;
  heightCm: number | null;
  weightKg: number | null;
  createdAt: Date;
}

export interface OrderUserRecord {
  preferredLocale?: "uz" | "ru" | null;
  id: string;
  telegramId: bigint;
  username: string | null;
  firstName: string | null;
  lastName: string | null;
  languageCode: string | null;
}

export interface OrderRecord extends RecipientInput {
  estimatedWarehouseArrival?: string | null;
  dashboardHiddenAt?: Date | null;
  cancellationReason?: import("@stenzo/shared").CancellationReason | null;
  cancelledAt?: Date | null;
  refund?: {
    id: string;
    amount: number;
    status: "PENDING" | "COMPLETED";
  } | null;
  source?: "MINIAPP" | "ADMIN";
  id: string;
  publicId: string;
  userId: string;
  idempotencyKey: string;
  status: OrderStatusValue;
  currency: "UZS";
  itemsSubtotal?: number | null;
  discountAmount?: number;
  promoCodeSnapshot?: string | null;
  subtotal: number;
  total: number;
  requiredPrepayment: number;
  paidAmount: number;
  remainingAmount: number;
  cargoAmount: number | null;
  cargoPaidAmount: number;
  createdAt: Date;
  updatedAt: Date;
  items: OrderItemRecord[];
  payments: OrderPaymentRecord[];
  user: OrderUserRecord;
}

export interface PreparedOrder {
  itemsSubtotal?: number | null;
  discountAmount?: number;
  promoCodeSnapshot?: string | null;
  subtotal: number;
  total: number;
  requiredPrepayment: number;
  paidAmount: number;
  remainingAmount: number;
  cargoAmount: number | null;
  cargoPaidAmount: number;
  items: Array<
    Omit<
      OrderItemRecord,
      "id" | "orderId" | "createdAt" | "catalogSnapshot"
    > & { catalogSnapshot: CatalogOrderItemSnapshot }
  >;
}

export interface OrderListQuery {
  limit: number;
  cursor?: string;
}

export interface AdminOrderListQuery extends OrderListQuery {
  status?: OrderStatusValue;
  search?: string;
}

export interface OrderListResult {
  orders: OrderRecord[];
  nextCursor: string | null;
}

export interface OrderDto {
  estimatedWarehouseArrival?: string | null;
  paymentConfirmations?: { prepayment: Date | null; final: Date | null };
  cancellation?: import("@stenzo/shared").CustomerCancellation;
  source?: "MINIAPP" | "ADMIN";
  publicId: string;
  createdAt: Date;
  status: OrderStatusValue;
  recipient: RecipientInput;
  items: Array<
    Omit<
      OrderItemRecord,
      "id" | "orderId" | "createdAt" | "product" | "catalogSnapshot"
    > & { catalogSnapshot: CatalogOrderItemSnapshot | null }
  >;
  currency: "UZS";
  itemsSubtotal?: number | null;
  discountAmount?: number;
  promoCodeSnapshot?: string | null;
  subtotal: number;
  total: number;
  requiredPrepayment: number;
  paidAmount: number;
  remainingAmount: number;
  cargoAmount: number | null;
  cargoPaidAmount: number;
  payment: {
    phase: PaymentPhase | null;
    amountDue: number;
    latestStatus: PaymentStatusValue | null;
  };
}

export interface AdminOrderDto extends OrderDto {
  dashboardHiddenAt?: Date | null;
  items: Array<OrderDto["items"][number] & { sourceUrl: string | null }>;
  nextStatus: OrderStatusValue | null;
  canRequestFinalPayment: boolean;
  requiresAction: boolean;
  finance: {
    confirmedPrepayment: number;
    remainingProducts: number;
    finalPaymentTotal: number | null;
  };
  customer: {
    id: string;
    telegramId: string;
    username: string | null;
    firstName: string | null;
    lastName: string | null;
  };
  paymentAttempts: OrderPaymentRecord[];
}
