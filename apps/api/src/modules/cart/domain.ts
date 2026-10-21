import {
  CartProductUnavailableError,
  CartQuantityLimitError,
  CartStockExceededError,
  CartVariantProductMismatchError,
  CartVariantUnavailableError,
} from "./errors.js";
import type { CartProductRecord, CartVariantRecord } from "./types.js";

export const MAX_CART_ITEM_QUANTITY = 99;

export function assertPurchasable(
  product: CartProductRecord | null,
  variant: CartVariantRecord | null,
  productId: string,
  quantity: number,
): asserts product is CartProductRecord {
  if (
    !product ||
    product.archivedAt ||
    product.category.archivedAt ||
    product.status !== "ACTIVE" ||
    !product.category.isActive
  ) {
    throw new CartProductUnavailableError();
  }
  if (!variant || !variant.isActive) throw new CartVariantUnavailableError();
  if (variant.productId !== productId)
    throw new CartVariantProductMismatchError();
  if (quantity < 1 || quantity > MAX_CART_ITEM_QUANTITY) {
    throw new CartQuantityLimitError();
  }
  if (variant.stock !== null && quantity > variant.stock) {
    throw new CartStockExceededError(variant.stock);
  }
}
