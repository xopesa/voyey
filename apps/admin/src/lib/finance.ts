import {
  expenseCategories,
  type AdminExpense,
  type ExpenseCategory,
  type FinanceRange,
} from "@stenzo/shared";
export { expenseCategories };
export function tashkentInput(iso = new Date().toISOString()) {
  return new Date(Date.parse(iso) + 18000000).toISOString().slice(0, 16);
}
export function expenseDraft(row?: AdminExpense, orderPublicId = "") {
  return {
    category: (row?.category ?? "OTHER") as ExpenseCategory,
    amount: row ? String(row.amount) : "",
    occurredAt: tashkentInput(row?.occurredAt),
    description: row?.description ?? "",
    orderPublicId: row?.orderPublicId ?? orderPublicId,
  };
}
export function expensePayload(
  draft: ReturnType<typeof expenseDraft>,
  row?: AdminExpense,
) {
  const amount = Number(draft.amount);
  if (
    !/^\d+$/.test(draft.amount) ||
    !Number.isInteger(amount) ||
    amount < 1 ||
    amount > 2147483647
  )
    throw Error("financeInvalidExpense");
  return {
    ...draft,
    amount,
    description: draft.description.trim() || null,
    orderPublicId: draft.orderPublicId.trim() || null,
    ...(row ? { expectedUpdatedAt: row.updatedAt } : {}),
  };
}
export function financeQuery(range: FinanceRange, from: string, to: string) {
  const q = new URLSearchParams({ range });
  if (range === "custom") {
    q.set("from", from);
    q.set("to", to);
  }
  return "finance?" + q;
}
export function financeChartGeometry(
  rows: {
    date: string;
    received: number;
    expenses: number;
    profit: number;
    refunds?: number;
  }[],
  keys: ("received" | "expenses" | "profit" | "refunds")[],
) {
  const values = rows.flatMap((r) => keys.map((k) => r[k] ?? 0)),
    min = Math.min(0, ...values),
    max = Math.max(1, ...values),
    y = (n: number) => 180 - ((n - min) / (max - min)) * 160;
  return {
    min,
    max,
    zero: y(0),
    series: keys.map((key) => ({
      key,
      points: rows.map((r, i) => ({
        x: 48 + (i / Math.max(1, rows.length - 1)) * 624,
        y: y(r[key] ?? 0),
      })),
      path: rows
        .map(
          (r, i) =>
            `${i ? "L" : "M"}${48 + (i / Math.max(1, rows.length - 1)) * 624},${y(r[key] ?? 0)}`,
        )
        .join(" "),
    })),
  };
}
