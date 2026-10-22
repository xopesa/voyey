import { effectiveProductPrice, variantSaleAvailability } from "@stenzo/shared";
import { CatalogProductNotFoundError } from "./errors.js";
import type { CatalogRepository } from "./repository.js";
import type {
  CatalogCategoryRecord,
  CatalogProductListQuery,
  CatalogProductRecord,
  CategoryDto,
  ProductDto,
} from "./types.js";

function toCategoryDto(category: CatalogCategoryRecord): CategoryDto {
  return {
    id: category.id,
    nameRu: category.nameRu,
    nameUz: category.nameUz,
    slug: category.slug,
    sortOrder: category.sortOrder,
  };
}

export function toProductDto(product: CatalogProductRecord): ProductDto {
  const variants = product.variants.map((variant) => ({
    id: variant.id,
    sku: variant.sku,
    size: variant.size,
    color: variant.color,
    stock: variant.stock,
    availability: variantSaleAvailability(
      variant.stock,
      variant.preorderEnabled,
    ),
    isAvailable: variant.stock === null || variant.stock > 0,
  }));
  return {
    id: product.id,
    nameRu: product.nameRu,
    nameUz: product.nameUz,
    slug: product.slug,
    descriptionRu: product.descriptionRu,
    descriptionUz: product.descriptionUz,
    price: product.price,
    salePrice: product.salePrice ?? null,
    saleStartsAt: product.saleStartsAt ?? null,
    saleEndsAt: product.saleEndsAt ?? null,
    ...effectiveProductPrice(product),
    currency: product.currency,
    isFeatured: product.isFeatured,
    category: toCategoryDto(product.category),
    images: product.images.map((image) => ({
      id: image.id,
      url: image.url,
      sortOrder: image.sortOrder,
      isPrimary: image.isPrimary,
    })),
    variants,
    availableSizes: [
      ...new Set(
        variants
          .filter((variant) => variant.isAvailable)
          .map((variant) => variant.size),
      ),
    ],
  };
}

export class CatalogService {
  public constructor(private readonly repository: CatalogRepository) {}

  public async listCategories(): Promise<CategoryDto[]> {
    return (await this.repository.listActiveCategories()).map(toCategoryDto);
  }

  public async listProducts(
    query: CatalogProductListQuery,
  ): Promise<{ products: ProductDto[]; nextCursor: string | null }> {
    const result = await this.repository.listActiveProducts(query);
    return {
      products: result.products.map(toProductDto),
      nextCursor: result.nextCursor,
    };
  }

  public async getProductBySlug(slug: string): Promise<ProductDto> {
    const product = await this.repository.getActiveProductBySlug(slug);
    if (!product) throw new CatalogProductNotFoundError();
    return toProductDto(product);
  }
}
