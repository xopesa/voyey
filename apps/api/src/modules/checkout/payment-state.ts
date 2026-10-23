import { database } from "@stenzo/database";
import { HttpError } from "../auth/errors.js";

/** Current money comes from 0022's immutable ledger, never 0021's creation snapshot. */
export type CheckoutFinancialState = {
  orderId: string;
  userId: string;
  publicId: string;
  saleMode: "IN_STOCK" | "PREORDER";
  orderState: "PAYMENTS_BLOCKED" | "CANCELLED";
  cancellationId: string | null;
  cancelledAt: number | null;
  paymentAllowed: 0 | 1;
  goodsTotal: number;
  firstPaymentAmount: number;
  goodsPaid: number;
  unpaidGoods: number;
  firstPaymentDue: number;
  firstPaymentState:
    "AWAITING_PAYMENT" | "PENDING_REVIEW" | "REJECTED" | "CONFIRMED";
  goodsPaymentState: "UNPAID" | "PARTIALLY_PAID" | "PAID";
  cargoAmount: number | null;
  cargoPaid: number;
  unpaidCargo: number | null;
  arrivalId: string | null;
  arrivedAt: number | null;
  cargoChargeId: string | null;
  cargoVersion: number | null;
  finalInvoiceId: string | null;
  finalInvoiceTotal: number | null;
  finalDue: number | null;
  finalPaymentState:
    | "UNAVAILABLE"
    | "AWAITING_PAYMENT"
    | "PENDING_REVIEW"
    | "REJECTED"
    | "CONFIRMED"
    | "SETTLED_ZERO";
  financiallySettled: 0 | 1;
  fulfillmentAllowed: 0;
  finalPaymentEnabled: 0 | 1;
  cargoEnabled: 0 | 1;
};
export function assertCheckoutOpen(state: CheckoutFinancialState) {
  if (state.orderState === "CANCELLED")
    throw new HttpError(
      409,
      "Linked order cancelled; further financial actions are forbidden",
    );
}
export async function readOrderFinance(orderId: string) {
  const state = await database()
    .prepare("SELECT * FROM CheckoutOrderFinance WHERE orderId=?")
    .bind(orderId)
    .first<CheckoutFinancialState>();
  if (!state) throw new HttpError(404, "Linked order not found");
  return state;
}
