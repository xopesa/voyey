import { Prisma, prisma } from "@stenzo/database";

import { assertPurchasable } from "./domain.js";
import { CartItemNotFoundError } from "./errors.js";
import type {
  AddCartItemInput,
  CartProductRecord,
  CartRecord,
  CartVariantRecord,
  PatchCartItemInput,
} from "./types.js";

export const cartInclude = {
  items: {
    orderBy: [{ createdAt: "asc" as const }, { id: "asc" as const }],
    include: {
      product: {
        include: {
          category: true,
          images: {
            orderBy: [
              { isPrimary: "desc" as const },
              { sortOrder: "asc" as const },
              { id: "asc" as const },
            ],
            take: 1,
          },
        },
      },
      variant: true,
    },
  },
};

export interface CartRepository {
  getOrCreate(userId: string): Promise<CartRecord>;
  addItem(userId: string, input: AddCartItemInput): Promise<CartRecord>;
  updateItem(
    userId: string,
    itemId: string,
    input: PatchCartItemInput,
  ): Promise<CartRecord>;
  deleteItem(userId: string, itemId: string): Promise<CartRecord>;
  clear(userId: string): Promise<CartRecord>;
}

function getCart(
  tx: Prisma.TransactionClient,
  userId: string,
): Promise<CartRecord> {
  return tx.cart.findUniqueOrThrow({ where: { userId }, include: cartInclude });
}

function prismaCode(error: unknown): string | undefined {
  if (typeof error === "object" && error !== null && "code" in error) {
    return typeof error.code === "string" ? error.code : undefined;
  }
  return undefined;
}

async function runCartTransaction<T>(
  operation: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await prisma.$transaction(operation, {
        isolationLevel: "Serializable",
      });
    } catch (error) {
      const retryable =
        prismaCode(error) === "P2034" || prismaCode(error) === "P2002";
      if (!retryable || attempt === 2) throw error;
    }
  }
  throw new Error("Unreachable cart transaction state");
}

async function loadSelection(
  tx: Prisma.TransactionClient,
  productId: string,
  variantId: string,
): Promise<{
  product: CartProductRecord | null;
  variant: CartVariantRecord | null;
}> {
  const [product, variant] = await Promise.all([
    tx.product.findUnique({
      where: { id: productId },
      include: {
        category: { select: { isActive: true, archivedAt: true } },
        images: {
          orderBy: [{ isPrimary: "desc" }, { sortOrder: "asc" }, { id: "asc" }],
          take: 1,
        },
      },
    }),
    tx.productVariant.findUnique({ where: { id: variantId } }),
  ]);
  return { product, variant };
}

export class PrismaCartRepository implements CartRepository {
  public getOrCreate(userId: string): Promise<CartRecord> {
    return prisma.cart.upsert({
      where: { userId },
      create: { userId },
      update: {},
      include: cartInclude,
    });
  }

  public addItem(userId: string, input: AddCartItemInput): Promise<CartRecord> {
    return runCartTransaction(async (tx) => {
      const cart = await tx.cart.upsert({
        where: { userId },
        create: { userId },
        update: {},
        select: { id: true },
      });
      const { product, variant } = await loadSelection(
        tx,
        input.productId,
        input.variantId,
      );
      const existing = await tx.cartItem.findUnique({
        where: {
          cartId_variantId: { cartId: cart.id, variantId: input.variantId },
        },
        select: { id: true, quantity: true },
      });
      const quantity = (existing?.quantity ?? 0) + input.quantity;
      assertPurchasable(product, variant, input.productId, quantity);
      if (existing) {
        await tx.cartItem.update({
          where: { id: existing.id },
          data: {
            quantity,
            heightCm: input.heightCm,
            weightKg: input.weightKg,
          },
        });
      } else {
        await tx.cartItem.create({
          data: { cartId: cart.id, ...input },
        });
      }
      return getCart(tx, userId);
    });
  }

  public updateItem(
    userId: string,
    itemId: string,
    input: PatchCartItemInput,
  ): Promise<CartRecord> {
    return runCartTransaction(async (tx) => {
      const item = await tx.cartItem.findFirst({
        where: { id: itemId, cart: { userId } },
      });
      if (!item) throw new CartItemNotFoundError();
      const { product, variant } = await loadSelection(
        tx,
        item.productId,
        item.variantId,
      );
      assertPurchasable(
        product,
        variant,
        item.productId,
        input.quantity ?? item.quantity,
      );
      await tx.cartItem.update({ where: { id: item.id }, data: input });
      return getCart(tx, userId);
    });
  }

  public deleteItem(userId: string, itemId: string): Promise<CartRecord> {
    return runCartTransaction(async (tx) => {
      const item = await tx.cartItem.findFirst({
        where: { id: itemId, cart: { userId } },
        select: { id: true },
      });
      if (!item) throw new CartItemNotFoundError();
      await tx.cartItem.delete({ where: { id: item.id } });
      return getCart(tx, userId);
    });
  }

  public clear(userId: string): Promise<CartRecord> {
    return runCartTransaction(async (tx) => {
      const cart = await tx.cart.upsert({
        where: { userId },
        create: { userId },
        update: {},
        select: { id: true },
      });
      await tx.cartItem.deleteMany({ where: { cartId: cart.id } });
      return getCart(tx, userId);
    });
  }
}
