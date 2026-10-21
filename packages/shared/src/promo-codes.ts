export type PromoCodeInput = {
  code: string;
  type: "PERCENT" | "FIXED";
  value: number;
  minOrderAmount: number | null;
  maxDiscount: number | null;
  startsAt: string | null;
  endsAt: string | null;
  usageLimit: number | null;
  perUserLimit: number;
  isActive: boolean;
};
export type AdminPromoCode = PromoCodeInput & {
  id: string;
  usageCount: number;
  createdAt: string;
  updatedAt: string;
};
export type PromoFailure =
  | "PROMO_INVALID"
  | "PROMO_INACTIVE"
  | "PROMO_NOT_STARTED"
  | "PROMO_EXPIRED"
  | "PROMO_MINIMUM"
  | "PROMO_LIMIT"
  | "PROMO_USER_LIMIT"
  | "PROMO_AMOUNT"
  | "PROMO_EMPTY_CART";
export type PromoQuote =
  | {
      valid: true;
      code: string;
      subtotal: number;
      discountAmount: number;
      total: number;
    }
  | { valid: false; reason: PromoFailure };
/** Validation quote bound to the same authoritative cart used for pricing. */
export type PromoCartQuote = PromoQuote & { cartVersion: string | null };
export function normalizePromoCode(value: string): string | null {
  const code = value.trim().toUpperCase();
  return code.length >= 3 &&
    code.length <= 32 &&
    /^[A-Z0-9]+(?:-[A-Z0-9]+)*$/.test(code)
    ? code
    : null;
}

/** Product subtotal only. Cargo is intentionally absent from this contract. */
export function promoDiscount(
  promo: Pick<
    PromoCodeInput,
    "type" | "value" | "maxDiscount" | "minOrderAmount"
  >,
  subtotal: number,
): number | null {
  if (
    !Number.isSafeInteger(subtotal) ||
    subtotal <= 0 ||
    subtotal > 2147483647 ||
    (promo.minOrderAmount != null && subtotal < promo.minOrderAmount)
  )
    return null;
  let amount =
    promo.type === "PERCENT"
      ? Math.floor((subtotal * promo.value) / 100)
      : promo.value;
  if (promo.type === "PERCENT" && promo.maxDiscount != null)
    amount = Math.min(amount, promo.maxDiscount);
  return Number.isSafeInteger(amount) && amount > 0 && amount < subtotal
    ? amount
    : null;
}
