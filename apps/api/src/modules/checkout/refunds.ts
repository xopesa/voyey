import { createHash, randomUUID } from "node:crypto";
import { atomic, database, type Batch } from "@stenzo/database";
import { z } from "zod";
import { VoyeyOwnerAuthority } from "../admin/owner.js";
import { HttpError } from "../auth/errors.js";
import { idempotencyKeySchema } from "../orders/schemas.js";
import { assertCheckoutOpen, readOrderFinance } from "./payment-state.js";

const amount = z.number().int().min(1).max(2147483647);
const requestSchema = z
  .object({ reason: z.string().trim().min(1).max(500) })
  .strict();
const confirmSchema = z
  .object({
    confirmedAmount: amount,
    bankTransferVerified: z.literal(true),
    bankOperationReference: z
      .string()
      .trim()
      .min(8)
      .max(128)
      .regex(/^[A-Za-z0-9 .:_-]+$/),
  })
  .strict();
function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const p = schema.safeParse(value);
  if (!p.success) throw new HttpError(400, "Invalid linked refund request");
  return p.data;
}
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
const fingerprint = (v: unknown) => hash(JSON.stringify(v));
type Action =
  | "REFUND_REQUEST"
  | "REFUND_CONFIRM"
  | "REFUND_READ"
  | "REFUND_STOCK_RECONCILE";
type RequestRow = {
  id: string;
  orderId: string;
  reason: string;
  createdBy: string;
  createdAt: number;
  operationKey: string;
  requestFingerprint: string;
  goodsAmount: number;
  cargoAmount: number;
  totalAmount: number;
  financialSnapshot: string;
  sealed: number;
};
type LedgerRow = {
  id: string;
  refundId: string;
  orderId: string;
  goodsAmount: number;
  cargoAmount: number;
  totalAmount: number;
  confirmedBy: string;
  confirmedAt: number;
  operationKey: string;
  requestFingerprint: string;
  bankOperationDigest: string;
};
type Allocation = { id: string; goodsAmount: number; cargoAmount: number };
type Reconciliation = {
  id: string;
  createdBy: string;
  operationKey: string;
  requestFingerprint: string;
  sealed: number;
};

/** Internal/default-off. Records a MANUAL outgoing transfer; never calls a bank or Telegram.
 * Monetary completion commits before an independent, retryable inventory reconciliation. */
export class LinkedCheckoutRefunds {
  constructor(
    private readonly owner: VoyeyOwnerAuthority,
    private readonly enabled = false,
  ) {}
  private async run<T>(
    authorization: string | undefined,
    action: Action,
    fn: (b: Batch, actor: string) => Promise<T>,
  ) {
    if (!this.enabled)
      throw new HttpError(503, "Linked refunds are internal and disabled");
    const outcome = await atomic(async (b) => {
      const a = await this.owner.inspect(
        b,
        await this.owner.identify(authorization),
        action,
      );
      if (a.reason !== "AUTHORIZED") return { denied: a, value: null };
      return { denied: null, value: await fn(b, a.userId!) };
    });
    if (outcome.denied) this.owner.require(outcome.denied);
    return outcome.value!;
  }
  private audit(
    b: Batch,
    actor: string,
    action: string,
    id: string,
    orderId: string,
    metadata: Record<string, unknown> = {},
  ) {
    b.insert("AuditLog", {
      actorId: actor,
      action,
      entityType: "CheckoutRefund",
      entityId: id,
      metadata: { orderId, ...metadata },
    });
  }
  private async get(id: string) {
    const r = await database()
      .prepare("SELECT * FROM CheckoutRefund WHERE id=? AND sealed=1")
      .bind(id)
      .first<RequestRow>();
    if (!r) throw new HttpError(404, "Linked refund not found");
    return r;
  }
  private async snapshot(id: string) {
    return atomic(async () => {
      const r = await this.get(id),
        completion = await database()
          .prepare("SELECT * FROM CheckoutRefundLedger WHERE refundId=?")
          .bind(id)
          .first<LedgerRow>();
      const allocations = (
        await database()
          .prepare(
            "SELECT paymentLedgerId,goodsAmount,cargoAmount FROM CheckoutRefundAllocation WHERE refundId=? ORDER BY paymentLedgerId",
          )
          .bind(id)
          .all<{
            paymentLedgerId: string;
            goodsAmount: number;
            cargoAmount: number;
          }>()
      ).results;
      return {
        refund: {
          id: r.id,
          orderId: r.orderId,
          reason: r.reason,
          createdBy: r.createdBy,
          createdAt: r.createdAt,
          operationKey: r.operationKey,
          goodsAmount: r.goodsAmount,
          cargoAmount: r.cargoAmount,
          totalAmount: r.totalAmount,
          status: completion ? ("COMPLETED" as const) : ("REQUESTED" as const),
          financialSnapshot: JSON.parse(r.financialSnapshot) as Awaited<
            ReturnType<typeof readOrderFinance>
          >,
        },
        allocations,
        completion: completion
          ? {
              id: completion.id,
              confirmedBy: completion.confirmedBy,
              confirmedAt: completion.confirmedAt,
              goodsAmount: completion.goodsAmount,
              cargoAmount: completion.cargoAmount,
              totalAmount: completion.totalAmount,
            }
          : null,
        finance: await readOrderFinance(r.orderId),
      };
    });
  }
  async state(authorization: string | undefined, id: string) {
    await this.run(authorization, "REFUND_READ", async () => {
      await this.get(id);
    });
    return this.snapshot(id);
  }
  async request(
    authorization: string | undefined,
    orderId: string,
    key: string,
    value: unknown,
  ) {
    key = parse(idempotencyKeySchema, key);
    const data = parse(requestSchema, value),
      fp = fingerprint({
        operation: "FULL_REFUND_REQUEST_V1",
        orderId,
        reason: data.reason,
      });
    const id = await this.run(
      authorization,
      "REFUND_REQUEST",
      async (b, actor) => {
        const state = await readOrderFinance(orderId),
          old = await database()
            .prepare("SELECT * FROM CheckoutRefund WHERE orderId=?")
            .bind(orderId)
            .first<RequestRow>();
        if (old) {
          if (
            old.sealed !== 1 ||
            old.createdBy !== actor ||
            old.operationKey !== key ||
            old.requestFingerprint !== fp
          )
            throw new HttpError(409, "Incompatible refund request replay");
          return old.id;
        }
        assertCheckoutOpen(state);
        if (state.fulfillmentAllowed !== 0 || state.cancellationId)
          throw new HttpError(
            409,
            "Refund after fulfillment or cancellation is not supported",
          );
        if (
          await database()
            .prepare(
              "SELECT id FROM CheckoutPayment WHERE orderId=? AND status='SUBMITTED'",
            )
            .bind(orderId)
            .first()
        )
          throw new HttpError(
            409,
            "Receipt pending review; resolve it before refund",
          );
        if (
          await database()
            .prepare(
              "SELECT id FROM CheckoutRefund WHERE createdBy=? AND operationKey=?",
            )
            .bind(actor, key)
            .first()
        )
          throw new HttpError(409, "Refund request key already used");
        const allocations = (
          await database()
            .prepare(
              "SELECT id,goodsAmount,cargoAmount FROM CheckoutPaymentLedger WHERE orderId=? ORDER BY id",
            )
            .bind(orderId)
            .all<Allocation>()
        ).results;
        const goods = allocations.reduce((s, a) => s + a.goodsAmount, 0),
          cargo = allocations.reduce((s, a) => s + a.cargoAmount, 0),
          total = goods + cargo;
        if (
          !allocations.length ||
          !Number.isSafeInteger(total) ||
          total <= 0 ||
          total > 2147483647 ||
          goods !== state.goodsPaid ||
          cargo !== state.cargoPaid
        )
          throw new HttpError(
            409,
            "No valid confirmed money available for full refund",
          );
        const id = randomUUID(),
          now = Date.now();
        b.sql(
          "INSERT INTO CheckoutRefund(id,orderId,reason,createdBy,createdAt,operationKey,requestFingerprint,goodsAmount,cargoAmount,totalAmount,financialSnapshot) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
          id,
          orderId,
          data.reason,
          actor,
          now,
          key,
          fp,
          goods,
          cargo,
          total,
          state,
        );
        for (const a of allocations)
          b.sql(
            "INSERT INTO CheckoutRefundAllocation(id,refundId,orderId,paymentLedgerId,goodsAmount,cargoAmount) VALUES(?,?,?,?,?,?)",
            randomUUID(),
            id,
            orderId,
            a.id,
            a.goodsAmount,
            a.cargoAmount,
          );
        this.audit(b, actor, "linked-refund.requested", id, orderId, {
          goodsAmount: goods,
          cargoAmount: cargo,
          totalAmount: total,
        });
        b.sql("UPDATE CheckoutRefund SET sealed=1 WHERE id=?", id);
        return id;
      },
    );
    return this.snapshot(id);
  }
  async confirm(
    authorization: string | undefined,
    id: string,
    key: string,
    value: unknown,
  ) {
    key = parse(idempotencyKeySchema, key);
    const data = parse(confirmSchema, value);
    const canonical = data.bankOperationReference
      .replace(/[ .:_-]/g, "")
      .toUpperCase();
    if (canonical.length < 8)
      throw new HttpError(400, "Invalid outgoing bank operation reference");
    const digest = hash("VOYEY_BANK_REFUND_V1:" + canonical),
      fp = fingerprint({
        operation: "FULL_REFUND_CONFIRM_V1",
        refundId: id,
        confirmedAmount: data.confirmedAmount,
        bankOperationDigest: digest,
        bankTransferVerified: true,
      });
    await this.run(authorization, "REFUND_CONFIRM", async (b, actor) => {
      const r = await this.get(id),
        old = await database()
          .prepare("SELECT * FROM CheckoutRefundLedger WHERE refundId=?")
          .bind(id)
          .first<LedgerRow>();
      if (old) {
        if (
          old.confirmedBy !== actor ||
          old.operationKey !== key ||
          old.requestFingerprint !== fp
        )
          throw new HttpError(409, "Incompatible refund confirmation replay");
        return;
      }
      if (data.confirmedAmount !== r.totalAmount)
        throw new HttpError(
          409,
          "Confirm exactly the full received refund amount",
        );
      if (
        await database()
          .prepare(
            "SELECT id FROM CheckoutRefundLedger WHERE bankOperationDigest=? OR (confirmedBy=? AND operationKey=?)",
          )
          .bind(digest, actor, key)
          .first()
      )
        throw new HttpError(
          409,
          "Outgoing transfer or confirmation key already recorded",
        );
      // SQL derives completion audit and protects full allocations. No stock writes in this batch.
      b.sql(
        "INSERT INTO CheckoutRefundLedger(id,refundId,orderId,goodsAmount,cargoAmount,totalAmount,currency,confirmedBy,confirmedAt,bankOperationDigest,operationKey,requestFingerprint,bankTransferVerified) VALUES(?,?,?,?,?,?,'UZS',?,?,?,?,?,1)",
        randomUUID(),
        id,
        r.orderId,
        r.goodsAmount,
        r.cargoAmount,
        r.totalAmount,
        actor,
        Math.max(Date.now(), r.createdAt),
        digest,
        key,
        fp,
      );
    });
    // A bank transfer already happened externally. Inventory failure MUST NOT erase completion
    // or be reported as a failed monetary action. Retrying this method never calls the bank.
    try {
      await this.reconcileStock(authorization, id, "refund-stock:" + id);
    } catch {
      /* projection stays REQUIRES_RECONCILIATION; explicit owner retry available */
    }
    return this.snapshot(id);
  }
  async reconcileStock(
    authorization: string | undefined,
    id: string,
    key: string,
  ) {
    key = parse(idempotencyKeySchema, key);
    const fp = fingerprint({
      operation: "REFUND_STOCK_RELEASE_V1",
      refundId: id,
    });
    await this.run(
      authorization,
      "REFUND_STOCK_RECONCILE",
      async (b, actor) => {
        const r = await this.get(id),
          state = await readOrderFinance(r.orderId);
        const completed = await database()
          .prepare(
            "SELECT id,confirmedAt FROM CheckoutRefundLedger WHERE refundId=?",
          )
          .bind(id)
          .first<{ id: string; confirmedAt: number }>();
        if (!completed)
          throw new HttpError(
            409,
            "Stock reconciliation requires completed refund",
          );
        if (state.saleMode === "PREORDER") return;
        const old = await database()
          .prepare(
            "SELECT * FROM CheckoutRefundStockReconciliation WHERE refundId=?",
          )
          .bind(id)
          .first<Reconciliation>();
        if (old) {
          if (
            old.sealed !== 1 ||
            old.operationKey !== key ||
            old.requestFingerprint !== fp
          )
            throw new HttpError(
              409,
              "Incompatible stock reconciliation replay",
            );
          return;
        }
        if (
          await database()
            .prepare(
              "SELECT id FROM CheckoutRefundStockReconciliation WHERE createdBy=? AND operationKey=?",
            )
            .bind(actor, key)
            .first()
        )
          throw new HttpError(409, "Reconciliation key already used");
        const items = (
          await database()
            .prepare(
              "SELECT i.id,i.variantId,i.quantity,i.inventoryReservedQuantity,v.stock,v.isActive,v.productId skuProductId,i.productId FROM CheckoutOrderItem i LEFT JOIN ProductVariant v ON v.id=i.variantId WHERE i.orderId=? ORDER BY i.id",
            )
            .bind(r.orderId)
            .all<{
              id: string;
              variantId: string;
              quantity: number;
              inventoryReservedQuantity: number;
              stock: number | null;
              isActive: number;
              skuProductId: string | null;
              productId: string;
            }>()
        ).results;
        if (
          !items.length ||
          items.some(
            (i) =>
              i.inventoryReservedQuantity !== i.quantity ||
              i.skuProductId !== i.productId ||
              i.isActive !== 1 ||
              i.stock === null ||
              !Number.isInteger(i.stock) ||
              i.stock < 0 ||
              i.stock + i.inventoryReservedQuantity > 2147483647,
          )
        ) {
          this.audit(
            b,
            actor,
            "linked-refund.stock-reconciliation-required",
            id,
            r.orderId,
            { reason: "UNSAFE_SKU_OR_STOCK" },
          );
          return;
        }
        const reconciliationId = randomUUID(),
          now = Math.max(Date.now(), completed.confirmedAt);
        b.sql(
          "INSERT INTO CheckoutRefundStockReconciliation(id,refundId,orderId,refundLedgerId,createdBy,createdAt,operationKey,requestFingerprint) VALUES(?,?,?,?,?,?,?,?)",
          reconciliationId,
          id,
          r.orderId,
          completed.id,
          actor,
          now,
          key,
          fp,
        );
        for (const item of items)
          b.sql(
            "INSERT INTO CheckoutRefundStockRelease(id,reconciliationId,refundId,orderId,itemId,variantId,quantity,stockBefore,stockAfter,createdAt) SELECT ?,?,?,?,?,?,?,stock,stock+?,? FROM ProductVariant WHERE id=?",
            randomUUID(),
            reconciliationId,
            id,
            r.orderId,
            item.id,
            item.variantId,
            item.inventoryReservedQuantity,
            item.inventoryReservedQuantity,
            now,
            item.variantId,
          );
        this.audit(b, actor, "linked-refund.stock-reconciled", id, r.orderId, {
          reconciliationId,
        });
        b.sql(
          "UPDATE CheckoutRefundStockReconciliation SET sealed=1 WHERE id=?",
          reconciliationId,
        );
      },
    );
    return this.snapshot(id);
  }
}
