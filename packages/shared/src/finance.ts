export const expenseCategories = [
  "CARGO",
  "PACKAGING",
  "DELIVERY",
  "ADVERTISING",
  "BANK_FEE",
  "OTHER",
] as const;
export type ExpenseCategory = (typeof expenseCategories)[number];
export type OrderProfit = {
  goodsSubtotal: number;
  discountAmount: number;
  goodsRevenue: number;
  customerCargo: number;
  revenue: number;
  procurementCost: number;
  linkedExpenses: number;
  directCost: number;
  costComplete: boolean;
  missingCosts: number;
  profit: number | null;
  marginPercent: number | null;
};
export type AdminOrderFinance = OrderProfit & {
  publicId: string;
  completedAt: string | null;
  received: number;
  outstanding: number;
  items: {
    id: string;
    productNameRu: string;
    productNameUz: string;
    sku: string;
    quantity: number;
    unitPrice: number;
    lineTotal: number;
    procurementUnitCost: number | null;
    procurementUpdatedAt: string | null;
    procurementLineCost: number | null;
    lineMargin: number | null;
  }[];
};
export type AdminExpense = {
  id: string;
  category: ExpenseCategory;
  amount: number;
  occurredAt: string;
  description: string | null;
  orderPublicId: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  voidedAt: string | null;
};
export type ExpensePage = {
  expenses: AdminExpense[];
  nextCursor: string | null;
};
export type FinanceRange = "today" | "7d" | "30d" | "90d" | "custom";
export type FinanceDashboard = {
  period: { from: string; to: string; timezone: "Asia/Tashkent" };
  cash: {
    refunded?: number;
    pendingRefundAmount?: number;
    pendingRefundCount?: number;
    received: number;
    goodsReceived: number | null;
    cargoReceived: number | null;
    unallocatedCash: number;
    unallocatedFinalCount: number;
    expenses: number;
    cashBeforeProcurement: number;
  };
  realized: {
    completedOrders: number;
    costCompleteOrders: number;
    incompleteOrders: number;
    revenue: number;
    procurement: number;
    expenses: number;
    profit: number;
    marginPercent: number | null;
    historicalUndated: number;
  };
  chart: {
    date: string;
    received: number;
    expenses: number;
    profit: number;
    refunds?: number;
  }[];
  expenseBreakdown: { category: ExpenseCategory; amount: number }[];
  profitableOrders: {
    publicId: string;
    customer: string;
    completedAt: string;
    revenue: number;
    procurement: number;
    expenses: number;
    profit: number;
    marginPercent: number | null;
  }[];
  incompleteOrders: {
    publicId: string;
    customer: string;
    status: string;
    missingCosts: number;
  }[];
};
