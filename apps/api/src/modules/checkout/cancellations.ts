import { createHash, randomUUID } from "node:crypto";
import { atomic, database } from "@stenzo/database";
import { z } from "zod";
import { VoyeyOwnerAuthority } from "../admin/owner.js";
import { HttpError } from "../auth/errors.js";
import { idempotencyKeySchema } from "../orders/schemas.js";
import { readOrderFinance } from "./payment-state.js";

const requestSchema = z
  .object({ reason: z.string().trim().min(1).max(500) })
  .strict();
type CancellationRow = {
  id: string;
  orderId: string;
  reason: string;
  createdBy: string;
  createdAt: number;
  operationKey: string;
  requestFingerprint: string;
  sealed: number;
  financialSnapshot: string;
  reservationSnapshot: string;
};
type Item = {
  id: string;
  productId: string;
  variantId: string;
  quantity: number;
  inventoryReservedQuantity: number;
};

/** Internal, default off. No routes, external effects, refunds, promo release or order UPDATE. */
export class LinkedCheckoutCancellations {
  constructor(
    private readonly owner: VoyeyOwnerAuthority,
    private readonly enabled = false,
  ) {}

  async cancel(
    authorization: string | undefined,
    orderId: string,
    key: string,
    value: unknown,
  ) {
    if (!this.enabled)
      throw new HttpError(503, "Linked cancellation is internal and disabled");
    const parsed = requestSchema.safeParse(value),
      parsedKey = idempotencyKeySchema.safeParse(key);
    if (!parsed.success || !parsedKey.success)
      throw new HttpError(400, "Invalid cancellation request");
    key = parsedKey.data;
    const reason = parsed.data.reason;
    const fp = createHash("sha256")
      .update(
        JSON.stringify({ operation: "UNPAID_CANCEL_V1", orderId, reason }),
      )
      .digest("hex");
    const result = await atomic(async (b) => {
      const authority = await this.owner.inspect(
        b,
        await this.owner.identify(authorization),
        "ORDER_CANCEL",
      );
      if (authority.reason !== "AUTHORIZED")
        return { denied: authority, cancellation: null };
      const actor = authority.userId!;
      const state = await readOrderFinance(orderId);
      const previous = await database()
        .prepare("SELECT * FROM CheckoutCancellation WHERE orderId=?")
        .bind(orderId)
        .first<CancellationRow>();
      if (previous) {
        if (
          previous.sealed !== 1 ||
          previous.operationKey !== key ||
          previous.requestFingerprint !== fp ||
          previous.createdBy !== actor
        )
          throw new HttpError(
            409,
            "Cancellation already exists; incompatible replay",
          );
        return { denied: null, cancellation: previous };
      }
      if (
        await database()
          .prepare(
            "SELECT id FROM CheckoutCancellation WHERE createdBy=? AND operationKey=?",
          )
          .bind(actor, key)
          .first()
      )
        throw new HttpError(409, "Cancellation key belongs to another order");
      if (
        state.goodsPaid !== 0 ||
        state.cargoPaid !== 0 ||
        (await database()
          .prepare(
            "SELECT id FROM CheckoutPaymentLedger WHERE orderId=? UNION ALL SELECT id FROM CheckoutPayment WHERE orderId=? AND status='APPROVED' LIMIT 1",
          )
          .bind(orderId, orderId)
          .first())
      )
        throw new HttpError(
          409,
          "Confirmed money requires the future refund process; cancellation denied",
        );
      if (
        await database()
          .prepare(
            "SELECT id FROM CheckoutPayment WHERE orderId=? AND status='SUBMITTED'",
          )
          .bind(orderId)
          .first()
      )
        throw new HttpError(409, "Receipt pending review; cancellation denied");
      // Refund only belongs to legacy Order. A new final invoice is a conflicting financial action.
      if (
        state.finalInvoiceId ||
        (await database()
          .prepare("SELECT id FROM Refund WHERE orderId=?")
          .bind(orderId)
          .first())
      )
        throw new HttpError(
          409,
          "Conflicting financial action; cancellation denied",
        );
      const items = (
        await database()
          .prepare(
            "SELECT id,productId,variantId,quantity,inventoryReservedQuantity FROM CheckoutOrderItem WHERE orderId=? ORDER BY id",
          )
          .bind(orderId)
          .all<Item>()
      ).results;
      if (!items.length) throw new HttpError(409, "Invalid linked order items");
      for (const item of items) {
        if (state.saleMode === "PREORDER") {
          if (item.inventoryReservedQuantity !== 0)
            throw new HttpError(409, "Invalid preorder reservation");
          continue;
        }
        const sku = await database()
          .prepare(
            "SELECT stock FROM ProductVariant WHERE id=? AND productId=? AND isActive=1",
          )
          .bind(item.variantId, item.productId)
          .first<{ stock: number | null }>();
        if (
          item.inventoryReservedQuantity !== item.quantity ||
          !sku ||
          sku.stock === null ||
          !Number.isInteger(sku.stock) ||
          sku.stock < 0 ||
          sku.stock + item.inventoryReservedQuantity > 2147483647
        )
          throw new HttpError(
            409,
            "Reservation cannot be safely released; manual investigation required",
          );
      }
      const id = randomUUID(),
        now = Date.now();
      const row: CancellationRow = {
        id,
        orderId,
        reason,
        createdBy: actor,
        createdAt: now,
        operationKey: key,
        requestFingerprint: fp,
        sealed: 1,
        financialSnapshot: JSON.stringify(state),
        reservationSnapshot: JSON.stringify(items),
      };
      b.sql(
        "INSERT INTO CheckoutCancellation(id,orderId,reason,createdBy,createdAt,operationKey,requestFingerprint,financialSnapshot,reservationSnapshot) VALUES(?,?,?,?,?,?,?,?,?)",
        id,
        orderId,
        reason,
        actor,
        now,
        key,
        fp,
        state,
        items,
      );
      for (const item of items)
        if (item.inventoryReservedQuantity > 0) {
          // SQL validates the saved reservation and current SKU, applies the increment and writes audit.
          b.sql(
            "INSERT INTO CheckoutStockRelease(id,cancellationId,orderId,itemId,variantId,quantity,stockBefore,stockAfter,createdAt) SELECT ?,?,?,?,?,?,stock,stock+?,? FROM ProductVariant WHERE id=?",
            randomUUID(),
            id,
            orderId,
            item.id,
            item.variantId,
            item.inventoryReservedQuantity,
            item.inventoryReservedQuantity,
            now,
            item.variantId,
          );
        }
      b.insert("AuditLog", {
        actorId: actor,
        action: "linked-order.cancelled",
        entityType: "CheckoutCancellation",
        entityId: id,
        metadata: {
          orderId,
          releasedQuantity: items.reduce(
            (sum, i) => sum + i.inventoryReservedQuantity,
            0,
          ),
        },
      });
      b.sql("UPDATE CheckoutCancellation SET sealed=1 WHERE id=?", id);
      return { denied: null, cancellation: row };
    });
    if (result.denied) this.owner.require(result.denied);
    const c = result.cancellation!;
    return {
      ...c,
      financialSnapshot: JSON.parse(c.financialSnapshot) as Awaited<
        ReturnType<typeof readOrderFinance>
      >,
      reservationSnapshot: JSON.parse(c.reservationSnapshot) as Item[],
    };
  }
}
