import type { CartSaleMode } from "@stenzo/shared";
export interface CartCategoryRecord {
  id?: string;
  nameRu?: string;
  nameUz?: string;
  slug?: string;
  requiresBuyerMeasurements?: boolean;
  attributeDefinitions?: unknown;
  archivedAt?: Date | null;
  isActive: boolean;
}

export interface CartProductRecord {
  attributes?: unknown;
  /** Internal only; the public Cart DTO deliberately omits this field. */
  costPrice?: number | null;
  archivedAt?: Date | null;
  id: string;
  nameRu: string;
  nameUz: string;
  slug: string;
  price: number;
  salePrice?: number | null;
  saleStartsAt?: Date | null;
  saleEndsAt?: Date | null;
  currency: "UZS";
  status: "DRAFT" | "ACTIVE" | "INACTIVE";
  category: CartCategoryRecord;
  images: Array<{ url: string; isPrimary: boolean; sortOrder: number }>;
}

export interface CartVariantRecord {
  preorderEnabled?: boolean;
  attributes?: unknown;
  id: string;
  productId: string;
  sku: string;
  size: string;
  color: string | null;
  stock: number | null;
  isActive: boolean;
}

export interface CartItemRecord {
  saleMode?: string;
  id: string;
  cartId: string;
  productId: string;
  variantId: string;
  quantity: number;
  heightCm: number | null;
  weightKg: number | null;
  createdAt: Date;
  updatedAt: Date;
  product: CartProductRecord;
  variant: CartVariantRecord;
}

export interface CartRecord {
  id: string;
  userId: string;
  createdAt: Date;
  updatedAt: Date;
  items: CartItemRecord[];
}

export interface AddCartItemInput {
  saleMode?: CartSaleMode;
  productId: string;
  variantId: string;
  quantity: number;
  heightCm: number | null;
  weightKg: number | null;
}

export interface PatchCartItemInput {
  quantity?: number;
  heightCm?: number | null;
  weightKg?: number | null;
}

export interface CartItemDto {
  saleMode: CartSaleMode;
  checkoutEnabled: boolean;
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

export interface CartDto {
  id: string;
  items: CartItemDto[];
  subtotal: number;
  currency: "UZS";
  updatedAt: Date;
}
