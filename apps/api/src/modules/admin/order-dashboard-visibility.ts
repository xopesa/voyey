import { atomic, prisma } from "@stenzo/database";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { HttpError } from "../auth/errors.js";
import { adminAuditActor } from "./audit-actor.js";

const schema = z.object({ hidden: z.boolean() }).strict();
const paramsSchema = z
  .object({ publicId: z.string().trim().min(1).max(100) })
  .strict();
export class OrderDashboardVisibilityService {
  async set(publicId: string, actor: string, value: unknown) {
    const parsed = schema.safeParse(value);
    if (!parsed.success) throw new HttpError(400, "invalid");
    const hidden = parsed.data.hidden;
    const dashboardHiddenAt = await atomic(async (batch) => {
      const order = await prisma.order.findUnique({ where: { publicId } });
      if (!order) throw new HttpError(404, "notFound");
      if (order.status !== "COMPLETED")
        throw new HttpError(409, "dashboardCompletedOnly");
      if ((order.dashboardHiddenAt !== null) === hidden)
        return order.dashboardHiddenAt;
      const next = hidden ? new Date() : null;
      batch.update("Order", order.id, { dashboardHiddenAt: next });
      const principal = adminAuditActor(actor);
      batch.insert("AuditLog", {
        actorId: principal.actorId,
        action: hidden ? "order.dashboard_hidden" : "order.dashboard_restored",
        entityType: "Order",
        entityId: order.id,
        metadata: { ...principal.metadata, hidden },
      });
      return next;
    });
    return { dashboardHiddenAt };
  }
}
export function registerOrderDashboardVisibility(
  app: FastifyInstance,
  guard: (request: FastifyRequest) => Promise<void>,
) {
  const service = new OrderDashboardVisibilityService();
  app.post<{ Params: { publicId: string } }>(
    "/admin/orders/:publicId/dashboard-visibility",
    { preHandler: guard },
    async (request) => {
      const parsed = paramsSchema.safeParse(request.params);
      if (!parsed.success) throw new HttpError(400, "invalid");
      const actor = request.webAdminActor ?? request.currentUser?.id;
      if (!actor) throw new HttpError(401, "Admin session required");
      return service.set(parsed.data.publicId, actor, request.body);
    },
  );
}
