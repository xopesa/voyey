export type DashboardRange = "today" | "7d" | "30d" | "custom";
export interface AdminDashboard {
  period: { from: string; to: string; timezone: "Asia/Tashkent" };
  kpis: {
    orders: number;
    receivedPayments: number;
    awaitingReview: number;
    inProgress: number;
    activeProducts: number;
    lowStockVariants: number;
  };
  chart: { date: string; orders: number; receivedPayments: number }[];
  profit?: {
    netProfit: number | null;
    incompleteOrders: number;
    completedOrders: number;
    overheadExpenses: number;
  };
  latestOrders: {
    publicId: string;
    customer: string;
    total: number;
    paid: number;
    status: string;
    createdAt: string;
  }[];
  products: {
    total: number;
    active: number;
    draft: number;
    inactive: number;
    lowStockVariants: number;
    outOfStockVariants: number;
    lowStockThreshold: number;
  };
}
