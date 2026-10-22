import { cartSnapshotVersion } from "@stenzo/shared";
import type { Cart } from "./cart";

export interface RecipientInput {
  fullName: string;
  phone: string;
  city: string;
  address: string;
  apartment: string | null;
  comment: string | null;
}
export type CheckoutInput = RecipientInput & { promoCode?: string };
export type RecipientDraft = Record<keyof RecipientInput, string>;
export const emptyRecipient: RecipientDraft = {
  fullName: "",
  phone: "",
  city: "",
  address: "",
  apartment: "",
  comment: "",
};
// Match the existing orders/recipientSchema, including its phone format.
export const recipientLimits = {
  fullName: [2, 200],
  phone: [7, 24],
  city: [1, 100],
  address: [3, 500],
  apartment: [1, 100],
  comment: [1, 1000],
} as const;
export function recipientErrors(draft: RecipientDraft) {
  const errors: Partial<Record<keyof RecipientInput, boolean>> = {};
  for (const key of Object.keys(recipientLimits) as (keyof RecipientInput)[]) {
    const value = draft[key].trim();
    const [min, max] = recipientLimits[key];
    if ((key === "apartment" || key === "comment") && !value) continue;
    if (
      value.length < min ||
      value.length > max ||
      (key === "phone" && !/^\+?[0-9][0-9 ()-]+$/.test(value))
    )
      errors[key] = true;
  }
  return errors;
}
export function recipientPayload(draft: RecipientDraft): RecipientInput {
  return {
    fullName: draft.fullName.trim(),
    phone: draft.phone.trim(),
    city: draft.city.trim(),
    address: draft.address.trim(),
    apartment: draft.apartment.trim() || null,
    comment: draft.comment.trim() || null,
  };
}
export function checkoutCartIssue(
  cart: Cart,
): "empty" | "measurements" | "unavailable" | undefined {
  if (!cart.items.length) return "empty";
  if (
    cart.items.some(
      (item) =>
        item.heightCm === null ||
        !Number.isInteger(item.heightCm) ||
        item.heightCm < 100 ||
        item.heightCm > 250 ||
        item.weightKg === null ||
        !Number.isInteger(item.weightKg) ||
        item.weightKg < 30 ||
        item.weightKg > 300,
    )
  )
    return "measurements";
  if (
    cart.items.some(
      (item) =>
        !item.isAvailable ||
        (item.variant.stock !== null && item.quantity > item.variant.stock),
    )
  )
    return "unavailable";
}
export const checkoutCartVersion = cartSnapshotVersion;
export interface CheckoutOrder {
  publicId: string;
  status: string;
  currency: "UZS";
  subtotal?: number;
  discountAmount?: number;
  promoCodeSnapshot?: string | null;
  total: number;
  requiredPrepayment: number;
  remainingAmount: number;
  items: Array<{
    productNameRu: string;
    productNameUz: string;
    quantity: number;
    size: string;
    color: string | null;
    unitPrice: number;
    lineTotal: number;
    heightCm: number | null;
    weightKg: number | null;
  }>;
}
export function isCheckoutOrder(value: unknown): value is CheckoutOrder {
  if (!value || typeof value !== "object") return false;
  const order = value as CheckoutOrder;
  return (
    typeof order.publicId === "string" &&
    order.publicId.length > 0 &&
    order.publicId.length <= 100 &&
    /^[A-Za-z0-9._:-]+$/.test(order.publicId) &&
    typeof order.status === "string" &&
    order.currency === "UZS" &&
    [order.total, order.requiredPrepayment, order.remainingAmount].every(
      (value) => Number.isSafeInteger(value) && value >= 0,
    ) &&
    Array.isArray(order.items) &&
    order.items.length > 0 &&
    order.items.every(
      (item) =>
        item &&
        typeof item.productNameRu === "string" &&
        typeof item.productNameUz === "string" &&
        Number.isInteger(item.quantity) &&
        item.quantity > 0 &&
        typeof item.size === "string" &&
        (item.color === null || typeof item.color === "string") &&
        [item.unitPrice, item.lineTotal].every(
          (value) => Number.isSafeInteger(value) && value >= 0,
        ) &&
        (item.heightCm === null ||
          (Number.isInteger(item.heightCm) &&
            item.heightCm >= 100 &&
            item.heightCm <= 250)) &&
        (item.weightKg === null ||
          (Number.isInteger(item.weightKg) &&
            item.weightKg >= 30 &&
            item.weightKg <= 300)),
    )
  );
}
export function paymentHref(publicId: string) {
  return `/orders/${encodeURIComponent(publicId)}/payment`;
}

export interface CheckoutAttempt {
  promoCode?: string;
  key: string;
  cartId: string;
  uncertain: boolean;
}
export interface AttemptStore {
  read(cartId: string): CheckoutAttempt | null;
  write(attempt: CheckoutAttempt): void;
  clear(): void;
}
const storageKey = "voyey.checkout-attempt";
// Only a cart-scoped random key and optional public promo code are stored.
// Recipient data and JWT are never persisted here.
export const checkoutAttemptStore: AttemptStore = {
  read(cartId) {
    try {
      const value = JSON.parse(sessionStorage.getItem(storageKey) ?? "null");
      if (
        value?.cartId === cartId &&
        typeof value.uncertain === "boolean" &&
        (value.promoCode === undefined ||
          (typeof value.promoCode === "string" &&
            value.promoCode.length >= 3 &&
            value.promoCode.length <= 32 &&
            /^[A-Z0-9]+(?:-[A-Z0-9]+)*$/.test(value.promoCode))) &&
        typeof value.key === "string" &&
        /^[A-Za-z0-9._:-]{16,200}$/.test(value.key)
      )
        return value;
    } catch {
      /* Keep working in memory when storage is unavailable. */
    }
    return null;
  },
  write(attempt) {
    try {
      sessionStorage.setItem(storageKey, JSON.stringify(attempt));
    } catch {
      /* In-memory retries still use the same key. */
    }
  },
  clear() {
    try {
      sessionStorage.removeItem(storageKey);
    } catch {
      /* Optional browser storage. */
    }
  },
};

export type CheckoutFailure =
  | "auth"
  | "access"
  | "empty"
  | "measurements"
  | "product"
  | "variant"
  | "stock"
  | "contacts"
  | "promo"
  | "changed"
  | "conflict"
  | "unavailable"
  | "request";
export function checkoutFailure(error: unknown): CheckoutFailure {
  const e = error as
    { status?: number; detail?: string; code?: string } | undefined;
  if (e?.status === 503 && e.code === "COMMERCE_DISABLED") return "unavailable";
  if (e?.status === 401) return "auth";
  if (e?.status === 403) return "access";
  if (e?.status === 409 && e.detail?.startsWith("PROMO_")) return "promo";
  if (e?.status === 400) return "contacts";
  if (e?.status === 409) {
    if (e.detail === "Cart is empty") return "empty";
    if (e.detail?.startsWith("Every cart item requires height"))
      return "measurements";
    if (e.detail === "Product is unavailable") return "product";
    if (
      e.detail === "Product variant is unavailable" ||
      e.detail === "Variant does not belong to the selected product"
    )
      return "variant";
    if (
      e.detail?.startsWith("Requested quantity exceeds available stock") ||
      e.detail === "Cart item quantity must be between 1 and 99"
    )
      return "stock";
    return "conflict";
  }
  return "request";
}
