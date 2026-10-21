import { isCatalogProduct, type CatalogProduct } from "./catalog";

export interface ProductDetails extends CatalogProduct {
  descriptionRu: string | null;
  descriptionUz: string | null;
}
export type ProductVariant = CatalogProduct["variants"][number];
export interface CartItemInput {
  productId: string;
  variantId: string;
  quantity: number;
  heightCm: number | null;
  weightKg: number | null;
}

export function isProductDetails(value: unknown): value is ProductDetails {
  return (
    isCatalogProduct(value) &&
    "descriptionRu" in value &&
    "descriptionUz" in value &&
    (value.descriptionRu === null || typeof value.descriptionRu === "string") &&
    (value.descriptionUz === null || typeof value.descriptionUz === "string")
  );
}

export function quantityLimit(variant?: ProductVariant) {
  if (!variant?.isAvailable) return 0;
  return Math.min(variant.stock ?? 99, 99);
}

export function selectedVariant(
  product: CatalogProduct,
  size: string | undefined,
  color: string | null | undefined,
) {
  if (size === undefined || color === undefined) return undefined;
  return product.variants.find(
    (v) => v.size === size && v.color === color && quantityLimit(v) > 0,
  );
}

export function measurement(
  value: string,
  min: number,
  max: number,
): number | null | undefined {
  if (!value.trim()) return null;
  if (!/^\d+$/.test(value.trim())) return undefined;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= min && parsed <= max
    ? parsed
    : undefined;
}

export function validCartInput(input: CartItemInput) {
  return (
    Boolean(input.productId && input.variantId) &&
    Number.isInteger(input.quantity) &&
    input.quantity >= 1 &&
    input.quantity <= 99 &&
    (input.heightCm === null ||
      (Number.isInteger(input.heightCm) &&
        input.heightCm >= 100 &&
        input.heightCm <= 250)) &&
    (input.weightKg === null ||
      (Number.isInteger(input.weightKg) &&
        input.weightKg >= 30 &&
        input.weightKg <= 300))
  );
}

// Confirm the saved line, including measurements, before showing success.
export function cartConfirmsItem(
  value: unknown,
  input: CartItemInput,
): boolean {
  if (!value || typeof value !== "object" || !("cart" in value)) return false;
  const cart = value.cart;
  if (
    !cart ||
    typeof cart !== "object" ||
    !("items" in cart) ||
    !Array.isArray(cart.items)
  )
    return false;
  return cart.items.some(
    (item) =>
      item?.product?.id === input.productId &&
      item?.variant?.id === input.variantId &&
      Number.isInteger(item.quantity) &&
      item.quantity >= input.quantity &&
      item.heightCm === input.heightCm &&
      item.weightKg === input.weightKg,
  );
}

export function galleryImages(product: CatalogProduct) {
  return [...product.images]
    .filter(
      (image) =>
        /^https?:\/\//i.test(image.url) ||
        (image.url.startsWith("/") && !image.url.startsWith("//")),
    )
    .sort(
      (a, b) =>
        Number(b.isPrimary) - Number(a.isPrimary) || a.sortOrder - b.sortOrder,
    );
}

export function swipeDirection(dx: number, dy: number) {
  return Math.abs(dx) >= 40 && Math.abs(dx) > Math.abs(dy) * 1.2
    ? dx < 0
      ? 1
      : -1
    : 0;
}
