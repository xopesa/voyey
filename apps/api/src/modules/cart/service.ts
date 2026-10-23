import { effectiveProductPrice } from "@stenzo/shared";
import { assertCartSelection, cartSaleMode } from "./domain.js";
import type { CartRepository } from "./repository.js";
import type {
  AddCartItemInput,
  CartDto,
  CartRecord,
  PatchCartItemInput,
} from "./types.js";

export function toCartDto(cart: CartRecord, now = Date.now()): CartDto {
  const items = cart.items.map((item) => {
    let isAvailable = true;
    try {
      assertCartSelection(
        item.product,
        item.variant,
        item.productId,
        item.saleMode,
        item.quantity,
        cart.items.filter(
          (other) => other.variantId === item.variantId && other.id !== item.id,
        ),
      );
    } catch {
      isAvailable = false;
    }
    return {
      saleMode: cartSaleMode(item.saleMode),
      checkoutEnabled: cartSaleMode(item.saleMode) === "LEGACY",
      id: item.id,
      quantity: item.quantity,
      heightCm: item.heightCm,
      weightKg: item.weightKg,
      originalUnitPrice: item.product.price,
      isOnSale: effectiveProductPrice(item.product, now).isOnSale,
      unitPrice: effectiveProductPrice(item.product, now).effectivePrice,
      lineTotal:
        effectiveProductPrice(item.product, now).effectivePrice * item.quantity,
      currency: item.product.currency,
      isAvailable,
      product: {
        id: item.product.id,
        nameRu: item.product.nameRu,
        nameUz: item.product.nameUz,
        slug: item.product.slug,
        imageUrl: item.product.images[0]?.url ?? null,
      },
      variant: {
        id: item.variant.id,
        sku: item.variant.sku,
        size: item.variant.size,
        color: item.variant.color,
        stock: item.variant.stock,
      },
    };
  });
  return {
    id: cart.id,
    items,
    subtotal: items.reduce((sum, item) => sum + item.lineTotal, 0),
    currency: "UZS",
    updatedAt: cart.updatedAt,
  };
}

export class CartService {
  public constructor(private readonly repository: CartRepository) {}

  public async get(userId: string): Promise<CartDto> {
    return toCartDto(await this.repository.getOrCreate(userId));
  }

  public async addItem(
    userId: string,
    input: AddCartItemInput,
  ): Promise<CartDto> {
    return toCartDto(await this.repository.addItem(userId, input));
  }

  public async updateItem(
    userId: string,
    itemId: string,
    input: PatchCartItemInput,
  ): Promise<CartDto> {
    return toCartDto(await this.repository.updateItem(userId, itemId, input));
  }

  public async deleteItem(userId: string, itemId: string): Promise<CartDto> {
    return toCartDto(await this.repository.deleteItem(userId, itemId));
  }

  public async clear(userId: string): Promise<CartDto> {
    return toCartDto(await this.repository.clear(userId));
  }
}
