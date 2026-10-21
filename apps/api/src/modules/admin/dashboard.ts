import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import type { AdminDashboard } from "@stenzo/shared";
import { HttpError } from "../auth/errors.js";

const DAY = 86400000;
// Asia/Tashkent uses UTC+05:00 with no daylight saving in the store's operating era.
const TASHKENT_OFFSET = 5 * 60 * 60 * 1000;
const querySchema = z
  .object({
    range: z.enum(["today", "7d", "30d", "custom"]).default("7d"),
    from: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    to: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
  })
  .strict();
export type DashboardPeriod = AdminDashboard["period"] & {
  start: number;
  end: number;
  days: string[];
};
function day(value: string): number {
  const parsed = Date.parse(value + "T00:00:00.000Z");
  if (
    !Number.isFinite(parsed) ||
    new Date(parsed).toISOString().slice(0, 10) !== value
  )
    throw new HttpError(400, "Invalid dashboard period");
  return parsed;
}
export function dashboardPeriod(
  query: unknown,
  now = Date.now(),
): DashboardPeriod {
  const result = querySchema.safeParse(query);
  if (!result.success) throw new HttpError(400, "Invalid dashboard period");
  const { range, from, to } = result.data;
  let first: number, last: number;
  if (range === "custom") {
    if (!from || !to) throw new HttpError(400, "Invalid dashboard period");
    first = day(from);
    last = day(to);
  } else {
    if (from !== undefined || to !== undefined)
      throw new HttpError(400, "Invalid dashboard period");
    last = day(new Date(now + TASHKENT_OFFSET).toISOString().slice(0, 10));
    first = last - ((range === "30d" ? 30 : range === "7d" ? 7 : 1) - 1) * DAY;
  }
  const count = (last - first) / DAY + 1;
  if (count < 1 || count > 366)
    throw new HttpError(400, "Invalid dashboard period");
  const days = Array.from({ length: count }, (_, i) =>
    new Date(first + i * DAY).toISOString().slice(0, 10),
  );
  return {
    from: days[0]!,
    to: days.at(-1)!,
    timezone: "Asia/Tashkent",
    start: first - TASHKENT_OFFSET,
    end: last + DAY - TASHKENT_OFFSET,
    days,
  };
}
export interface DashboardRepository {
  load(period: DashboardPeriod): Promise<AdminDashboard>;
}
export class AdminDashboardService {
  constructor(
    private readonly repository: DashboardRepository,
    private readonly now = Date.now,
  ) {}
  load(query: unknown) {
    return this.repository.load(dashboardPeriod(query, this.now()));
  }
}
export function registerDashboardRoutes(
  app: FastifyInstance,
  guard: (request: FastifyRequest) => Promise<void>,
  service?: AdminDashboardService,
) {
  app.get("/admin/dashboard", { preHandler: guard }, async (request) => {
    if (!service) throw new HttpError(503, "Dashboard unavailable");
    return service.load(request.query);
  });
}
