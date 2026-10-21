import {
  fromTashkentInput,
  toTashkentInput,
  validPromotion,
} from "@stenzo/shared";
export type ProductStatus = "DRAFT" | "ACTIVE" | "INACTIVE";
export type Category = {
  archivedAt?: string | null;
  id: string;
  nameRu: string;
  nameUz: string;
  slug: string;
  isActive: boolean;
};
export type ProductImage = {
  id: string;
  url: string;
  sortOrder: number;
  isPrimary: boolean;
};
export type ProductVariant = {
  id: string;
  sku: string;
  size: string;
  color: string | null;
  stock: number | null;
  isActive: boolean;
};
export type Product = {
  archivedAt?: string | null;
  telegramPublication?: import("@stenzo/shared").ChannelPublication;
  id: string;
  categoryId: string;
  nameRu: string;
  nameUz: string;
  descriptionRu: string | null;
  descriptionUz: string | null;
  slug: string;
  salePrice?: number | null;
  saleStartsAt?: string | null;
  saleEndsAt?: string | null;
  price: number;
  currency: "UZS";
  status: ProductStatus;
  sourceUrl: string | null;
  costPrice?: number | null;
  category: Category;
  images: ProductImage[];
  variants: ProductVariant[];
};
export type ProductDraft = {
  nameRu: string;
  nameUz: string;
  descriptionRu: string;
  descriptionUz: string;
  slug: string;
  categoryId: string;
  salePrice: string;
  saleStartsAt: string;
  saleEndsAt: string;
  price: string;
  status: ProductStatus;
  sourceUrl: string;
  costPrice: string;
};
export const emptyDraft: ProductDraft = {
  nameRu: "",
  nameUz: "",
  descriptionRu: "",
  descriptionUz: "",
  slug: "",
  categoryId: "",
  salePrice: "",
  saleStartsAt: "",
  saleEndsAt: "",
  price: "",
  status: "DRAFT",
  sourceUrl: "",
  costPrice: "",
};
export function productDraft(product: Product): ProductDraft {
  return {
    nameRu: product.nameRu,
    nameUz: product.nameUz,
    descriptionRu: product.descriptionRu ?? "",
    descriptionUz: product.descriptionUz ?? "",
    slug: product.slug,
    categoryId: product.categoryId,
    salePrice: product.salePrice == null ? "" : String(product.salePrice),
    saleStartsAt: toTashkentInput(product.saleStartsAt),
    saleEndsAt: toTashkentInput(product.saleEndsAt),
    price: String(product.price),
    status: product.status,
    sourceUrl: product.sourceUrl ?? "",
    costPrice: product.costPrice == null ? "" : String(product.costPrice),
  };
}
export function integer(value: string, minimum = 0): number {
  if (!/^\d+$/.test(value.trim())) throw new Error("invalidInteger");
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < minimum || number > 2147483647)
    throw new Error("invalidInteger");
  return number;
}
export function productInput(draft: ProductDraft) {
  const sourceUrl = draft.sourceUrl.trim();
  if (sourceUrl) {
    let url: URL;
    try {
      url = new URL(sourceUrl);
    } catch {
      throw new Error("invalidSource");
    }
    if (!["http:", "https:"].includes(url.protocol) || sourceUrl.length > 2048)
      throw new Error("invalidSource");
  }
  if (
    !draft.nameRu.trim() ||
    !draft.nameUz.trim() ||
    !draft.categoryId ||
    !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(draft.slug.trim())
  )
    throw new Error("invalid");
  const sale = {
    price: integer(draft.price, 1),
    salePrice: draft.salePrice ? integer(draft.salePrice, 1) : null,
    saleStartsAt: fromTashkentInput(draft.saleStartsAt || ""),
    saleEndsAt: fromTashkentInput(draft.saleEndsAt || ""),
  };
  if (!validPromotion(sale)) throw new Error("invalidPromotion");
  return {
    ...draft,
    ...sale,
    costPrice: draft.costPrice?.trim() ? integer(draft.costPrice, 1) : null,
    nameRu: draft.nameRu.trim(),
    nameUz: draft.nameUz.trim(),
    slug: draft.slug.trim(),
    descriptionRu: draft.descriptionRu.trim() || null,
    descriptionUz: draft.descriptionUz.trim() || null,
    price: integer(draft.price, 1),
    currency: "UZS" as const,
    sourceUrl: sourceUrl || null,
  };
}
export function productQuery(
  filters: {
    search: string;
    category: string;
    status: string;
    archive?: "current" | "archived";
  },
  cursor?: string,
) {
  const params = new URLSearchParams({ limit: "20" });
  if (filters.search.trim()) params.set("search", filters.search.trim());
  if (filters.category) params.set("category", filters.category);
  if (filters.status) params.set("status", filters.status);
  if (filters.archive) params.set("archive", filters.archive);
  if (cursor) params.set("cursor", cursor);
  return `catalog/products?${params}`;
}
export function safeImageUrl(value: string) {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) ? url.href : undefined;
  } catch {
    return undefined;
  }
}
