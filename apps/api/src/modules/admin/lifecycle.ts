import { atomic, prisma, type Batch } from "@stenzo/database";
import {
  cancellableStatuses,
  cancellationReasons,
  type OrderLifecycle,
  type AdminRefund,
} from "@stenzo/shared";
import { z } from "zod";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { HttpError } from "../auth/errors.js";
import { adminAuditActor } from "./audit-actor.js";
import { financePrincipal, safeMoney } from "./finance/procurement.js";
import { D1OrderRepository } from "../../d1/repositories.js";
import type { NotificationService } from "../notifications/service.js";
export function lifecycleAudit(
  b: Batch,
  actorId: string,
  action: string,
  entityType: string,
  entityId: string,
  metadata: Record<string, unknown> = {},
) {
  const a = adminAuditActor(actorId);
  b.insert("AuditLog", {
    actorId: a.actorId,
    action,
    entityType,
    entityId,
    metadata: { ...a.metadata, ...metadata },
  });
}
export function refundDto(
  r: {
    id: string;
    amount: number;
    status: "PENDING" | "COMPLETED";
    createdAt: Date;
    completedAt: Date | null;
    reference: string | null;
    note: string | null;
  },
  order: { publicId: string; fullName: string },
): AdminRefund {
  return {
    id: r.id,
    amount: r.amount,
    status: r.status,
    createdAt: r.createdAt.toISOString(),
    completedAt: r.completedAt?.toISOString() ?? null,
    reference: r.reference,
    note: r.note,
    orderPublicId: order.publicId,
    customer: order.fullName,
  };
}
export class LifecycleService {
  constructor(private readonly notifications?: NotificationService) {}
  async state(publicId: string): Promise<OrderLifecycle> {
    const o = await prisma.order.findUnique({
      where: { publicId },
      include: { payments: true, refund: true },
    });
    if (!o) throw new HttpError(404, "notFound");
    const hasSubmitted = o.payments.some((p) => p.status === "SUBMITTED");
    return {
      status: o.status,
      canCancel:
        !hasSubmitted &&
        (cancellableStatuses as readonly string[]).includes(o.status),
      hasSubmitted,
      approvedCash: safeMoney(
        o.payments
          .filter((p) => p.status === "APPROVED")
          .reduce((s, p) => s + p.expectedAmount, 0),
      ),
      reason: o.cancellationReason,
      note: o.cancellationNote,
      cancelledAt: o.cancelledAt?.toISOString() ?? null,
      stockReleaseStatus: o.stockReleaseStatus,
      stockReleasedAt: o.stockReleasedAt?.toISOString() ?? null,
      refund: o.refund ? refundDto(o.refund, o) : null,
    };
  }
  async cancel(publicId: string, actor: string, value: unknown) {
    const parsed = z
      .object({
        reason: z.enum(cancellationReasons),
        note: z.string().trim().max(500).nullable().default(null),
      })
      .strict()
      .safeParse(value);
    if (!parsed.success) throw new HttpError(400, "lifecycleInvalid");
    const changed = await atomic(async (b) => {
      const o = await prisma.order.findUnique({
        where: { publicId },
        include: {
          items: true,
          payments: true,
          refund: true,
          promoRedemption: true,
        },
      });
      if (!o) throw new HttpError(404, "notFound");
      if (o.status === "CANCELLED") return false;
      if (o.payments.some((p) => p.status === "SUBMITTED"))
        throw new HttpError(409, "lifecycleProofPending");
      if (!(cancellableStatuses as readonly string[]).includes(o.status))
        throw new HttpError(409, "lifecycleNotCancellable");
      const now = new Date(),
        amount = safeMoney(
          o.payments
            .filter((p) => p.status === "APPROVED")
            .reduce((s, p) => s + p.expectedAmount, 0),
        );
      if (amount > 2147483647)
        throw new HttpError(409, "lifecycleRefundAmountLimit");
      let review = false,
        released = 0;
      const reservations = new Map<string, number>();
      for (const i of o.items) {
        const reserved = i.inventoryReservedQuantity;
        if (reserved === null) {
          review = true;
          continue;
        }
        if (reserved === 0) continue;
        if (!i.variantId) {
          review = true;
          continue;
        }
        reservations.set(
          i.variantId,
          (reservations.get(i.variantId) ?? 0) + reserved,
        );
      }
      // One write per variant also preserves historical orders with repeated lines.
      for (const [variantId, reserved] of reservations) {
        const v = await prisma.productVariant.findUnique({
          where: { id: variantId },
        });
        if (!v) {
          review = true;
          continue;
        }
        if (v.stock === null) continue;
        if (v.stock + reserved > 2147483647) {
          review = true;
          continue;
        }
        b.update("ProductVariant", v.id, { stock: v.stock + reserved });
        released += reserved;
      }
      if (o.promoRedemption && !o.promoRedemption.releasedAt) {
        b.update("PromoCodeRedemption", o.promoRedemption.id, {
          releasedAt: now,
          releaseReason: "ORDER_CANCELLED",
        });
        lifecycleAudit(
          b,
          actor,
          "promo_code.redemption_released",
          "PromoCodeRedemption",
          o.promoRedemption.id,
          { orderId: o.id },
        );
      }
      if (amount > 0 && !o.refund) {
        const id = b.insert("Refund", {
          orderId: o.id,
          amount,
          createdBy: financePrincipal(actor),
        });
        lifecycleAudit(b, actor, "refund.created", "Refund", id, {
          orderId: o.id,
          amount,
        });
      }
      b.update("Order", o.id, {
        status: "CANCELLED",
        cancelledAt: now,
        cancelledBy: financePrincipal(actor),
        cancellationReason: parsed.data.reason,
        cancellationNote: parsed.data.note || null,
        stockReleaseStatus: review ? "REVIEW_REQUIRED" : "RELEASED",
        stockReleasedAt: review ? null : now,
      });
      lifecycleAudit(b, actor, "order.cancelled", "Order", o.id, {
        publicId,
        from: o.status,
        reason: parsed.data.reason,
        refundAmount: amount,
      });
      lifecycleAudit(b, actor, "order.stock_released", "Order", o.id, {
        releasedQuantity: released,
        reviewRequired: review,
      });
      return true;
    });
    try {
      const order = await new D1OrderRepository().getForAdmin(publicId);
      if (order && this.notifications)
        await this.notifications.orderStatusChanged(
          { order, status: "CANCELLED" },
          !changed,
        );
    } catch {
      /* Post-commit delivery cannot undo cancellation. */
    }
    return this.state(publicId);
  }
  async stockReviewed(publicId: string, actor: string) {
    await atomic(async (b) => {
      const o = await prisma.order.findUnique({ where: { publicId } });
      if (!o) throw new HttpError(404, "notFound");
      if (o.status !== "CANCELLED")
        throw new HttpError(409, "lifecycleNotCancelled");
      if (o.stockReleaseStatus === "RELEASED") return;
      if (o.stockReleaseStatus !== "REVIEW_REQUIRED")
        throw new HttpError(409, "lifecycleNotCancelled");
      b.update("Order", o.id, {
        stockReleaseStatus: "RELEASED",
        stockReleasedAt: new Date(),
      });
      lifecycleAudit(b, actor, "order.stock_release_reviewed", "Order", o.id, {
        publicId,
      });
    });
    return this.state(publicId);
  }
}
export function registerLifecycle(
  app: FastifyInstance,
  guard: (r: FastifyRequest) => Promise<void>,
  notifications?: NotificationService,
) {
  const s = new LifecycleService(notifications),
    actor = (r: FastifyRequest) => r.webAdminActor ?? r.currentUser!.id;
  app.get<{ Params: { publicId: string } }>(
    "/admin/orders/:publicId/lifecycle",
    { preHandler: guard },
    (r) => s.state(r.params.publicId),
  );
  app.post<{ Params: { publicId: string } }>(
    "/admin/orders/:publicId/cancel",
    { preHandler: guard },
    (r) => s.cancel(r.params.publicId, actor(r), r.body),
  );
  app.post<{ Params: { publicId: string } }>(
    "/admin/orders/:publicId/stock-reviewed",
    { preHandler: guard },
    (r) => s.stockReviewed(r.params.publicId, actor(r)),
  );
}
