import { effectiveProductPrice } from "@stenzo/shared";
import { randomBytes } from "node:crypto";

import { assertPurchasable } from "../cart/domain.js";
import type { CartItemRecord, CartRecord } from "../cart/types.js";
import type { PreparedOrder } from "../orders/types.js";
import {
  CheckoutAmountLimitError,
  CheckoutEmptyCartError,
  CheckoutMeasurementsError,
} from "./errors.js";

const MAX_INT32 = 2_147_483_647;

export function createPublicOrderId(): string {
  const time = Date.now().toString(36).toUpperCase();
  const random = randomBytes(6).toString("hex").toUpperCase();
  return `STZ-${time}-${random}`;
}

export function prepareOrder(
  cart: CartRecord,
  now = Date.now(),
): PreparedOrder {
  return prepareOrderItems(cart.items, now);
}
export type CheckoutLine = Pick<
  CartItemRecord,
  | "productId"
  | "variantId"
  | "quantity"
  | "heightCm"
  | "weightKg"
  | "product"
  | "variant"
>;
export function prepareOrderItems(
  cartItems: CheckoutLine[],
  now = Date.now(),
): PreparedOrder {
  if (cartItems.length === 0) throw new CheckoutEmptyCartError();
  const items = cartItems.map((item) => {
    if (
      item.heightCm === null ||
      !Number.isInteger(item.heightCm) ||
      item.heightCm < 100 ||
      item.heightCm > 250 ||
      item.weightKg === null ||
      !Number.isInteger(item.weightKg) ||
      item.weightKg < 30 ||
      item.weightKg > 300
    )
      throw new CheckoutMeasurementsError();
    assertPurchasable(
      item.product,
      item.variant,
      item.productId,
      item.quantity,
    );
    const unitPrice = effectiveProductPrice(item.product, now).effectivePrice;
    const lineTotal = unitPrice * item.quantity;
    if (!Number.isSafeInteger(lineTotal) || lineTotal > MAX_INT32) {
      throw new CheckoutAmountLimitError();
    }
    return {
      productId: item.productId,
      variantId: item.variantId,
      productNameRu: item.product.nameRu,
      productNameUz: item.product.nameUz,
      productSlug: item.product.slug,
      imageUrl: item.product.images[0]?.url ?? null,
      sku: item.variant.sku,
      size: item.variant.size,
      color: item.variant.color,
      originalUnitPrice: item.product.price,
      unitPrice,
      quantity: item.quantity,
      lineTotal,
      heightCm: item.heightCm,
      weightKg: item.weightKg,
    };
  });
  const subtotal = items.reduce((sum, item) => sum + item.lineTotal, 0);
  if (!Number.isSafeInteger(subtotal) || subtotal > MAX_INT32) {
    throw new CheckoutAmountLimitError();
  }
  const requiredPrepayment = Math.floor(subtotal / 2) + (subtotal % 2);
  return {
    subtotal,
    total: subtotal,
    requiredPrepayment,
    paidAmount: 0,
    remainingAmount: subtotal - requiredPrepayment,
    cargoAmount: null,
    cargoPaidAmount: 0,
    items,
  };
}
