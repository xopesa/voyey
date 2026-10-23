import {
  CartProductUnavailableError,
  CartQuantityLimitError,
  CartStockExceededError,
  CartVariantProductMismatchError,
  CartVariantUnavailableError,
} from "./errors.js";
import type { CartProductRecord, CartVariantRecord } from "./types.js";
import { HttpError } from "../auth/errors.js";
import type { CartSaleMode } from "@stenzo/shared";

export function cartSaleMode(value?: string): CartSaleMode {
  if (value === undefined) return "LEGACY";
  if (value === "LEGACY" || value === "IN_STOCK" || value === "PREORDER")
    return value;
  throw new HttpError(400, "Invalid cart sale mode");
}
export function assertLegacyCheckout(lines: { saleMode?: string }[]) {
  if (lines.some((line) => cartSaleMode(line.saleMode) !== "LEGACY"))
    throw new HttpError(
      409,
      "Explicit sale modes require the future split checkout",
    );
}
export function assertCartSelection(
  product: CartProductRecord | null,
  variant: CartVariantRecord | null,
  productId: string,
  modeValue: string | undefined,
  quantity: number,
  siblings: { quantity: number; saleMode?: string }[],
) {
  const mode = cartSaleMode(modeValue);
  const total = quantity + siblings.reduce((n, row) => n + row.quantity, 0);
  if (
    !Number.isInteger(quantity) ||
    quantity < 1 ||
    !Number.isInteger(total) ||
    total > 99
  )
    throw new CartQuantityLimitError();
  assertPurchasable(
    product,
    variant && { ...variant, stock: null },
    productId,
    quantity,
  );
  if (mode === "PREORDER") {
    if (!variant!.preorderEnabled) throw new CartVariantUnavailableError();
  } else {
    if (mode === "IN_STOCK" && variant!.stock === null)
      throw new CartStockExceededError(0);
  }
  const stockQuantity =
    (mode === "PREORDER" ? 0 : quantity) +
    siblings.reduce(
      (n, row) =>
        n + (cartSaleMode(row.saleMode) === "PREORDER" ? 0 : row.quantity),
      0,
    );
  if (
    mode !== "PREORDER" &&
    variant!.stock !== null &&
    stockQuantity > variant!.stock
  )
    throw new CartStockExceededError(variant!.stock);
}

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
