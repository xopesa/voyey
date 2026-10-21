import { atomic, database, prisma } from "@stenzo/database";
import { z } from "zod";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { AdminOrderFinance } from "@stenzo/shared";
import { HttpError } from "../../auth/errors.js";
import { adminAuditActor } from "../audit-actor.js";
import { adminPrincipalHash } from "../../../d1/principal.js";

export function financePrincipal(actor: string) {
  const a = adminAuditActor(actor);
  return a.actorId
    ? `telegram-admin:${a.actorId}`
    : `web-admin:${adminPrincipalHash() ?? a.metadata.adminPrincipal}`;
}
export function safeMoney(n: number) {
  if (!Number.isSafeInteger(n))
    throw new HttpError(503, "Finance amount exceeds exact integer range");
  return n;
}
export function profitSummary(
  goodsSubtotal: number,
  discountAmount: number,
  goodsRevenue: number,
  customerCargo: number,
  procurementCost: number,
  linkedExpenses: number,
  missingCosts: number,
  itemCount: number,
) {
  const revenue = safeMoney(goodsRevenue + customerCargo),
    directCost = safeMoney(procurementCost + linkedExpenses),
    costComplete = itemCount > 0 && missingCosts === 0;
  const profit = costComplete ? safeMoney(revenue - directCost) : null;
  return {
    goodsSubtotal,
    discountAmount,
    goodsRevenue,
    customerCargo,
    revenue,
    procurementCost: safeMoney(procurementCost),
    linkedExpenses: safeMoney(linkedExpenses),
    directCost,
    costComplete,
    missingCosts,
    profit,
    marginPercent:
      profit !== null && revenue > 0 ? (profit / revenue) * 100 : null,
  };
}
export class ProcurementService {
  async order(publicId: string): Promise<AdminOrderFinance> {
    const order = await prisma.order.findUnique({
      where: { publicId },
      include: { items: true, payments: true },
    });
    if (!order) throw new HttpError(404, "notFound");
    const expense = await database()
      .prepare(
        "SELECT COALESCE(SUM(amount),0) amount FROM Expense WHERE orderId=? AND voidedAt IS NULL",
      )
      .bind(order.id)
      .first<{ amount: number }>();
    const cost = order.items.reduce(
        (s, i) => s + (i.procurementUnitCost ?? 0) * i.quantity,
        0,
      ),
      missing = order.items.filter(
        (i) => i.procurementUnitCost === null,
      ).length;
    const received = safeMoney(
      order.payments
        .filter((p) => p.status === "APPROVED")
        .reduce((s, p) => s + p.expectedAmount, 0),
    );
    return {
      ...profitSummary(
        order.itemsSubtotal ?? order.subtotal,
        order.discountAmount,
        order.total,
        order.cargoAmount ?? 0,
        cost,
        expense!.amount,
        missing,
        order.items.length,
      ),
      publicId,
      completedAt: order.completedAt?.toISOString() ?? null,
      received,
      outstanding: Math.max(
        0,
        safeMoney(order.total + (order.cargoAmount ?? 0) - received),
      ),
      items: order.items.map((i) => ({
        id: i.id,
        productNameRu: i.productNameRu,
        productNameUz: i.productNameUz,
        sku: i.sku,
        quantity: i.quantity,
        unitPrice: i.unitPrice,
        lineTotal: i.lineTotal,
        procurementUnitCost: i.procurementUnitCost,
        procurementUpdatedAt: i.procurementUpdatedAt?.toISOString() ?? null,
        procurementLineCost:
          i.procurementUnitCost === null
            ? null
            : safeMoney(i.procurementUnitCost * i.quantity),
        lineMargin:
          i.procurementUnitCost === null
            ? null
            : safeMoney(i.lineTotal - i.procurementUnitCost * i.quantity),
      })),
    };
  }
  async update(
    publicId: string,
    itemId: string,
    actorId: string,
    value: unknown,
  ) {
    const parsed = z
      .object({
        procurementUnitCost: z
          .number()
          .int()
          .positive()
          .max(2147483647)
          .nullable(),
      })
      .strict()
      .safeParse(value);
    if (!parsed.success) throw new HttpError(400, "financeInvalidCost");
    await atomic(async (batch) => {
      const item = await prisma.orderItem.findUnique({
        where: { id: itemId },
        include: { order: true },
      });
      if (!item || item.order.publicId !== publicId)
        throw new HttpError(404, "notFound");
      const cost = parsed.data.procurementUnitCost;
      if (item.procurementUnitCost === cost) return;
      batch.update("OrderItem", item.id, {
        procurementUnitCost: cost,
        procurementUpdatedAt: new Date(),
        procurementUpdatedBy: financePrincipal(actorId),
      });
      const actor = adminAuditActor(actorId);
      batch.insert("AuditLog", {
        actorId: actor.actorId,
        action: "order_item.procurement_cost_updated",
        entityType: "OrderItem",
        entityId: item.id,
        metadata: {
          ...actor.metadata,
          orderId: item.orderId,
          orderItemId: item.id,
          previousCost: item.procurementUnitCost,
          newCost: cost,
        },
      });
    });
    return this.order(publicId);
  }
}
export function registerProcurement(
  app: FastifyInstance,
  guard: (r: FastifyRequest) => Promise<void>,
) {
  const service = new ProcurementService();
  app.get<{ Params: { publicId: string } }>(
    "/admin/orders/:publicId/finance",
    { preHandler: guard },
    (r) => service.order(r.params.publicId),
  );
  app.patch<{ Params: { publicId: string; itemId: string } }>(
    "/admin/orders/:publicId/items/:itemId/procurement-cost",
    { preHandler: guard },
    (r) =>
      service.update(
        r.params.publicId,
        r.params.itemId,
        r.webAdminActor ?? r.currentUser!.id,
        r.body,
      ),
  );
}
