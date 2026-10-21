export interface CartItem {
  id: string;
  quantity: number;
  heightCm: number | null;
  weightKg: number | null;
  originalUnitPrice?: number | null;
  isOnSale?: boolean;
  unitPrice: number;
  lineTotal: number;
  currency: "UZS";
  isAvailable: boolean;
  product: {
    id: string;
    nameRu: string;
    nameUz: string;
    slug: string;
    imageUrl: string | null;
  };
  variant: {
    id: string;
    sku: string;
    size: string;
    color: string | null;
    stock: number | null;
  };
}
export interface Cart {
  id: string;
  items: CartItem[];
  subtotal: number;
  currency: "UZS";
  updatedAt: string;
}
export interface CartItemPatch {
  quantity?: number;
  heightCm?: number | null;
  weightKg?: number | null;
}
export function cartItemCount(cart?: Cart): number {
  return cart?.items.reduce((total, item) => total + item.quantity, 0) ?? 0;
}
function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object";
}
function amount(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}
function integer(value: unknown, min: number, max: number): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= min &&
    value <= max
  );
}
function height(value: unknown) {
  return value === null || integer(value, 100, 250);
}
function weight(value: unknown) {
  return value === null || integer(value, 30, 300);
}
export function isCartItem(value: unknown): value is CartItem {
  return (
    record(value) &&
    typeof value.id === "string" &&
    integer(value.quantity, 1, 99) &&
    height(value.heightCm) &&
    weight(value.weightKg) &&
    amount(value.unitPrice) &&
    amount(value.lineTotal) &&
    value.currency === "UZS" &&
    typeof value.isAvailable === "boolean" &&
    record(value.product) &&
    [
      value.product.id,
      value.product.nameRu,
      value.product.nameUz,
      value.product.slug,
    ].every((field) => typeof field === "string") &&
    (value.product.imageUrl === null ||
      typeof value.product.imageUrl === "string") &&
    record(value.variant) &&
    [value.variant.id, value.variant.sku, value.variant.size].every(
      (field) => typeof field === "string",
    ) &&
    (value.variant.color === null || typeof value.variant.color === "string") &&
    (value.variant.stock === null ||
      integer(value.variant.stock, 0, Number.MAX_SAFE_INTEGER))
  );
}
export function isCart(value: unknown): value is Cart {
  return (
    record(value) &&
    typeof value.id === "string" &&
    Array.isArray(value.items) &&
    value.items.every(isCartItem) &&
    new Set(value.items.map((item) => item.id)).size === value.items.length &&
    amount(value.subtotal) &&
    value.currency === "UZS" &&
    typeof value.updatedAt === "string"
  );
}
export function validCartPatch(input: CartItemPatch) {
  const keys = Object.keys(input);
  return (
    keys.length > 0 &&
    keys.every((key) => ["quantity", "heightCm", "weightKg"].includes(key)) &&
    (!Object.hasOwn(input, "quantity") || integer(input.quantity, 1, 99)) &&
    (!Object.hasOwn(input, "heightCm") || height(input.heightCm)) &&
    (!Object.hasOwn(input, "weightKg") || weight(input.weightKg))
  );
}
export function cartPatchConfirmed(
  cart: Cart,
  id: string,
  input: CartItemPatch,
) {
  const item = cart.items.find((item) => item.id === id);
  return (
    !!item &&
    (Object.keys(input) as (keyof CartItemPatch)[]).every(
      (key) => item[key] === input[key],
    )
  );
}
export function cartQuantityLimit(item: CartItem) {
  return Math.min(item.variant.stock ?? 99, 99);
}
export function cartCanDecrease(item: CartItem) {
  return (
    item.quantity > 1 &&
    (item.isAvailable ||
      (item.variant.stock !== null &&
        item.variant.stock > 0 &&
        item.quantity > item.variant.stock))
  );
}
export function cartDecreasedQuantity(item: CartItem) {
  return Math.max(1, Math.min(item.quantity - 1, cartQuantityLimit(item)));
}
export function cartImageSource(item: CartItem) {
  const source = item.product.imageUrl;
  return source &&
    (/^https?:\/\//i.test(source) ||
      (source.startsWith("/") && !source.startsWith("//")))
    ? source
    : undefined;
}
export function formatCartAmount(value: number, currencyLabel: string) {
  return `${new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 }).format(value).replace(/\s/g, " ")} ${currencyLabel}`;
}
// Display estimate only. Checkout remains authoritative; round odd sums up
// consistently with the existing checkout contract, without creating an order.
export function displayedPrepayment(subtotal: number) {
  return Math.ceil(subtotal / 2);
}
