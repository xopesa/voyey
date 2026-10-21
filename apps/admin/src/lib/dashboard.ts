import type { AdminDashboard, DashboardRange } from "@stenzo/shared";
export type { AdminDashboard, DashboardRange };

export function dashboardQuery(
  range: DashboardRange,
  from: string,
  to: string,
) {
  const query = new URLSearchParams({ range });
  if (range === "custom") {
    query.set("from", from);
    query.set("to", to);
  }
  return `dashboard?${query}`;
}
export function dashboardDate(
  value: string,
  locale: "ru" | "uz",
  withTime = false,
) {
  return new Intl.DateTimeFormat(locale === "ru" ? "ru-RU" : "uz-UZ", {
    timeZone: "Asia/Tashkent",
    dateStyle: "short",
    ...(withTime ? { timeStyle: "short" as const } : {}),
  }).format(new Date(value.length === 10 ? value + "T12:00:00Z" : value));
}
export function chartGeometry(
  chart: AdminDashboard["chart"],
  metric: "orders" | "receivedPayments",
  width: number,
) {
  const left = 64,
    right = width - 18,
    top = 20,
    bottom = 224;
  const max = Math.max(1, ...chart.map((row) => row[metric]));
  const rawStep = Math.max(1, max / 4);
  const magnitude = Math.pow(10, Math.floor(Math.log10(rawStep)));
  const ceiling = Math.ceil(rawStep / magnitude) * magnitude * 4;
  const points = chart.map((row, index) => ({
    ...row,
    value: row[metric],
    x:
      chart.length === 1
        ? (left + right) / 2
        : left + (index / (chart.length - 1)) * (right - left),
    y: bottom - (row[metric] / ceiling) * (bottom - top),
  }));
  return {
    points,
    ceiling,
    left,
    right,
    top,
    bottom,
    path: points
      .map((point, index) => `${index ? "L" : "M"}${point.x},${point.y}`)
      .join(" "),
  };
}
