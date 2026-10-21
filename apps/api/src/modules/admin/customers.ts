import { database } from "@stenzo/database";
import { z } from "zod";
import type {
  Customer,
  CustomerCard,
  CustomerOrderPage,
  CustomerPage,
  CustomerRecipient,
} from "@stenzo/shared";
import { HttpError } from "../auth/errors.js";
import type { FastifyInstance, FastifyRequest } from "fastify";

const paging = z
  .object({
    limit: z.coerce.number().int().min(1).max(50).default(20),
    cursor: z.string().max(512).optional(),
  })
  .strict();
export const customerQuery = paging.extend({
  search: z.string().trim().max(100).optional(),
  filter: z
    .enum(["all", "active", "blocked", "with-orders", "no-orders"])
    .default("all"),
});
export type CustomerQuery = z.infer<typeof customerQuery>;
const cursorSchema = z
  .object({
    time: z.number().int().nonnegative().max(8640000000000000),
    id: z.string().min(1).max(100),
  })
  .strict();
export function decodeCustomerCursor(value?: string) {
  if (!value) return null;
  try {
    return cursorSchema.parse(
      JSON.parse(Buffer.from(value, "base64url").toString()),
    );
  } catch {
    throw new HttpError(400, "Invalid cursor");
  }
}
const cursor = (time: number, id: string) =>
  Buffer.from(JSON.stringify({ time, id })).toString("base64url");
const iso = (time: number) => new Date(time).toISOString();
type SummaryRow = {
  id: string;
  telegramId: string;
  username: string | null;
  firstName: string | null;
  lastName: string | null;
  preferredLocale: "ru" | "uz";
  status: Customer["status"];
  createdAt: number;
  updatedAt: number;
  orderCount: number;
  activeOrders: number;
  completedOrders: number;
  approvedPayments: number;
  refunded: number;
  pendingRefunds: number;
  prepayments: number;
  finalPayments: number;
  latestPublicId: string | null;
  latestCreatedAt: number | null;
  lastInteraction: number;
};

export class CustomerService {
  private async summaries(
    where: string,
    values: unknown[],
    limit: number,
  ): Promise<SummaryRow[]> {
    // Aggregate only in SQL and only for the bounded user page. No per-customer queries.
    const sql = `WITH page AS (SELECT u.* FROM User u WHERE ${where} ORDER BY u.createdAt DESC,u.id DESC LIMIT ?),
      history AS (SELECT o.*,ROW_NUMBER() OVER (PARTITION BY o.userId ORDER BY o.createdAt DESC,o.id DESC) rn FROM "Order" o JOIN page ON page.id=o.userId),
      os AS (SELECT userId,COUNT(*) orderCount,SUM(status NOT IN ('COMPLETED','CANCELLED')) activeOrders,SUM(status='COMPLETED') completedOrders FROM history GROUP BY userId),
      ps AS (SELECT h.userId,SUM(CASE WHEN p.status='APPROVED' THEN p.expectedAmount ELSE 0 END) approvedPayments,
        SUM(CASE WHEN p.status='APPROVED' AND p.type='PREPAYMENT' THEN p.expectedAmount ELSE 0 END) prepayments,
        SUM(CASE WHEN p.status='APPROVED' AND p.type='FINAL' THEN p.expectedAmount ELSE 0 END) finalPayments,MAX(p.submittedAt) lastPayment FROM Payment p JOIN history h ON p.orderId=h.id GROUP BY h.userId),
      rs AS (SELECT h.userId,SUM(CASE WHEN r.status='COMPLETED' THEN r.amount ELSE 0 END) refunded,SUM(CASE WHEN r.status='PENDING' THEN r.amount ELSE 0 END) pendingRefunds FROM Refund r JOIN history h ON r.orderId=h.id GROUP BY h.userId)
      SELECT page.id,CAST(page.telegramId AS TEXT) telegramId,page.username,page.firstName,page.lastName,page.preferredLocale,page.status,page.createdAt,page.updatedAt,
      COALESCE(os.orderCount,0) orderCount,COALESCE(os.activeOrders,0) activeOrders,COALESCE(os.completedOrders,0) completedOrders,
      COALESCE(ps.approvedPayments,0) approvedPayments,COALESCE(ps.prepayments,0) prepayments,COALESCE(ps.finalPayments,0) finalPayments,
      h.publicId latestPublicId,h.createdAt latestCreatedAt,MAX(page.updatedAt,COALESCE(h.createdAt,0),COALESCE(ps.lastPayment,0)) lastInteraction
      ,COALESCE(rs.refunded,0) refunded,COALESCE(rs.pendingRefunds,0) pendingRefunds
      FROM page LEFT JOIN os ON os.userId=page.id LEFT JOIN ps ON ps.userId=page.id LEFT JOIN rs ON rs.userId=page.id LEFT JOIN history h ON h.userId=page.id AND h.rn=1
      ORDER BY page.createdAt DESC,page.id DESC`;
    return (
      await database()
        .prepare(sql)
        .bind(...values, limit)
        .all<SummaryRow>()
    ).results;
  }
  private dto(r: SummaryRow): Customer {
    return {
      id: r.id,
      telegramId: r.telegramId,
      username: r.username,
      firstName: r.firstName,
      lastName: r.lastName,
      preferredLocale: r.preferredLocale,
      status: r.status,
      registeredAt: iso(r.createdAt),
      lastInteractionAt: iso(r.lastInteraction),
      orderCount: r.orderCount,
      activeOrders: r.activeOrders,
      completedOrders: r.completedOrders,
      approvedPayments: r.approvedPayments,
      refunded: r.refunded,
      pendingRefunds: r.pendingRefunds,
      prepayments: r.prepayments,
      finalPayments: r.finalPayments,
      latestOrder: r.latestPublicId
        ? { publicId: r.latestPublicId, createdAt: iso(r.latestCreatedAt!) }
        : null,
    };
  }
  async list(q: CustomerQuery): Promise<CustomerPage> {
    const conditions = ["1=1"],
      values: unknown[] = [];
    if (q.filter === "active" || q.filter === "blocked") {
      conditions.push("u.status=?");
      values.push(q.filter.toUpperCase());
    }
    if (q.filter === "with-orders" || q.filter === "no-orders")
      conditions.push(
        `${q.filter === "no-orders" ? "NOT " : ""}EXISTS(SELECT 1 FROM "Order" o WHERE o.userId=u.id)`,
      );
    if (q.search) {
      // Literal substring search: bound values cannot become SQL or LIKE wildcards.
      const term = q.search.replace(/^@/, "");
      conditions.push(
        "(instr(CAST(u.telegramId AS TEXT),?)>0 OR instr(lower(COALESCE(u.username,'')),lower(?))>0 OR instr(lower(COALESCE(u.firstName,'')),lower(?))>0 OR instr(lower(COALESCE(u.lastName,'')),lower(?))>0 OR EXISTS(SELECT 1 FROM \"Order\" o WHERE o.userId=u.id AND instr(o.phone,?)>0))",
      );
      values.push(term, term, term, term, term);
    }
    const after = decodeCustomerCursor(q.cursor);
    if (after) {
      conditions.push("(u.createdAt<? OR (u.createdAt=? AND u.id<?))");
      values.push(after.time, after.time, after.id);
    }
    const rows = await this.summaries(
        conditions.join(" AND "),
        values,
        q.limit + 1,
      ),
      visible = rows.slice(0, q.limit),
      last = visible.at(-1);
    return {
      customers: visible.map((r) => this.dto(r)),
      nextCursor:
        rows.length > q.limit && last ? cursor(last.createdAt, last.id) : null,
    };
  }
  async card(id: string): Promise<CustomerCard> {
    const row = (await this.summaries("u.id=?", [id], 1))[0];
    if (!row) throw new HttpError(404, "customerMissing");
    const latestRecipient = await database()
      .prepare(
        'SELECT fullName,phone,city,address,apartment,comment FROM "Order" WHERE userId=? ORDER BY createdAt DESC,id DESC LIMIT 1',
      )
      .bind(id)
      .first<CustomerRecipient>();
    return { ...this.dto(row), latestRecipient };
  }
  async orders(
    id: string,
    q: z.infer<typeof paging>,
  ): Promise<CustomerOrderPage> {
    if (
      !(await database()
        .prepare("SELECT id FROM User WHERE id=?")
        .bind(id)
        .first())
    )
      throw new HttpError(404, "customerMissing");
    const after = decodeCustomerCursor(q.cursor),
      values: unknown[] = [id];
    let condition = "o.userId=?";
    if (after) {
      condition += " AND (o.createdAt<? OR (o.createdAt=? AND o.id<?))";
      values.push(after.time, after.time, after.id);
    }
    const rows = (
      await database()
        .prepare(
          `SELECT o.*,COALESCE((SELECT SUM(expectedAmount) FROM Payment p WHERE p.orderId=o.id AND p.status='APPROVED'),0) approvedPaid FROM "Order" o WHERE ${condition} ORDER BY o.createdAt DESC,o.id DESC LIMIT ?`,
        )
        .bind(...values, q.limit + 1)
        .all<{
          id: string;
          publicId: string;
          source?: "MINIAPP" | "ADMIN";
          createdAt: number;
          total: number;
          discountAmount: number;
          approvedPaid: number;
          status: string;
        }>()
    ).results;
    const visible = rows.slice(0, q.limit),
      last = visible.at(-1);
    return {
      orders: visible.map((r) => ({
        publicId: r.publicId,
        source: r.source ?? "MINIAPP",
        createdAt: iso(r.createdAt),
        total: r.total,
        discountAmount: r.discountAmount,
        paid: r.approvedPaid,
        status: r.status,
      })),
      nextCursor:
        rows.length > q.limit && last ? cursor(last.createdAt, last.id) : null,
    };
  }
}
export function registerCustomerRoutes(
  app: FastifyInstance,
  guard: (r: FastifyRequest) => Promise<void>,
) {
  const service = new CustomerService();
  app.get("/admin/customers", { preHandler: guard }, async (r) => {
    const parsed = customerQuery.safeParse(r.query);
    if (!parsed.success) throw new HttpError(400, "Invalid customer query");
    return service.list(parsed.data);
  });
  app.get<{ Params: { id: string } }>(
    "/admin/customers/:id",
    { preHandler: guard },
    async (r) => ({ customer: await service.card(r.params.id) }),
  );
  app.get<{ Params: { id: string } }>(
    "/admin/customers/:id/orders",
    { preHandler: guard },
    async (r) => {
      const parsed = paging.safeParse(r.query);
      if (!parsed.success)
        throw new HttpError(400, "Invalid customer orders query");
      return service.orders(r.params.id, parsed.data);
    },
  );
}
