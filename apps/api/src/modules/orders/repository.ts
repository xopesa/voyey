import { HttpError } from "../auth/errors.js";
import { Prisma, prisma } from "@stenzo/database";

import type { CartRecord } from "../cart/types.js";
import {
  CheckoutConflictError,
  CheckoutEmptyCartError,
} from "../checkout/errors.js";
import type {
  AdminOrderListQuery,
  OrderListQuery,
  OrderListResult,
  OrderRecord,
  PreparedOrder,
  RecipientInput,
} from "./types.js";
import { OrderInvalidCursorError } from "./errors.js";

export const orderInclude = {
  refund: true,
  items: { orderBy: [{ createdAt: "asc" as const }, { id: "asc" as const }] },
  payments: {
    orderBy: [{ submittedAt: "desc" as const }, { id: "desc" as const }],
  },
  user: {
    select: {
      id: true,
      telegramId: true,
      username: true,
      firstName: true,
      lastName: true,
      languageCode: true,
      preferredLocale: true,
    },
  },
};

export const adminOrderInclude = {
  ...orderInclude,
  items: {
    ...orderInclude.items,
    include: { product: { select: { sourceUrl: true } } },
  },
};

const checkoutCartInclude = {
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

export interface CheckoutWriteInput {
  userId: string;
  idempotencyKey: string;
  publicId: string;
  recipient: RecipientInput;
  promoCode?: string;
  prepare: (cart: CartRecord, now?: number) => PreparedOrder;
}

export interface CheckoutResult {
  order: OrderRecord;
  created: boolean;
}

export interface OrderRepository {
  checkout(input: CheckoutWriteInput): Promise<CheckoutResult>;
  listForUser(userId: string, query: OrderListQuery): Promise<OrderListResult>;
  getForUser(userId: string, publicId: string): Promise<OrderRecord | null>;
  listForAdmin(query: AdminOrderListQuery): Promise<OrderListResult>;
  getForAdmin(publicId: string): Promise<OrderRecord | null>;
}

function prismaCode(error: unknown): string | undefined {
  if (typeof error === "object" && error !== null && "code" in error) {
    return typeof error.code === "string" ? error.code : undefined;
  }
  return undefined;
}

export class PrismaOrderRepository implements OrderRepository {
  public async checkout(input: CheckoutWriteInput): Promise<CheckoutResult> {
    try {
      return await prisma.$transaction(
        async (tx) => {
          const existing = await tx.order.findUnique({
            where: {
              userId_idempotencyKey: {
                userId: input.userId,
                idempotencyKey: input.idempotencyKey,
              },
            },
            include: orderInclude,
          });
          if (existing) return { order: existing, created: false };
          // Promo accounting is implemented by the Cloudflare D1 repository.
          // Never silently ignore a supplied code on a legacy runtime.
          if (input.promoCode !== undefined)
            throw new HttpError(
              503,
              "Promo codes require the preview D1 runtime",
            );

          const cart = await tx.cart.findUnique({
            where: { userId: input.userId },
            include: checkoutCartInclude,
          });
          if (!cart || cart.items.length === 0)
            throw new CheckoutEmptyCartError();
          const prepared = input.prepare(cart);
          const order = await tx.order.create({
            data: {
              publicId: input.publicId,
              userId: input.userId,
              idempotencyKey: input.idempotencyKey,
              ...input.recipient,
              currency: "UZS",
              subtotal: prepared.subtotal,
              total: prepared.total,
              requiredPrepayment: prepared.requiredPrepayment,
              paidAmount: prepared.paidAmount,
              remainingAmount: prepared.remainingAmount,
              cargoAmount: prepared.cargoAmount,
              cargoPaidAmount: prepared.cargoPaidAmount,
              items: { create: prepared.items },
            },
            include: orderInclude,
          });
          await tx.auditLog.create({
            data: {
              actorId: input.userId,
              action: "order.create",
              entityType: "Order",
              entityId: order.id,
              metadata: {
                publicId: order.publicId,
                itemCount: order.items.length,
                total: order.total,
                requiredPrepayment: order.requiredPrepayment,
              },
            },
          });
          await tx.cartItem.deleteMany({ where: { cartId: cart.id } });
          return { order, created: true };
        },
        { isolationLevel: "Serializable" },
      );
    } catch (error) {
      if (prismaCode(error) === "P2002" || prismaCode(error) === "P2034") {
        const existing = await prisma.order.findUnique({
          where: {
            userId_idempotencyKey: {
              userId: input.userId,
              idempotencyKey: input.idempotencyKey,
            },
          },
          include: orderInclude,
        });
        if (existing) return { order: existing, created: false };
        throw new CheckoutConflictError();
      }
      throw error;
    }
  }

  public listForUser(
    userId: string,
    query: OrderListQuery,
  ): Promise<OrderListResult> {
    return this.list({ userId }, query);
  }

  public getForUser(
    userId: string,
    publicId: string,
  ): Promise<OrderRecord | null> {
    return prisma.order.findFirst({
      where: { userId, publicId },
      include: orderInclude,
    });
  }

  public listForAdmin(query: AdminOrderListQuery): Promise<OrderListResult> {
    return this.list(
      {
        ...(query.status ? { status: query.status } : {}),
        ...(query.search
          ? { publicId: { contains: query.search, mode: "insensitive" } }
          : {}),
      },
      query,
      adminOrderInclude,
    );
  }

  public getForAdmin(publicId: string): Promise<OrderRecord | null> {
    return prisma.order.findUnique({
      where: { publicId },
      include: adminOrderInclude,
    });
  }

  private async list(
    where: Prisma.OrderWhereInput,
    query: OrderListQuery,
    include: typeof orderInclude | typeof adminOrderInclude = orderInclude,
  ): Promise<OrderListResult> {
    if (query.cursor) {
      const cursor = await prisma.order.findFirst({
        where: { ...where, id: query.cursor },
        select: { id: true },
      });
      if (!cursor) throw new OrderInvalidCursorError();
    }
    const orders = await prisma.order.findMany({
      where,
      include,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      take: query.limit + 1,
    });
    const hasNextPage = orders.length > query.limit;
    const visible = hasNextPage ? orders.slice(0, query.limit) : orders;
    return {
      orders: visible,
      nextCursor: hasNextPage ? (visible.at(-1)?.id ?? null) : null,
    };
  }
}
