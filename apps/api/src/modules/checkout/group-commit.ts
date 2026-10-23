import { createHash } from "node:crypto";
import { atomic, prisma } from "@stenzo/database";
import { cartInclude } from "../cart/repository.js";
import { recipientSchema, idempotencyKeySchema } from "../orders/schemas.js";
import { HttpError } from "../auth/errors.js";
import { buildSplitCheckoutPlan } from "./split-plan.js";
import {
  calculateSplitFinance,
  splitFinanceSelectionSchema,
} from "./finance.js";
import { promoForCheckout } from "../marketing/promo-codes.js";
import { createPublicOrderId } from "./domain.js";
import { database } from "@stenzo/database";
import { readCheckoutGroup } from "./group-store.js";

const schema = splitFinanceSelectionSchema
  .extend({ recipient: recipientSchema })
  .strict();
const fingerprint = (v: unknown) =>
  createHash("sha256").update(JSON.stringify(v)).digest("hex");
/** Internal only. No HTTP route, notifications, credentials or environment activation switch. */
export class LinkedCheckoutCommit {
  constructor(private readonly enabled = false) {}
  async create(userId: string, key: string, value: unknown) {
    if (!this.enabled)
      throw new HttpError(503, "Linked checkout is disabled until 2.4C");
    const request = schema.safeParse(value),
      parsedKey = idempotencyKeySchema.safeParse(key);
    if (!request.success || !parsedKey.success)
      throw new HttpError(400, "Invalid linked checkout request");
    key = parsedKey.data;
    const data = request.data;
    // Canonical request intent excludes today's cart/catalog so replay never consumes a new cart.
    const requestFingerprint = fingerprint({
      operation: "VOYEY_LINKED_V1",
      recipient: data.recipient,
      preorderPercent: data.preorderPercent ?? null,
      promoCode: data.promoCode?.trim().toUpperCase() ?? null,
    });
    const groupId = crypto.randomUUID();
    const id = await atomic(async (b) => {
      const user = await prisma.user.findUnique({ where: { id: userId } });
      if (!user || user.status !== "ACTIVE")
        throw new HttpError(409, "Customer unavailable");
      const old = await database()
        .prepare(
          "SELECT id,requestFingerprint,sealed FROM CheckoutGroup WHERE userId=? AND idempotencyKey=?",
        )
        .bind(userId, key)
        .first<{ id: string; requestFingerprint: string; sealed: number }>();
      if (old) {
        if (!old.sealed || old.requestFingerprint !== requestFingerprint)
          throw new HttpError(409, "Incompatible checkout key reuse");
        return old.id;
      }
      if (
        await prisma.order.findUnique({
          where: { userId_idempotencyKey: { userId, idempotencyKey: key } },
        })
      )
        throw new HttpError(409, "Key belongs to legacy order");
      const cart = await prisma.cart.findUnique({
        where: { userId },
        include: cartInclude,
      });
      if (!cart) throw new HttpError(409, "Cart is empty");
      const now = Date.now(),
        plan = buildSplitCheckoutPlan(cart, key, now);
      let discount = 0,
        promoId: string | undefined;
      if (data.promoCode !== undefined) {
        const quote = await promoForCheckout(
          userId,
          data.promoCode,
          plan.subtotal,
          now,
        );
        if (!quote.quote.valid) throw new HttpError(409, quote.quote.reason);
        discount = quote.quote.discountAmount;
        promoId = quote.promoCodeId;
      }
      const finance = calculateSplitFinance(
        plan,
        data.preorderPercent,
        discount,
      );
      b.sql(
        "INSERT INTO CheckoutGroup(id,userId,idempotencyKey,requestFingerprint,recipient,goodsSubtotal,discountAmount,goodsTotal,createdAt) VALUES(?,?,?,?,?,?,?,?,?)",
        groupId,
        userId,
        key,
        requestFingerprint,
        data.recipient,
        finance.subtotal,
        discount,
        finance.goodsTotal,
        now,
      );
      for (const order of plan.orders) {
        const policy = finance.groups.find(
            (g) => g.saleMode === order.saleMode,
          )!,
          orderId = crypto.randomUUID();
        b.sql(
          "INSERT INTO CheckoutOrder(id,publicId,checkoutGroupId,saleMode,financialPolicy,goodsSubtotal,discountAmount,goodsTotal,prepaymentPercent,firstPaymentAmount,remainingAfterFirst,unpaidGoods,createdAt) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)",
          orderId,
          createPublicOrderId(),
          groupId,
          order.saleMode,
          { version: 1, ...policy },
          policy.goodsSubtotal,
          policy.discountAmount,
          policy.goodsTotal,
          policy.prepaymentPercent,
          policy.firstPaymentAmount,
          policy.goodsRemainderAfterFirstConfirmation,
          policy.goodsTotal,
          now,
        );
        for (const item of order.items) {
          b.sql(
            "INSERT INTO CheckoutOrderItem(id,orderId,saleMode,cartItemId,productId,variantId,quantity,unitPrice,lineTotal,inventoryReservedQuantity,snapshot,createdAt) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
            crypto.randomUUID(),
            orderId,
            order.saleMode,
            item.cartItemId,
            item.productId,
            item.variantId,
            item.quantity,
            item.unitPrice,
            item.lineTotal,
            item.inventoryReservedQuantity,
            { version: 1, ...item },
            now,
          );
        }
        b.insert("AuditLog", {
          actorId: userId,
          action: "linked-order.create",
          entityType: "CheckoutOrder",
          entityId: orderId,
          metadata: { checkoutGroupId: groupId, saleMode: order.saleMode },
        });
      }
      for (const reserve of plan.inventory)
        b.update("ProductVariant", reserve.variantId, {
          stock: reserve.expectedStock - reserve.quantity,
        });
      if (promoId)
        b.sql(
          "INSERT INTO CheckoutPromoUse(id,checkoutGroupId,userId,promoCodeId,discountAmount,createdAt) VALUES(?,?,?,?,?,?)",
          crypto.randomUUID(),
          groupId,
          userId,
          promoId,
          discount,
          now,
        );
      for (const itemId of plan.consumeCartItemIds)
        b.delete("CartItem", "id", itemId);
      b.insert("AuditLog", {
        actorId: userId,
        action: "checkout-group.create",
        entityType: "CheckoutGroup",
        entityId: groupId,
        metadata: { orderCount: plan.orders.length },
      });
      b.sql("UPDATE CheckoutGroup SET sealed=1 WHERE id=?", groupId);
      return groupId;
    });
    return readCheckoutGroup(userId, id);
  }
}
