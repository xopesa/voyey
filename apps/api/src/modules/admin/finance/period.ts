import { z } from "zod";
import { HttpError } from "../../auth/errors.js";
const DAY = 86400000,
  OFFSET = 18000000;
export function financeDay(value: string) {
  const n = Date.parse(value + "T00:00:00Z");
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    !Number.isFinite(n) ||
    n < 0 ||
    new Date(n).toISOString().slice(0, 10) !== value
  )
    throw new HttpError(400, "financeInvalidDate");
  return n;
}
export function tashkentTimestamp(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value))
    throw new HttpError(400, "financeInvalidDate");
  const n = Date.parse(value + ":00+05:00");
  if (
    !Number.isFinite(n) ||
    n < 0 ||
    new Date(n + OFFSET).toISOString().slice(0, 16) !== value
  )
    throw new HttpError(400, "financeInvalidDate");
  return new Date(n);
}
export function financePeriod(input: unknown, now = Date.now()) {
  const p = z
    .object({
      range: z.enum(["today", "7d", "30d", "90d", "custom"]).default("30d"),
      from: z.string().optional(),
      to: z.string().optional(),
    })
    .strict()
    .safeParse(input);
  if (!p.success) throw new HttpError(400, "financeInvalidPeriod");
  const { range, from, to } = p.data;
  let first: number, last: number;
  if (range === "custom") {
    if (!from || !to) throw new HttpError(400, "financeInvalidPeriod");
    first = financeDay(from);
    last = financeDay(to);
  } else {
    if (from !== undefined || to !== undefined)
      throw new HttpError(400, "financeInvalidPeriod");
    last = financeDay(new Date(now + OFFSET).toISOString().slice(0, 10));
    first =
      last -
      ((range === "today"
        ? 1
        : range === "7d"
          ? 7
          : range === "90d"
            ? 90
            : 30) -
        1) *
        DAY;
  }
  const count = (last - first) / DAY + 1;
  if (count < 1 || count > 366)
    throw new HttpError(400, "financeInvalidPeriod");
  const days = Array.from({ length: count }, (_, i) =>
    new Date(first + i * DAY).toISOString().slice(0, 10),
  );
  return {
    from: days[0]!,
    to: days.at(-1)!,
    timezone: "Asia/Tashkent" as const,
    start: first - OFFSET,
    end: last + DAY - OFFSET,
    days,
  };
}
