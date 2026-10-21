import { OrderNotFoundError } from "./errors.js";
import { currentPaymentPhase, nextAdminStatus } from "./status-policy.js";
import type { OrderRepository } from "./repository.js";
import type {
  AdminOrderDto,
  AdminOrderListQuery,
  OrderDto,
  OrderListQuery,
  OrderRecord,
} from "./types.js";

export function toOrderDto(order: OrderRecord): OrderDto {
  const approvedAt = (type: "PREPAYMENT" | "FINAL") =>
    order.payments.find((p) => p.type === type && p.status === "APPROVED")
      ?.reviewedAt ?? null;
  const phase = currentPaymentPhase(order.status);
  const amountDue =
    phase === "PREPAYMENT"
      ? order.requiredPrepayment
      : phase === "FINAL"
        ? order.remainingAmount + (order.cargoAmount ?? 0)
        : 0;
  return {
    ...(order.status === "CANCELLED"
      ? {
          cancellation: {
            reason: order.cancellationReason ?? null,
            cancelledAt: order.cancelledAt?.toISOString() ?? null,
            refund: order.refund
              ? { amount: order.refund.amount, status: order.refund.status }
              : null,
          },
        }
      : {}),
    source: order.source ?? "MINIAPP",
    publicId: order.publicId,
    estimatedWarehouseArrival: order.estimatedWarehouseArrival ?? null,
    paymentConfirmations: {
      prepayment: approvedAt("PREPAYMENT"),
      final: approvedAt("FINAL"),
    },
    createdAt: order.createdAt,
    status: order.status,
    recipient: {
      fullName: order.fullName,
      phone: order.phone,
      city: order.city,
      address: order.address,
      apartment: order.apartment,
      comment: order.comment,
    },
    items: order.items.map((item) => ({
      productId: item.productId,
      variantId: item.variantId,
      productNameRu: item.productNameRu,
      productNameUz: item.productNameUz,
      productSlug: item.productSlug,
      imageUrl: item.imageUrl,
      sku: item.sku,
      size: item.size,
      color: item.color,
      originalUnitPrice: item.originalUnitPrice ?? null,
      unitPrice: item.unitPrice,
      quantity: item.quantity,
      lineTotal: item.lineTotal,
      heightCm: item.heightCm,
      weightKg: item.weightKg,
    })),
    currency: order.currency,
    subtotal: order.itemsSubtotal ?? order.subtotal,
    discountAmount: order.discountAmount ?? 0,
    promoCodeSnapshot: order.promoCodeSnapshot ?? null,
    total: order.total,
    requiredPrepayment: order.requiredPrepayment,
    paidAmount: order.paidAmount,
    remainingAmount: order.remainingAmount,
    cargoAmount: order.cargoAmount,
    cargoPaidAmount: order.cargoPaidAmount,
    payment: {
      phase,
      amountDue,
      latestStatus: order.payments[0]?.status ?? null,
    },
  };
}

export function toAdminOrderDto(order: OrderRecord): AdminOrderDto {
  const base = toOrderDto(order);
  const nextStatus = nextAdminStatus(order.status);
  const prepayment = order.payments.find(
    (payment) => payment.type === "PREPAYMENT" && payment.status === "APPROVED",
  );
  const finalPayment = order.payments.find(
    (payment) => payment.type === "FINAL" && payment.status === "APPROVED",
  );
  return {
    ...base,
    dashboardHiddenAt: order.dashboardHiddenAt ?? null,
    payment: {
      ...base.payment,
      latestStatus: base.payment.phase
        ? (order.payments.find((payment) => payment.type === base.payment.phase)
            ?.status ?? null)
        : base.payment.latestStatus,
    },
    items: base.items.map((item, index) => ({
      ...item,
      sourceUrl: order.items[index]?.product?.sourceUrl ?? null,
    })),
    nextStatus,
    canRequestFinalPayment: order.status === "WEIGHING",
    requiresAction:
      nextStatus !== null ||
      order.status === "WEIGHING" ||
      order.payments.some((payment) => payment.status === "SUBMITTED"),
    finance: {
      confirmedPrepayment: prepayment?.expectedAmount ?? 0,
      remainingProducts: order.remainingAmount,
      finalPaymentTotal:
        finalPayment?.expectedAmount ??
        (order.cargoAmount === null
          ? null
          : base.payment.phase === "FINAL"
            ? base.payment.amountDue
            : null),
    },
    customer: {
      id: order.user.id,
      telegramId: order.user.telegramId.toString(),
      username: order.user.username,
      firstName: order.user.firstName,
      lastName: order.user.lastName,
    },
    paymentAttempts: order.payments.map((payment) => ({
      id: payment.id,
      type: payment.type,
      status: payment.status,
      expectedAmount: payment.expectedAmount,
      submittedAt: payment.submittedAt,
      reviewedAt: payment.reviewedAt,
      rejectionReason: payment.rejectionReason,
    })),
  };
}

export class OrderService {
  public constructor(private readonly repository: OrderRepository) {}

  public async listForUser(userId: string, query: OrderListQuery) {
    const result = await this.repository.listForUser(userId, query);
    return {
      orders: result.orders.map(toOrderDto),
      nextCursor: result.nextCursor,
    };
  }

  public async getForUser(userId: string, publicId: string): Promise<OrderDto> {
    const order = await this.repository.getForUser(userId, publicId);
    if (!order) throw new OrderNotFoundError();
    return toOrderDto(order);
  }

  public async listForAdmin(query: AdminOrderListQuery) {
    const result = await this.repository.listForAdmin(query);
    return {
      orders: result.orders.map(toAdminOrderDto),
      nextCursor: result.nextCursor,
    };
  }

  public async getForAdmin(publicId: string): Promise<AdminOrderDto> {
    const order = await this.repository.getForAdmin(publicId);
    if (!order) throw new OrderNotFoundError();
    return toAdminOrderDto(order);
  }
}
