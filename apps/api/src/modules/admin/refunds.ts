import { atomic, database, prisma } from "@stenzo/database";
import { z } from "zod";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { RefundPage, AdminRefund } from "@stenzo/shared";
import { HttpError } from "../auth/errors.js";
import { lifecycleAudit, refundDto } from "./lifecycle.js";
import { financePrincipal } from "./finance/procurement.js";
import { decodeCustomerCursor } from "./customers.js";
import type { NotificationService } from "../notifications/service.js";
import { D1OrderRepository } from "../../d1/repositories.js";
export class RefundService {
  constructor(private readonly notifications?: NotificationService) {}
  async list(value: unknown): Promise<RefundPage> {
    const parsed = z
      .object({
        status: z.enum(["PENDING", "COMPLETED", "all"]).default("all"),
        limit: z.coerce.number().int().min(1).max(50).default(20),
        cursor: z.string().max(512).optional(),
      })
      .strict()
      .safeParse(value);
    if (!parsed.success) throw new HttpError(400, "invalid");
    const q = parsed.data,
      where = ["1=1"],
      values: unknown[] = [];
    if (q.status !== "all") {
      where.push("r.status=?");
      values.push(q.status);
    }
    const c = decodeCustomerCursor(q.cursor);
    if (c) {
      where.push("(r.createdAt<? OR (r.createdAt=? AND r.id<?))");
      values.push(c.time, c.time, c.id);
    }
    const rows = (
        await database()
          .prepare(
            'SELECT r.id,r.amount,r.status,r.createdAt,r.completedAt,r.reference,r.note,o.publicId orderPublicId,o.fullName customer FROM Refund r JOIN "Order" o ON o.id=r.orderId WHERE ' +
              where.join(" AND ") +
              " ORDER BY r.createdAt DESC,r.id DESC LIMIT ?",
          )
          .bind(...values, q.limit + 1)
          .all<
            Omit<AdminRefund, "createdAt" | "completedAt"> & {
              createdAt: number;
              completedAt: number | null;
            }
          >()
      ).results,
      visible = rows.slice(0, q.limit),
      last = visible.at(-1);
    return {
      refunds: visible.map((r) => ({
        ...r,
        createdAt: new Date(r.createdAt).toISOString(),
        completedAt:
          r.completedAt === null ? null : new Date(r.completedAt).toISOString(),
      })),
      nextCursor:
        rows.length > q.limit && last
          ? Buffer.from(
              JSON.stringify({ time: last.createdAt, id: last.id }),
            ).toString("base64url")
          : null,
    };
  }
  async complete(id: string, actor: string, value: unknown) {
    const p = z
      .object({
        reference: z.string().trim().max(200).nullable().default(null),
        note: z.string().trim().max(500).nullable().default(null),
      })
      .strict()
      .safeParse(value);
    if (!p.success) throw new HttpError(400, "lifecycleInvalid");
    await atomic(async (b) => {
      const r = await prisma.refund.findUnique({
        where: { id },
        include: { order: true },
      });
      if (!r) throw new HttpError(404, "notFound");
      if (r.order.status !== "CANCELLED")
        throw new HttpError(409, "lifecycleNotCancelled");
      if (r.status === "COMPLETED") return;
      b.update("Refund", id, {
        status: "COMPLETED",
        reference: p.data.reference || null,
        note: p.data.note || null,
        completedAt: new Date(),
        completedBy: financePrincipal(actor),
      });
      lifecycleAudit(b, actor, "refund.completed", "Refund", id, {
        orderId: r.orderId,
        amount: r.amount,
      });
    });
    const r = await prisma.refund.findUniqueOrThrow({
      where: { id },
      include: { order: true },
    });
    try {
      const o = await new D1OrderRepository().getForAdmin(r.order.publicId);
      if (o && this.notifications)
        await this.notifications.refundCompleted(o, r);
    } catch {
      /* Never roll back committed manual refund acknowledgement. */
    }
    return refundDto(r, r.order);
  }
}
export function registerRefunds(
  app: FastifyInstance,
  guard: (r: FastifyRequest) => Promise<void>,
  notifications?: NotificationService,
) {
  const s = new RefundService(notifications);
  app.get("/admin/finance/refunds", { preHandler: guard }, (r) =>
    s.list(r.query),
  );
  app.post<{ Params: { id: string } }>(
    "/admin/finance/refunds/:id/complete",
    { preHandler: guard },
    (r) =>
      s.complete(r.params.id, r.webAdminActor ?? r.currentUser!.id, r.body),
  );
}
