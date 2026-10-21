import { atomic, prisma } from "@stenzo/database";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { HttpError } from "../auth/errors.js";
import { adminAuditActor } from "./audit-actor.js";

// A calendar date, not an instant: it must not shift with the viewer's timezone.
const schema = z
  .object({ estimatedWarehouseArrival: z.string().date().nullable() })
  .strict();
const editable = ["AWAITING_PURCHASE", "PURCHASED", "IN_TRANSIT"];
export class WarehouseEstimateService {
  async set(publicId: string, actor: string, value: unknown) {
    const parsed = schema.safeParse(value);
    if (!parsed.success) throw new HttpError(400, "invalid");
    const next = parsed.data.estimatedWarehouseArrival;
    return atomic(async (batch) => {
      const order = await prisma.order.findUnique({ where: { publicId } });
      if (!order) throw new HttpError(404, "notFound");
      if (!editable.includes(order.status))
        throw new HttpError(409, "orderConflict");
      if (order.estimatedWarehouseArrival === next)
        return { estimatedWarehouseArrival: next };
      batch.update("Order", order.id, { estimatedWarehouseArrival: next });
      const principal = adminAuditActor(actor);
      batch.insert("AuditLog", {
        actorId: principal.actorId,
        action: "order.warehouse_estimate_updated",
        entityType: "Order",
        entityId: order.id,
        metadata: {
          ...principal.metadata,
          previous: order.estimatedWarehouseArrival,
          estimatedWarehouseArrival: next,
        },
      });
      return { estimatedWarehouseArrival: next };
    });
  }
}
export function registerWarehouseEstimate(
  app: FastifyInstance,
  guard: (request: FastifyRequest) => Promise<void>,
) {
  const service = new WarehouseEstimateService();
  app.patch<{ Params: { publicId: string } }>(
    "/admin/orders/:publicId/warehouse-estimate",
    { preHandler: guard },
    async (request) => {
      const id = z
        .string()
        .regex(/^[A-Za-z0-9_-]{1,100}$/)
        .safeParse(request.params.publicId);
      if (!id.success) throw new HttpError(400, "invalid");
      const actor = request.webAdminActor ?? request.currentUser?.id;
      if (!actor) throw new HttpError(401, "Admin session required");
      return service.set(id.data, actor, request.body);
    },
  );
}
