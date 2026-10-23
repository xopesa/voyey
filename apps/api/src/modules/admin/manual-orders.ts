import { atomic, prisma } from "@stenzo/database";
import { z } from "zod";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { recipientSchema, idempotencyKeySchema } from "../orders/schemas.js";
import { addCartItemSchema } from "../cart/schemas.js";
import { assertPurchasable } from "../cart/domain.js";
import {
  createPublicOrderId,
  prepareOrderItems,
  type CheckoutLine,
} from "../checkout/domain.js";
import {
  priceD1Order,
  writeD1Order,
  D1OrderRepository,
} from "../../d1/repositories.js";
import { toAdminOrderDto } from "../orders/service.js";
import { HttpError } from "../auth/errors.js";
import {
  CartProductUnavailableError,
  CartQuantityLimitError,
  CartStockExceededError,
  CartVariantProductMismatchError,
  CartVariantUnavailableError,
} from "../cart/errors.js";
import {
  CheckoutAmountLimitError,
  CheckoutMeasurementsError,
} from "../checkout/errors.js";

export const manualOrderSchema = z
  .object({
    userId: z.string().min(1).max(100),
    recipient: recipientSchema,
    items: z.array(addCartItemSchema).min(1).max(20),
    promoCode: z.string().trim().min(3).max(32).optional(),
  })
  .strict();
export type ManualOrderInput = z.infer<typeof manualOrderSchema>;
export function parseManualOrder(value: unknown): ManualOrderInput {
  const parsed = manualOrderSchema.safeParse(value);
  if (!parsed.success) throw new HttpError(400, "manualInvalid");
  if (parsed.data.items.some((item) => item.saleMode !== undefined))
    throw new HttpError(
      400,
      "Explicit sale modes are disabled for manual orders",
    );
  if (
    new Set(parsed.data.items.map((i) => i.variantId)).size !==
    parsed.data.items.length
  )
    throw new HttpError(400, "manualDuplicateVariant");
  return parsed.data;
}
async function loadLines(input: ManualOrderInput): Promise<CheckoutLine[]> {
  const user = await prisma.user.findUnique({ where: { id: input.userId } });
  if (!user) throw new HttpError(404, "customerMissing");
  if (user.status !== "ACTIVE")
    throw new HttpError(409, "manualCustomerInactive");
  const lines: CheckoutLine[] = [];
  for (const item of input.items) {
    const product = await prisma.product.findUnique({
      where: { id: item.productId },
      include: {
        category: true,
        images: {
          orderBy: [{ isPrimary: "desc" }, { sortOrder: "asc" }, { id: "asc" }],
          take: 1,
        },
      },
    });
    const variant = await prisma.productVariant.findUnique({
      where: { id: item.variantId },
    });
    assertPurchasable(product, variant, item.productId, item.quantity);
    lines.push({ ...item, product, variant: variant! });
  }
  return lines;
}
export class ManualOrderService {
  async preview(value: unknown) {
    const input = parseManualOrder(value),
      lines = await loadLines(input),
      now = Date.now();
    const priced = await priceD1Order(
      input.userId,
      input.promoCode,
      prepareOrderItems(lines, now),
      now,
    );
    return {
      ...priced.amounts,
      discountAmount: priced.discountAmount,
      promoCodeSnapshot: priced.promoCodeSnapshot,
      items: priced.items,
    };
  }
  async create(actorId: string, key: string, value: unknown) {
    const parsedKey = idempotencyKeySchema.safeParse(key);
    if (!parsedKey.success)
      throw new HttpError(400, "A valid Idempotency-Key header is required");
    const input = parseManualOrder(value),
      publicId = createPublicOrderId();
    const result = await atomic(async (batch) => {
      // Historical replay precedes current user/product/promo validation.
      const existing = await prisma.order.findUnique({
        where: {
          userId_idempotencyKey: {
            userId: input.userId,
            idempotencyKey: parsedKey.data,
          },
        },
      });
      if (existing) {
        if (existing.source !== "ADMIN")
          throw new HttpError(
            409,
            "Idempotency key belongs to another order source",
          );
        return existing.publicId;
      }
      const lines = await loadLines(input),
        now = Date.now();
      const priced = await priceD1Order(
        input.userId,
        input.promoCode,
        prepareOrderItems(lines, now),
        now,
      );
      await writeD1Order(
        batch,
        {
          userId: input.userId,
          idempotencyKey: parsedKey.data,
          publicId,
          recipient: input.recipient,
          promoCode: input.promoCode,
        },
        lines,
        priced,
        "ADMIN",
        actorId,
      );
      return publicId;
    });
    // No cart operations and no order-created notification for manual creation.
    return toAdminOrderDto(
      (await new D1OrderRepository().getForAdmin(result))!,
    );
  }
}
export function registerManualOrderRoutes(
  app: FastifyInstance,
  guard: (r: FastifyRequest) => Promise<void>,
) {
  const service = new ManualOrderService();
  const mapError = (e: unknown): never => {
    if (
      e instanceof CartProductUnavailableError ||
      e instanceof CartVariantUnavailableError ||
      e instanceof CartVariantProductMismatchError ||
      e instanceof CartStockExceededError ||
      e instanceof CartQuantityLimitError ||
      e instanceof CheckoutAmountLimitError ||
      e instanceof CheckoutMeasurementsError
    )
      throw new HttpError(409, e.message);
    throw e;
  };
  app.post("/admin/orders/manual/preview", { preHandler: guard }, async (r) => {
    try {
      return { preview: await service.preview(r.body) };
    } catch (e) {
      return mapError(e);
    }
  });
  app.post("/admin/orders/manual", { preHandler: guard }, async (r, reply) => {
    const actor = r.webAdminActor ?? r.currentUser?.id;
    if (!actor) throw new HttpError(401, "Admin session required");
    const key = idempotencyKeySchema.safeParse(r.headers["idempotency-key"]);
    if (!key.success)
      throw new HttpError(400, "A valid Idempotency-Key header is required");
    try {
      return reply
        .status(201)
        .send({ order: await service.create(actor, key.data, r.body) });
    } catch (e) {
      return mapError(e);
    }
  });
}
