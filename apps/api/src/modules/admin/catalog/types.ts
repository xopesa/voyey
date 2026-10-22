import type {
  CatalogCategoryRecord,
  CatalogImageRecord,
  CatalogProductRecord,
  CatalogVariantRecord,
} from "../../catalog/types.js";
import type {
  ChannelPublication,
  CatalogAttributeDefinition,
  CatalogAttributeValues,
} from "@stenzo/shared";

export type AdminCategoryRecord = CatalogCategoryRecord;
export type AdminProductRecord = CatalogProductRecord & {
  sourceUrl: string | null;
  costPrice?: number | null;
  telegramPublication?: ChannelPublication;
};
export type AdminImageRecord = CatalogImageRecord;
export type AdminVariantRecord = CatalogVariantRecord;
export type ProductStatusValue = "DRAFT" | "ACTIVE" | "INACTIVE";

export interface CategoryCreateInput {
  attributeDefinitions?: CatalogAttributeDefinition[];
  nameRu: string;
  nameUz: string;
  slug: string;
  sortOrder: number;
  isActive: boolean;
}

export interface CategoryPatchInput {
  attributeDefinitions?: CatalogAttributeDefinition[];
  nameRu?: string;
  nameUz?: string;
  slug?: string;
  sortOrder?: number;
}

export interface ProductCreateInput {
  attributes?: CatalogAttributeValues;
  categoryId: string;
  nameRu: string;
  nameUz: string;
  slug: string;
  descriptionRu: string | null;
  descriptionUz: string | null;
  sourceUrl: string | null;
  costPrice?: number | null;
  salePrice?: number | null;
  saleStartsAt?: Date | null;
  saleEndsAt?: Date | null;
  price: number;
  currency: "UZS";
  status: ProductStatusValue;
  isFeatured: boolean;
}

export interface ProductPatchInput {
  attributes?: CatalogAttributeValues;
  categoryId?: string;
  nameRu?: string;
  nameUz?: string;
  slug?: string;
  descriptionRu?: string | null;
  descriptionUz?: string | null;
  sourceUrl?: string | null;
  costPrice?: number | null;
  status?: ProductStatusValue;
  salePrice?: number | null;
  saleStartsAt?: Date | null;
  saleEndsAt?: Date | null;
  price?: number;
  isFeatured?: boolean;
}

export interface ProductImageCreateInput {
  url: string;
  storageKey?: string | null;
  sortOrder: number;
  isPrimary: boolean;
}

export interface ProductImagePatchInput {
  url?: string;
  sortOrder?: number;
  isPrimary?: boolean;
}

export interface ProductImageUploadInput {
  data: Buffer;
  declaredMimeType: string;
  sortOrder: number;
  isPrimary: boolean;
}

export interface ProductVariantCreateInput {
  attributes?: CatalogAttributeValues;
  preorderEnabled?: boolean;
  sku: string;
  size?: string;
  color: string | null;
  stock: number | null;
  isActive: boolean;
}

export interface ProductVariantPatchInput {
  attributes?: CatalogAttributeValues;
  preorderEnabled?: boolean;
  sku?: string;
  size?: string;
  color?: string | null;
  stock?: number | null;
  isActive?: boolean;
}

export interface AdminProductListQuery {
  archive?: "current" | "archived";
  category?: string;
  search?: string;
  status?: ProductStatusValue;
  limit: number;
  cursor?: string;
}

export interface AdminProductListResult {
  products: AdminProductRecord[];
  nextCursor: string | null;
}
