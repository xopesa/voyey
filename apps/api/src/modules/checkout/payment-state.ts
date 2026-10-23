import { database } from "@stenzo/database";
import { HttpError } from "../auth/errors.js";

/** Current money comes from 0022's immutable ledger, never 0021's creation snapshot. */
export type CheckoutFinancialState = {
  orderId: string;
  userId: string;
  publicId: string;
  saleMode: "IN_STOCK" | "PREORDER";
  orderState: "PAYMENTS_BLOCKED";
  goodsTotal: number;
  firstPaymentAmount: number;
  goodsPaid: number;
  unpaidGoods: number;
  firstPaymentDue: number;
  firstPaymentState:
    "AWAITING_PAYMENT" | "PENDING_REVIEW" | "REJECTED" | "CONFIRMED";
  goodsPaymentState: "UNPAID" | "PARTIALLY_PAID" | "PAID";
  cargoAmount: null;
  cargoPaid: 0;
  fulfillmentAllowed: 0;
  finalPaymentEnabled: 0;
  cargoEnabled: 0;
};
export async function readOrderFinance(orderId: string) {
  const state = await database()
    .prepare("SELECT * FROM CheckoutOrderFinance WHERE orderId=?")
    .bind(orderId)
    .first<CheckoutFinancialState>();
  if (!state) throw new HttpError(404, "Linked order not found");
  return state;
}
