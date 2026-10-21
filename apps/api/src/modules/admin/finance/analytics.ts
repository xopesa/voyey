import { database } from "@stenzo/database";
import { expenseCategories, type FinanceDashboard } from "@stenzo/shared";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { financePeriod } from "./period.js";
import { safeMoney } from "./procurement.js";

// Aggregate costs/expenses separately before joining, avoiding item/payment/expense
// fan-out. Restrict SQL aggregation to the selected completed-order cohort.
const orderEconomics = (
  dashboardVisibleOnly = false,
) => `WITH selected AS (SELECT * FROM "Order" WHERE ${dashboardVisibleOnly ? "dashboardHiddenAt IS NULL AND " : ""}status='COMPLETED' AND completedAt>=? AND completedAt<?),
costs AS (SELECT i.orderId,count(*) itemCount,SUM(i.procurementUnitCost IS NULL) missingCosts,COALESCE(SUM(i.procurementUnitCost*i.quantity),0) procurement FROM OrderItem i JOIN selected s ON s.id=i.orderId GROUP BY i.orderId),
expenses AS (SELECT e.orderId,SUM(e.amount) expenses FROM Expense e JOIN selected s ON s.id=e.orderId WHERE e.voidedAt IS NULL GROUP BY e.orderId),
economy AS (SELECT s.id,s.publicId,s.fullName customer,s.completedAt,s.total+COALESCE(s.cargoAmount,0) revenue,COALESCE(c.procurement,0) procurement,COALESCE(e.expenses,0) expenses,
COALESCE(c.itemCount>0 AND c.missingCosts=0,0) complete FROM selected s LEFT JOIN costs c ON c.orderId=s.id LEFT JOIN expenses e ON e.orderId=s.id)`;
// Dashboard hiding is a presentation filter; the financial ledger includes every order.
export const completedOrderEconomics = orderEconomics();
export const dashboardOrderEconomics = orderEconomics(true);
const day = (column: string) =>
  `strftime('%Y-%m-%d',${column}/1000.0,'unixepoch','+5 hours')`;

export class FinanceService {
  async load(query: unknown, now = Date.now()): Promise<FinanceDashboard> {
    const p = financePeriod(query, now),
      db = database();
    const [
      cash,
      expenseDays,
      realized,
      profitDays,
      breakdown,
      profitable,
      incomplete,
      undated,
    ] = await Promise.all([
      db
        .prepare(
          `WITH periodPayments AS (SELECT p.*,o.total,o.requiredPrepayment,o.cargoAmount,o.cargoPaidAmount,o.paidAmount,o.remainingAmount FROM Payment p JOIN "Order" o ON o.id=p.orderId WHERE p.status='APPROVED' AND COALESCE(p.reviewedAt,p.submittedAt)>=? AND COALESCE(p.reviewedAt,p.submittedAt)<?),
phases AS (SELECT p.orderId,SUM(p.type='PREPAYMENT') preCount,SUM(CASE WHEN p.type='PREPAYMENT' THEN p.expectedAmount ELSE 0 END) preAmount,SUM(p.type='FINAL') finalCount FROM Payment p WHERE p.status='APPROVED' AND p.orderId IN (SELECT orderId FROM periodPayments) GROUP BY p.orderId),
classified AS (SELECT p.*,p.type='FINAL' AND ph.preCount=1 AND ph.finalCount=1 AND ph.preAmount=p.requiredPrepayment AND p.total>=p.requiredPrepayment AND p.cargoAmount IS NOT NULL AND p.expectedAmount=p.total-p.requiredPrepayment+p.cargoAmount AND p.cargoPaidAmount=p.cargoAmount AND p.paidAmount=p.total AND p.remainingAmount=0 exactFinal FROM periodPayments p JOIN phases ph ON ph.orderId=p.orderId)
SELECT ${day("COALESCE(reviewedAt,submittedAt)")} date,SUM(expectedAmount) received,
SUM(CASE WHEN type='PREPAYMENT' THEN expectedAmount WHEN exactFinal THEN total-requiredPrepayment ELSE 0 END) goods,
SUM(CASE WHEN exactFinal THEN cargoAmount ELSE 0 END) cargo,
SUM(CASE WHEN type='FINAL' AND NOT exactFinal THEN expectedAmount ELSE 0 END) unallocated,
SUM(type='FINAL' AND NOT exactFinal) unallocatedCount FROM classified GROUP BY date`,
        )
        .bind(p.start, p.end)
        .all<{
          date: string;
          received: number;
          goods: number;
          cargo: number;
          unallocated: number;
          unallocatedCount: number;
        }>(),
      db
        .prepare(
          `SELECT ${day("occurredAt")} date,SUM(amount) expenses FROM Expense WHERE voidedAt IS NULL AND occurredAt>=? AND occurredAt<? GROUP BY date`,
        )
        .bind(p.start, p.end)
        .all<{ date: string; expenses: number }>(),
      db
        .prepare(
          completedOrderEconomics +
            ` SELECT count(*) completedOrders,COALESCE(SUM(complete),0) costCompleteOrders,COALESCE(SUM(NOT complete),0) incompleteOrders,
COALESCE(SUM(CASE WHEN complete THEN revenue ELSE 0 END),0) revenue,COALESCE(SUM(CASE WHEN complete THEN procurement ELSE 0 END),0) procurement,
COALESCE(SUM(CASE WHEN complete THEN expenses ELSE 0 END),0) expenses,COALESCE(SUM(CASE WHEN complete THEN revenue-procurement-expenses ELSE 0 END),0) profit FROM economy`,
        )
        .bind(p.start, p.end)
        .first<{
          completedOrders: number;
          costCompleteOrders: number;
          incompleteOrders: number;
          revenue: number;
          procurement: number;
          expenses: number;
          profit: number;
        }>(),
      db
        .prepare(
          completedOrderEconomics +
            ` SELECT ${day("completedAt")} date,SUM(revenue-procurement-expenses) profit FROM economy WHERE complete GROUP BY date`,
        )
        .bind(p.start, p.end)
        .all<{ date: string; profit: number }>(),
      db
        .prepare(
          "SELECT category,SUM(amount) amount FROM Expense WHERE voidedAt IS NULL AND occurredAt>=? AND occurredAt<? GROUP BY category",
        )
        .bind(p.start, p.end)
        .all<{
          category: (typeof expenseCategories)[number];
          amount: number;
        }>(),
      db
        .prepare(
          completedOrderEconomics +
            " SELECT publicId,customer,completedAt,revenue,procurement,expenses,revenue-procurement-expenses profit FROM economy WHERE complete ORDER BY completedAt DESC,id DESC LIMIT 10",
        )
        .bind(p.start, p.end)
        .all<{
          publicId: string;
          customer: string;
          completedAt: number;
          revenue: number;
          procurement: number;
          expenses: number;
          profit: number;
        }>(),
      db
        .prepare(
          `SELECT o.publicId,o.fullName customer,o.status,(SELECT count(*) FROM OrderItem i WHERE i.orderId=o.id AND i.procurementUnitCost IS NULL) missingCosts FROM "Order" o WHERE o.status IN ('AWAITING_PURCHASE','PURCHASED','IN_TRANSIT','ARRIVED','WEIGHING','AWAITING_FINAL_PAYMENT','FINAL_PAYMENT_SUBMITTED','PAID_FULL','READY_TO_SHIP','SHIPPED','COMPLETED') AND EXISTS(SELECT 1 FROM OrderItem i WHERE i.orderId=o.id AND i.procurementUnitCost IS NULL) ORDER BY o.createdAt DESC,o.id DESC LIMIT 10`,
        )
        .all<FinanceDashboard["incompleteOrders"][number]>(),
      db
        .prepare(
          "SELECT count(*) n FROM \"Order\" WHERE status='COMPLETED' AND completedAt IS NULL",
        )
        .first<{ n: number }>(),
    ]);
    const [refundDays, pending] = await Promise.all([
      db
        .prepare(
          `SELECT ${day("completedAt")} date,SUM(amount) amount FROM Refund WHERE status='COMPLETED' AND completedAt>=? AND completedAt<? GROUP BY date`,
        )
        .bind(p.start, p.end)
        .all<{ date: string; amount: number }>(),
      db
        .prepare(
          "SELECT count(*) count,COALESCE(SUM(amount),0) amount FROM Refund WHERE status='PENDING'",
        )
        .first<{ count: number; amount: number }>(),
    ]);
    const refundMap = new Map(
        refundDays.results.map((r) => [r.date, r.amount]),
      ),
      refunded = safeMoney(
        refundDays.results.reduce((s, r) => s + r.amount, 0),
      );
    const cashMap = new Map(cash.results.map((r) => [r.date, r])),
      expenseMap = new Map(
        expenseDays.results.map((r) => [r.date, r.expenses]),
      ),
      profitMap = new Map(profitDays.results.map((r) => [r.date, r.profit]));
    const sum = (
      key: "received" | "goods" | "cargo" | "unallocated" | "unallocatedCount",
    ) => safeMoney(cash.results.reduce((s, r) => s + r[key], 0));
    const received = sum("received"),
      expenses = safeMoney(
        expenseDays.results.reduce((s, r) => s + r.expenses, 0),
      ),
      unallocatedFinalCount = sum("unallocatedCount");
    const totals = realized!;
    for (const key of ["revenue", "procurement", "expenses", "profit"] as const)
      safeMoney(totals[key]);
    return {
      period: { from: p.from, to: p.to, timezone: p.timezone },
      cash: {
        refunded,
        pendingRefundAmount: safeMoney(pending!.amount),
        pendingRefundCount: pending!.count,
        received,
        goodsReceived: unallocatedFinalCount ? null : sum("goods"),
        cargoReceived: unallocatedFinalCount ? null : sum("cargo"),
        unallocatedCash: sum("unallocated"),
        unallocatedFinalCount,
        expenses,
        cashBeforeProcurement: safeMoney(received - refunded - expenses),
      },
      realized: {
        ...totals,
        marginPercent:
          totals.revenue > 0 ? (totals.profit / totals.revenue) * 100 : null,
        historicalUndated: undated!.n,
      },
      chart: p.days.map((date) => ({
        refunds: safeMoney(refundMap.get(date) ?? 0),
        date,
        received: safeMoney(cashMap.get(date)?.received ?? 0),
        expenses: safeMoney(expenseMap.get(date) ?? 0),
        profit: safeMoney(profitMap.get(date) ?? 0),
      })),
      expenseBreakdown: expenseCategories.map((category) => ({
        category,
        amount: safeMoney(
          breakdown.results.find((r) => r.category === category)?.amount ?? 0,
        ),
      })),
      profitableOrders: profitable.results.map((r) => ({
        ...r,
        revenue: safeMoney(r.revenue),
        procurement: safeMoney(r.procurement),
        expenses: safeMoney(r.expenses),
        profit: safeMoney(r.profit),
        marginPercent: r.revenue > 0 ? (r.profit / r.revenue) * 100 : null,
        completedAt: new Date(r.completedAt).toISOString(),
      })),
      incompleteOrders: incomplete.results,
    };
  }
}
export function registerFinance(
  app: FastifyInstance,
  guard: (r: FastifyRequest) => Promise<void>,
) {
  const s = new FinanceService();
  app.get("/admin/finance", { preHandler: guard }, (r) => s.load(r.query));
}
