import type { CustomerRecipient } from "@stenzo/shared";
export type ManualLine = {
  productId: string;
  variantId: string;
  quantity: number;
  heightCm: number;
  weightKg: number;
};
export type ManualInput = {
  userId: string;
  recipient: CustomerRecipient;
  items: ManualLine[];
  promoCode?: string;
};
export type ManualPreview = {
  subtotal: number;
  discountAmount: number;
  total: number;
  requiredPrepayment: number;
  remainingAmount: number;
  promoCodeSnapshot: string | null;
  items: {
    productNameRu: string;
    productNameUz: string;
    size: string;
    color: string | null;
    quantity: number;
    unitPrice: number;
    lineTotal: number;
  }[];
};
export const emptyManualRecipient: CustomerRecipient = {
  fullName: "",
  phone: "",
  city: "",
  address: "",
  apartment: null,
  comment: null,
};
export function manualPayload(
  userId: string,
  recipient: CustomerRecipient,
  items: ManualLine[],
  code: string,
): ManualInput {
  const clean = {
    ...recipient,
    fullName: recipient.fullName.trim(),
    phone: recipient.phone.trim(),
    city: recipient.city.trim(),
    address: recipient.address.trim(),
    apartment: recipient.apartment?.trim() || null,
    comment: recipient.comment?.trim() || null,
  };
  if (
    !userId ||
    !items.length ||
    items.length > 20 ||
    new Set(items.map((i) => i.variantId)).size !== items.length ||
    items.some(
      (i) =>
        !i.productId ||
        !i.variantId ||
        !Number.isInteger(i.quantity) ||
        i.quantity < 1 ||
        i.quantity > 99 ||
        !Number.isInteger(i.heightCm) ||
        i.heightCm < 100 ||
        i.heightCm > 250 ||
        !Number.isInteger(i.weightKg) ||
        i.weightKg < 30 ||
        i.weightKg > 300,
    )
  )
    throw Error("manualInvalid");
  return {
    userId,
    recipient: clean,
    items: items.map(
      ({ productId, variantId, quantity, heightCm, weightKg }) => ({
        productId,
        variantId,
        quantity,
        heightCm,
        weightKg,
      }),
    ),
    ...(code.trim() ? { promoCode: code.trim().toUpperCase() } : {}),
  };
}
const journalKey = (id: string) => `stenzo.manual-attempt:${id}`;
export function readManualAttempt(
  id: string,
): { key: string; uncertain: boolean } | null {
  try {
    const a = JSON.parse(
      window.sessionStorage.getItem(journalKey(id)) ?? "null",
    );
    return a &&
      typeof a.key === "string" &&
      /^[A-Za-z0-9._:-]{16,200}$/.test(a.key) &&
      typeof a.uncertain === "boolean"
      ? a
      : null;
  } catch {
    return null;
  }
}
export function storeManualAttempt(
  id: string,
  key: string,
  uncertain: boolean,
) {
  try {
    window.sessionStorage.setItem(
      journalKey(id),
      JSON.stringify({ key, uncertain }),
    );
  } catch {
    /* in-memory retry remains available */
  }
}
export function clearManualAttempt(id: string) {
  try {
    window.sessionStorage.removeItem(journalKey(id));
  } catch {
    /* no personal fields are stored */
  }
}
