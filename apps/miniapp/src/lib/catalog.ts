export interface CatalogCategory {
  id: string;
  nameRu: string;
  nameUz: string;
  slug: string;
  sortOrder: number;
}

export interface CatalogProduct {
  id: string;
  nameRu: string;
  nameUz: string;
  slug: string;
  price: number;
  effectivePrice?: number;
  isOnSale?: boolean;
  salePrice?: number | null;
  saleStartsAt?: string | null;
  saleEndsAt?: string | null;
  currency: "UZS";
  category: CatalogCategory;
  images: { id: string; url: string; sortOrder: number; isPrimary: boolean }[];
  variants: {
    id: string;
    sku: string;
    size: string;
    color: string | null;
    stock: number | null;
    isAvailable: boolean;
  }[];
}

export function productIsAvailable(product: CatalogProduct) {
  return product.variants.some(
    (variant) =>
      variant.isAvailable && (variant.stock === null || variant.stock > 0),
  );
}

export interface CatalogProductsResponse {
  products: CatalogProduct[];
  nextCursor: string | null;
}

export type CatalogQuery = {
  category?: string;
  search?: string;
  limit?: number;
  cursor?: string;
};

export function catalogQueryString(query: CatalogQuery = {}) {
  const params = new URLSearchParams();
  if (query.category?.trim()) params.set("category", query.category.trim());
  if (query.search?.trim())
    params.set("search", query.search.trim().slice(0, 200));
  if (query.limit !== undefined) params.set("limit", String(query.limit));
  if (query.cursor?.trim()) params.set("cursor", query.cursor.trim());
  const value = params.toString();
  return value ? `?${value}` : "";
}

export function catalogHref(query: CatalogQuery = {}) {
  return `/catalog${catalogQueryString(query)}`;
}

export function productImageSource(
  product: CatalogProduct,
): string | undefined {
  const image =
    product.images.find((item) => item.isPrimary) ?? product.images[0];
  const source = image?.url;
  return source &&
    (/^https?:\/\//i.test(source) ||
      (source.startsWith("/") && !source.startsWith("//")))
    ? source
    : undefined;
}

export function formatProductPrice(price: number, locale: "ru" | "uz") {
  return `${new Intl.NumberFormat(locale === "ru" ? "ru-RU" : "uz-Latn-UZ", { maximumFractionDigits: 0 }).format(price)} UZS`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}

export function isCatalogCategory(value: unknown): value is CatalogCategory {
  return (
    isRecord(value) &&
    [value.id, value.nameRu, value.nameUz, value.slug].every(
      (item) => typeof item === "string",
    ) &&
    typeof value.sortOrder === "number"
  );
}

export function isCatalogProduct(value: unknown): value is CatalogProduct {
  return (
    isRecord(value) &&
    [value.id, value.nameRu, value.nameUz, value.slug].every(
      (item) => typeof item === "string",
    ) &&
    typeof value.price === "number" &&
    Number.isFinite(value.price) &&
    value.price >= 0 &&
    value.currency === "UZS" &&
    isCatalogCategory(value.category) &&
    Array.isArray(value.images) &&
    value.images.every(
      (image) =>
        isRecord(image) &&
        typeof image.id === "string" &&
        typeof image.url === "string" &&
        typeof image.sortOrder === "number" &&
        typeof image.isPrimary === "boolean",
    ) &&
    Array.isArray(value.variants) &&
    value.variants.every(
      (variant) =>
        isRecord(variant) &&
        [variant.id, variant.sku, variant.size].every(
          (item) => typeof item === "string",
        ) &&
        (variant.color === null || typeof variant.color === "string") &&
        (variant.stock === null ||
          (typeof variant.stock === "number" &&
            Number.isInteger(variant.stock) &&
            variant.stock >= 0)) &&
        typeof variant.isAvailable === "boolean" &&
        variant.isAvailable ===
          (variant.stock === null ||
            (typeof variant.stock === "number" && variant.stock > 0)),
    )
  );
}
