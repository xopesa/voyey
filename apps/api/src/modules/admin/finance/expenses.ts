import { atomic, database, prisma } from "@stenzo/database";
import {
  expenseCategories,
  type AdminExpense,
  type ExpensePage,
} from "@stenzo/shared";
import { z } from "zod";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { HttpError } from "../../auth/errors.js";
import { adminAuditActor } from "../audit-actor.js";
import { decodeCustomerCursor } from "../customers.js";
import { financePrincipal } from "./procurement.js";
import { financePeriod, tashkentTimestamp } from "./period.js";

const expenseInput = z
  .object({
    category: z.enum(expenseCategories),
    amount: z.number().int().positive().max(2147483647),
    occurredAt: z.string(),
    description: z.string().trim().max(500).nullable().default(null),
    orderPublicId: z.string().trim().min(1).max(100).nullable().default(null),
  })
  .strict();
export const expenseQuery = z
  .object({
    category: z.enum(expenseCategories).optional(),
    state: z.enum(["active", "voided", "all"]).default("active"),
    order: z.string().trim().min(1).max(100).optional(),
    from: z.string().optional(),
    to: z.string().optional(),
    limit: z.coerce.number().int().min(1).max(50).default(20),
    cursor: z.string().max(512).optional(),
  })
  .strict();
type Row = {
  id: string;
  category: AdminExpense["category"];
  amount: number;
  occurredAt: number;
  description: string | null;
  orderPublicId: string | null;
  createdBy: string;
  createdAt: number;
  updatedAt: number;
  voidedAt: number | null;
};
const select =
  'SELECT e.*,o.publicId orderPublicId FROM Expense e LEFT JOIN "Order" o ON o.id=e.orderId';
const dto = (r: Row): AdminExpense => ({
  ...r,
  occurredAt: new Date(r.occurredAt).toISOString(),
  createdAt: new Date(r.createdAt).toISOString(),
  updatedAt: new Date(r.updatedAt).toISOString(),
  voidedAt: r.voidedAt === null ? null : new Date(r.voidedAt).toISOString(),
  createdBy: r.createdBy.startsWith("web-admin:")
    ? "web-admin"
    : "telegram-admin",
});
// Explicit DTO: never expose stored principal hashes or extra joined fields.
function expenseDto(r: Row): AdminExpense {
  const d = dto(r);
  return {
    id: d.id,
    category: d.category,
    amount: d.amount,
    occurredAt: d.occurredAt,
    description: d.description,
    orderPublicId: d.orderPublicId,
    createdBy: d.createdBy,
    createdAt: d.createdAt,
    updatedAt: d.updatedAt,
    voidedAt: d.voidedAt,
  };
}
export class ExpenseService {
  async get(id: string) {
    const row = await database()
      .prepare(select + " WHERE e.id=?")
      .bind(id)
      .first<Row>();
    if (!row) throw new HttpError(404, "notFound");
    return expenseDto(row);
  }
  async list(value: unknown): Promise<ExpensePage> {
    const parsed = expenseQuery.safeParse(value);
    if (!parsed.success) throw new HttpError(400, "invalid");
    const q = parsed.data,
      conditions = ["1=1"],
      values: unknown[] = [];
    if (q.state !== "all")
      conditions.push(
        q.state === "active" ? "e.voidedAt IS NULL" : "e.voidedAt IS NOT NULL",
      );
    if (q.category) {
      conditions.push("e.category=?");
      values.push(q.category);
    }
    if (q.order) {
      conditions.push("o.publicId=?");
      values.push(q.order);
    }
    if (q.from !== undefined || q.to !== undefined) {
      const p = financePeriod({ range: "custom", from: q.from, to: q.to });
      conditions.push("e.occurredAt>=? AND e.occurredAt<?");
      values.push(p.start, p.end);
    }
    const after = decodeCustomerCursor(q.cursor);
    if (after) {
      conditions.push("(e.occurredAt<? OR (e.occurredAt=? AND e.id<?))");
      values.push(after.time, after.time, after.id);
    }
    const rows = (
        await database()
          .prepare(
            select +
              " WHERE " +
              conditions.join(" AND ") +
              " ORDER BY e.occurredAt DESC,e.id DESC LIMIT ?",
          )
          .bind(...values, q.limit + 1)
          .all<Row>()
      ).results,
      visible = rows.slice(0, q.limit),
      last = visible.at(-1);
    return {
      expenses: visible.map(expenseDto),
      nextCursor:
        rows.length > q.limit && last
          ? Buffer.from(
              JSON.stringify({ time: last.occurredAt, id: last.id }),
            ).toString("base64url")
          : null,
    };
  }
  async save(actorId: string, value: unknown, id?: string) {
    const parsed = (
      id
        ? expenseInput.extend({
            expectedUpdatedAt: z.string().datetime().optional(),
          })
        : expenseInput
    ).safeParse(value);
    if (!parsed.success) throw new HttpError(400, "financeInvalidExpense");
    const data = parsed.data,
      occurredAt = tashkentTimestamp(data.occurredAt);
    const result = await atomic(async (batch) => {
      const old = id
        ? await prisma.expense.findUnique({ where: { id } })
        : null;
      if (id && !old) throw new HttpError(404, "notFound");
      if (old?.voidedAt) throw new HttpError(409, "financeVoided");
      if (
        old &&
        "expectedUpdatedAt" in data &&
        data.expectedUpdatedAt !== undefined &&
        old.updatedAt.toISOString() !== data.expectedUpdatedAt
      )
        throw new HttpError(409, "financeExpenseChanged");
      const order = data.orderPublicId
        ? await prisma.order.findUnique({
            where: { publicId: data.orderPublicId },
          })
        : null;
      if (data.orderPublicId && !order)
        throw new HttpError(404, "financeOrderMissing");
      const clean = {
        category: data.category,
        amount: data.amount,
        occurredAt,
        description: data.description || null,
        orderId: order?.id ?? null,
      };
      // Keep the edit version strictly increasing, including same-millisecond
      // requests. Batch.update otherwise assigns the wall-clock timestamp.
      if (id && old)
        batch.sql(
          'UPDATE "Expense" SET category=?,amount=?,occurredAt=?,description=?,orderId=?,updatedAt=? WHERE id=?',
          clean.category,
          clean.amount,
          clean.occurredAt,
          clean.description,
          clean.orderId,
          new Date(Math.max(Date.now(), old.updatedAt.getTime() + 1)),
          id,
        );
      const saved =
        id ??
        batch.insert("Expense", {
          ...clean,
          createdBy: financePrincipal(actorId),
        });
      const actor = adminAuditActor(actorId);
      batch.insert("AuditLog", {
        actorId: actor.actorId,
        action: id ? "expense.update" : "expense.create",
        entityType: "Expense",
        entityId: saved,
        metadata: {
          ...actor.metadata,
          category: data.category,
          amount: data.amount,
          occurredAt: occurredAt.toISOString(),
          orderId: clean.orderId,
        },
      });
      return saved;
    });
    return this.get(result);
  }
  async void(actorId: string, id: string) {
    await atomic(async (batch) => {
      const expense = await prisma.expense.findUnique({ where: { id } });
      if (!expense) throw new HttpError(404, "notFound");
      if (expense.voidedAt) return;
      batch.update("Expense", id, {
        voidedAt: new Date(),
        voidedBy: financePrincipal(actorId),
      });
      const actor = adminAuditActor(actorId);
      batch.insert("AuditLog", {
        actorId: actor.actorId,
        action: "expense.void",
        entityType: "Expense",
        entityId: id,
        metadata: {
          ...actor.metadata,
          category: expense.category,
          amount: expense.amount,
          occurredAt: expense.occurredAt.toISOString(),
          orderId: expense.orderId,
        },
      });
    });
    return this.get(id);
  }
}
export function registerExpenses(
  app: FastifyInstance,
  guard: (r: FastifyRequest) => Promise<void>,
) {
  const s = new ExpenseService(),
    actor = (r: FastifyRequest) => r.webAdminActor ?? r.currentUser!.id;
  app.get("/admin/finance/expenses", { preHandler: guard }, (r) =>
    s.list(r.query),
  );
  app.post("/admin/finance/expenses", { preHandler: guard }, async (r, reply) =>
    reply.status(201).send({ expense: await s.save(actor(r), r.body) }),
  );
  app.patch<{ Params: { id: string } }>(
    "/admin/finance/expenses/:id",
    { preHandler: guard },
    async (r) => ({ expense: await s.save(actor(r), r.body, r.params.id) }),
  );
  app.post<{ Params: { id: string } }>(
    "/admin/finance/expenses/:id/void",
    { preHandler: guard },
    async (r) => ({ expense: await s.void(actor(r), r.params.id) }),
  );
}
