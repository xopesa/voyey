import { InvalidOrderStatusTransitionError } from "./errors.js";
import type { OrderStatusValue, PaymentPhase } from "./types.js";

const adminTransitions = new Map<OrderStatusValue, OrderStatusValue>([
  ["AWAITING_PURCHASE", "PURCHASED"],
  ["PURCHASED", "IN_TRANSIT"],
  ["IN_TRANSIT", "ARRIVED"],
  ["ARRIVED", "WEIGHING"],
  ["PAID_FULL", "READY_TO_SHIP"],
  ["READY_TO_SHIP", "SHIPPED"],
  ["SHIPPED", "COMPLETED"],
]);

export function assertAdminStatusTransition(
  from: OrderStatusValue,
  to: OrderStatusValue,
): void {
  if (adminTransitions.get(from) !== to) {
    throw new InvalidOrderStatusTransitionError(from, to);
  }
}

export function nextAdminStatus(
  status: OrderStatusValue,
): OrderStatusValue | null {
  return adminTransitions.get(status) ?? null;
}

export function submissionPhase(status: OrderStatusValue): PaymentPhase | null {
  if (status === "AWAITING_PREPAYMENT") return "PREPAYMENT";
  if (status === "AWAITING_FINAL_PAYMENT") return "FINAL";
  return null;
}

export function currentPaymentPhase(
  status: OrderStatusValue,
): PaymentPhase | null {
  if (status === "AWAITING_PREPAYMENT" || status === "PREPAYMENT_SUBMITTED") {
    return "PREPAYMENT";
  }
  if (
    status === "AWAITING_FINAL_PAYMENT" ||
    status === "FINAL_PAYMENT_SUBMITTED"
  ) {
    return "FINAL";
  }
  return null;
}
