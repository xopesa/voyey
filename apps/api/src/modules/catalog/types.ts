import type {
  VariantSaleAvailability,
  CatalogAttributeDefinition,
  CatalogAttributeValues,
} from "@stenzo/shared";

export interface CatalogCategoryRecord {
  requiresBuyerMeasurements?: boolean;
  /** Raw JSON from repositories; absent on legacy fixtures. */
  attributeDefinitions?: unknown;
  archivedAt?: Date | null;
  id: string;
  nameRu: string;
  nameUz: string;
  slug: string;
  sortOrder: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface CatalogImageRecord {
  id: string;
  productId: string;
  url: string;
  storageKey: string | null;
  sortOrder: number;
  isPrimary: boolean;
  createdAt: Date;
}

export interface CatalogVariantRecord {
  attributes?: unknown;
  /** Optional for legacy repository fixtures; migrated D1 rows always have a boolean. */
  preorderEnabled?: boolean;
  id: string;
  productId: string;
  sku: string;
  size: string;
  color: string | null;
  stock: number | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface CatalogProductRecord {
  attributes?: unknown;
  archivedAt?: Date | null;
  id: string;
  categoryId: string;
  nameRu: string;
  nameUz: string;
  slug: string;
  descriptionRu: string | null;
  descriptionUz: string | null;
  price: number;
  salePrice?: number | null;
  saleStartsAt?: Date | null;
  saleEndsAt?: Date | null;
  currency: "UZS";
  status: "DRAFT" | "ACTIVE" | "INACTIVE";
  isFeatured: boolean;
  createdAt: Date;
  updatedAt: Date;
  category: CatalogCategoryRecord;
  images: CatalogImageRecord[];
  variants: CatalogVariantRecord[];
}

export interface CatalogProductListQuery {
  category?: string;
  search?: string;
  limit: number;
  cursor?: string;
}

export interface CatalogProductListResult {
  products: CatalogProductRecord[];
  nextCursor: string | null;
}

export interface CategoryDto {
  requiresBuyerMeasurements: boolean;
  attributeDefinitions: CatalogAttributeDefinition[];
  id: string;
  nameRu: string;
  nameUz: string;
  slug: string;
  sortOrder: number;
}

export interface ProductImageDto {
  id: string;
  url: string;
  sortOrder: number;
  isPrimary: boolean;
}

export interface ProductVariantDto {
  attributes: CatalogAttributeValues;
  availability: VariantSaleAvailability;
  id: string;
  sku: string;
  size: string;
  color: string | null;
  stock: number | null;
  isAvailable: boolean;
}

export interface ProductDto {
  attributes: CatalogAttributeValues;
  effectivePrice: number;
  isOnSale: boolean;
  id: string;
  nameRu: string;
  nameUz: string;
  slug: string;
  descriptionRu: string | null;
  descriptionUz: string | null;
  price: number;
  salePrice?: number | null;
  saleStartsAt?: Date | null;
  saleEndsAt?: Date | null;
  currency: "UZS";
  isFeatured: boolean;
  category: CategoryDto;
  images: ProductImageDto[];
  variants: ProductVariantDto[];
  availableSizes: string[];
}
