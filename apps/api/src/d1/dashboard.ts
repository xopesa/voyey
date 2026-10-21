import { dashboardOrderEconomics } from "../modules/admin/finance/analytics.js";
import { safeMoney } from "../modules/admin/finance/procurement.js";
import { database } from "@stenzo/database";
import type { AdminDashboard } from "@stenzo/shared";
import type {
  DashboardRepository,
  DashboardPeriod,
} from "../modules/admin/dashboard.js";

export const LOW_STOCK_THRESHOLD = 3;
type Bucket = { date: string; value: number };
export class D1DashboardRepository implements DashboardRepository {
  async load(period: DashboardPeriod): Promise<AdminDashboard> {
    const db = database();
    // Seven aggregate/bounded SELECTs, independent of the total number of orders.
    // Payment amounts come ONLY from APPROVED rows; Order.paidAmount is never
    // included in KPI/chart aggregates. reviewedAt wins, submittedAt is fallback.
    const [orders, payments, current, products, stock, latest, economy] =
      await Promise.all([
        db
          .prepare(
            `SELECT strftime('%Y-%m-%d',createdAt/1000.0,'unixepoch','+5 hours') date, count(*) value FROM "Order" WHERE dashboardHiddenAt IS NULL AND createdAt>=? AND createdAt<? GROUP BY date`,
          )
          .bind(period.start, period.end)
          .all<Bucket>(),
        db
          .prepare(
            `SELECT strftime('%Y-%m-%d',COALESCE(reviewedAt,submittedAt)/1000.0,'unixepoch','+5 hours') date, SUM(expectedAmount) value FROM Payment WHERE orderId IN (SELECT id FROM "Order" WHERE dashboardHiddenAt IS NULL) AND status='APPROVED' AND COALESCE(reviewedAt,submittedAt)>=? AND COALESCE(reviewedAt,submittedAt)<? GROUP BY date`,
          )
          .bind(period.start, period.end)
          .all<Bucket>(),
        db
          .prepare(
            `SELECT COALESCE(SUM(status IN ('PREPAYMENT_SUBMITTED','FINAL_PAYMENT_SUBMITTED')),0) awaitingReview,
        COALESCE(SUM(status IN ('AWAITING_PURCHASE','PURCHASED','IN_TRANSIT','ARRIVED','WEIGHING','AWAITING_FINAL_PAYMENT','FINAL_PAYMENT_SUBMITTED','PAID_FULL','READY_TO_SHIP','SHIPPED')),0) inProgress FROM "Order" WHERE dashboardHiddenAt IS NULL`,
          )
          .first<{ awaitingReview: number; inProgress: number }>(),
        db
          .prepare(
            `SELECT count(*) total, COALESCE(SUM(status='ACTIVE'),0) active, COALESCE(SUM(status='DRAFT'),0) draft, COALESCE(SUM(status='INACTIVE'),0) inactive FROM Product WHERE archivedAt IS NULL`,
          )
          .first<{
            total: number;
            active: number;
            draft: number;
            inactive: number;
          }>(),
        db
          .prepare(
            `SELECT COALESCE(SUM(stock BETWEEN 1 AND ?),0) lowStockVariants, COALESCE(SUM(stock=0),0) outOfStockVariants FROM ProductVariant WHERE isActive=1 AND stock IS NOT NULL AND productId IN (SELECT id FROM Product WHERE archivedAt IS NULL)`,
          )
          .bind(LOW_STOCK_THRESHOLD)
          .first<{ lowStockVariants: number; outOfStockVariants: number }>(),
        db
          .prepare(
            `SELECT o.publicId,o.fullName,o.total,o.paidAmount+o.cargoPaidAmount paid,o.status,o.createdAt,u.username,u.firstName,u.lastName,u.telegramId FROM "Order" o LEFT JOIN User u ON u.id=o.userId WHERE o.dashboardHiddenAt IS NULL ORDER BY o.createdAt DESC,o.id DESC LIMIT 8`,
          )
          .all<{
            publicId: string;
            fullName: string;
            total: number;
            paid: number;
            status: string;
            createdAt: number;
            username: string | null;
            firstName: string | null;
            lastName: string | null;
            telegramId: string | null;
          }>(),
        db
          .prepare(
            dashboardOrderEconomics +
              `
          SELECT count(*) completedOrders,COALESCE(SUM(NOT complete),0) incompleteOrders,
          COALESCE(SUM(CASE WHEN complete THEN revenue-procurement-expenses ELSE 0 END),0) operatingProfit,
          (SELECT COALESCE(SUM(amount),0) FROM Expense WHERE orderId IS NULL AND voidedAt IS NULL AND occurredAt>=? AND occurredAt<?) overheadExpenses
          FROM economy
        `,
          )
          .bind(period.start, period.end, period.start, period.end)
          .first<{
            completedOrders: number;
            incompleteOrders: number;
            operatingProfit: number;
            overheadExpenses: number;
          }>(),
      ]);
    const orderDays = new Map(
      orders.results.map((row) => [row.date, row.value]),
    );
    const paymentDays = new Map(
      payments.results.map((row) => [row.date, row.value]),
    );
    const chart = period.days.map((date) => ({
      date,
      orders: orderDays.get(date) ?? 0,
      receivedPayments: paymentDays.get(date) ?? 0,
    }));
    return {
      period: { from: period.from, to: period.to, timezone: period.timezone },
      kpis: {
        orders: chart.reduce((sum, row) => sum + row.orders, 0),
        receivedPayments: chart.reduce(
          (sum, row) => sum + row.receivedPayments,
          0,
        ),
        awaitingReview: current!.awaitingReview,
        inProgress: current!.inProgress,
        activeProducts: products!.active,
        lowStockVariants: stock!.lowStockVariants + stock!.outOfStockVariants,
      },
      chart,
      profit: {
        netProfit:
          economy!.incompleteOrders > 0
            ? null
            : safeMoney(
                safeMoney(economy!.operatingProfit) -
                  safeMoney(economy!.overheadExpenses),
              ),
        incompleteOrders: economy!.incompleteOrders,
        completedOrders: economy!.completedOrders,
        overheadExpenses: safeMoney(economy!.overheadExpenses),
      },
      latestOrders: latest.results.map((row) => ({
        publicId: row.publicId,
        customer:
          row.fullName.trim() ||
          (row.username
            ? "@" + row.username
            : [row.firstName, row.lastName].filter(Boolean).join(" ").trim()) ||
          row.telegramId ||
          "—",
        total: row.total,
        paid: row.paid,
        status: row.status,
        createdAt: new Date(row.createdAt).toISOString(),
      })),
      products: {
        ...products!,
        ...stock!,
        lowStockThreshold: LOW_STOCK_THRESHOLD,
      },
    };
  }
}
