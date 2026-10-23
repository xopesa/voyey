import { z } from "zod";
import { createHash } from "node:crypto";
import { HttpError } from "../auth/errors.js";
import {
  proposeDiscountAllocation,
  type SplitCheckoutPlan,
} from "./split-plan.js";

const MAX = 2147483647;
export const splitFinanceSelectionSchema = z
  .object({
    preorderPercent: z.union([z.literal(50), z.literal(100)]).optional(),
    promoCode: z.string().trim().min(3).max(32).optional(),
  })
  .strict();
export function parseSplitFinanceSelection(value: unknown) {
  const parsed = splitFinanceSelectionSchema.safeParse(value);
  if (!parsed.success) throw new HttpError(400, "Invalid financial selection");
  return parsed.data;
}
function money(value: number) {
  if (!Number.isSafeInteger(value) || value < 0 || value > MAX)
    throw new HttpError(400, "Invalid UZS amount");
  return value;
}
export type GroupFinance = {
  saleMode: "IN_STOCK" | "PREORDER";
  goodsSubtotal: number;
  discountAmount: number;
  goodsTotal: number;
  prepaymentPercent: 50 | 100;
  firstPaymentAmount: number;
  goodsRemainderAfterFirstConfirmation: number;
  cargo: "NOT_APPLICABLE" | "UNKNOWN_UNTIL_ARRIVAL";
};

/** Server-only inputs: use persisted Product snapshots and a single validated promo quote. */
export function calculateSplitFinance(
  plan: SplitCheckoutPlan,
  preorderPercent: 50 | 100 | undefined,
  discountAmount = 0,
) {
  if (
    !plan.orders.length ||
    plan.orders.length > 2 ||
    new Set(plan.orders.map((o) => o.saleMode)).size !== plan.orders.length
  )
    throw new HttpError(400, "Invalid financial groups");
  const hasPreorder = plan.orders.some((o) => o.saleMode === "PREORDER");
  if (
    hasPreorder
      ? preorderPercent !== 50 && preorderPercent !== 100
      : preorderPercent !== undefined
  )
    throw new HttpError(400, "Choose 50 or 100 percent only for PREORDER");
  for (const order of plan.orders) {
    if (
      !["IN_STOCK", "PREORDER"].includes(order.saleMode) ||
      !order.items.length
    )
      throw new HttpError(400, "Invalid sale mode");
    let total = 0;
    for (const item of order.items) {
      if (
        item.saleMode !== order.saleMode ||
        !Number.isInteger(item.quantity) ||
        item.quantity < 1 ||
        item.quantity > 99
      )
        throw new HttpError(400, "Invalid financial line");
      const line = money(money(item.unitPrice) * item.quantity);
      if (line !== item.lineTotal)
        throw new HttpError(400, "Line total mismatch");
      total = money(total + line);
    }
    if (total !== order.subtotal)
      throw new HttpError(400, "Group total mismatch");
  }
  const subtotal = money(plan.orders.reduce((n, o) => n + o.subtotal, 0));
  if (subtotal !== plan.subtotal)
    throw new HttpError(400, "Checkout total mismatch");
  money(discountAmount);
  const allocated = proposeDiscountAllocation(
    plan.orders.map((o) => ({ key: o.saleMode, subtotal: o.subtotal })),
    discountAmount,
  );
  const groups: GroupFinance[] = plan.orders.map((order) => {
    const discount = allocated.find((a) => a.key === order.saleMode)!.discount;
    const goodsTotal = money(order.subtotal - discount);
    const percent = order.saleMode === "IN_STOCK" ? 100 : preorderPercent!;
    const first =
      percent === 100
        ? goodsTotal
        : Math.floor(goodsTotal / 2) + (goodsTotal % 2);
    return {
      saleMode: order.saleMode,
      goodsSubtotal: order.subtotal,
      discountAmount: discount,
      goodsTotal,
      prepaymentPercent: percent,
      firstPaymentAmount: first,
      goodsRemainderAfterFirstConfirmation: goodsTotal - first,
      cargo:
        order.saleMode === "IN_STOCK"
          ? "NOT_APPLICABLE"
          : "UNKNOWN_UNTIL_ARRIVAL",
    };
  });
  return {
    financialFingerprint: createHash("sha256")
      .update(
        JSON.stringify([
          plan.requestFingerprint,
          preorderPercent ?? null,
          discountAmount,
          groups,
        ]),
      )
      .digest("hex"),
    version: 1 as const,
    executable: false as const,
    currency: "UZS" as const,
    checkoutGroupId: plan.checkoutGroupId,
    requestFingerprint: plan.requestFingerprint,
    selection: { preorderPercent: preorderPercent ?? null },
    subtotal,
    discountAmount,
    goodsTotal: subtotal - discountAmount,
    groups,
  };
}

export type ReceiptAllocation = {
  id: string;
  amount: number;
  status: "SUBMITTED" | "REJECTED" | "APPROVED";
  goodsAmount: number;
  cargoAmount: number;
};
/** Projection of a trusted server ledger, not an approval operation or public input contract. */
export function calculateOutstanding(
  group: GroupFinance,
  receipts: readonly ReceiptAllocation[],
  cargo: { arrived: boolean; amount: number | null },
) {
  if (typeof cargo.arrived !== "boolean")
    throw new HttpError(400, "Invalid arrival state");
  // Recheck the immutable schedule before accepting a stored contract.
  money(group.goodsSubtotal);
  money(group.discountAmount);
  money(group.goodsTotal);
  const expectedPercent =
    group.saleMode === "IN_STOCK" ? 100 : group.prepaymentPercent;
  if (
    !["IN_STOCK", "PREORDER"].includes(group.saleMode) ||
    ![50, 100].includes(expectedPercent) ||
    expectedPercent !== group.prepaymentPercent ||
    group.goodsSubtotal - group.discountAmount !== group.goodsTotal ||
    group.cargo !==
      (group.saleMode === "IN_STOCK"
        ? "NOT_APPLICABLE"
        : "UNKNOWN_UNTIL_ARRIVAL")
  )
    throw new HttpError(400, "Invalid stored financial policy");
  const expectedFirst =
    expectedPercent === 100
      ? group.goodsTotal
      : Math.ceil(group.goodsTotal / 2);
  if (
    group.firstPaymentAmount !== expectedFirst ||
    group.goodsRemainderAfterFirstConfirmation !==
      group.goodsTotal - expectedFirst
  )
    throw new HttpError(400, "Invalid payment schedule");
  if (
    (!cargo.arrived && cargo.amount !== null) ||
    (group.saleMode === "IN_STOCK" && cargo.amount !== null)
  )
    throw new HttpError(400, "Cargo is not applicable yet");
  const cargoAmount =
    group.saleMode === "IN_STOCK"
      ? 0
      : cargo.amount === null
        ? null
        : money(cargo.amount);
  if (cargoAmount !== null) money(group.goodsTotal + cargoAmount);
  const ids = new Set<string>();
  let goodsPaid = 0,
    cargoPaid = 0;
  for (const receipt of receipts) {
    if (
      typeof receipt.id !== "string" ||
      !receipt.id ||
      ids.has(receipt.id) ||
      !["SUBMITTED", "REJECTED", "APPROVED"].includes(receipt.status)
    )
      throw new HttpError(400, "Invalid/duplicate receipt");
    ids.add(receipt.id);
    money(receipt.goodsAmount);
    money(receipt.cargoAmount);
    money(receipt.goodsAmount + receipt.cargoAmount);
    if (money(receipt.amount) !== receipt.goodsAmount + receipt.cargoAmount)
      throw new HttpError(400, "Receipt allocation mismatch");
    if (receipt.status === "APPROVED") {
      goodsPaid = money(goodsPaid + receipt.goodsAmount);
      cargoPaid = money(cargoPaid + receipt.cargoAmount);
    }
  }
  if (
    goodsPaid > group.goodsTotal ||
    (cargoAmount === null ? cargoPaid > 0 : cargoPaid > cargoAmount)
  )
    throw new HttpError(400, "Confirmed allocation exceeds obligation");
  const goodsOutstanding = group.goodsTotal - goodsPaid;
  const cargoOutstanding =
    cargoAmount === null ? null : cargoAmount - cargoPaid;
  const totalOutstanding =
    cargoOutstanding === null
      ? null
      : money(goodsOutstanding + cargoOutstanding);
  return {
    goodsPaid,
    cargoPaid,
    firstPaymentDue: Math.max(0, group.firstPaymentAmount - goodsPaid),
    goodsOutstanding,
    cargoAmount,
    cargoOutstanding,
    totalOutstanding,
    // IN_STOCK has a single goods payment, never an additional final charge.
    finalAmountDue:
      group.saleMode === "IN_STOCK"
        ? 0
        : cargo.arrived
          ? totalOutstanding
          : null,
  };
}
