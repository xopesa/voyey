import type { HealthResponse } from "@stenzo/shared";
import type { FastifyInstance } from "fastify";
import { prisma } from "@stenzo/database";

export async function healthRoutes(
  app: FastifyInstance,
  options: { checkDatabase?: () => Promise<unknown> } = {},
): Promise<void> {
  app.get("/health", async (): Promise<HealthResponse> => ({
    status: "ok",
    service: "stenzo-api",
    timestamp: new Date().toISOString(),
  }));
  app.get("/ready", async (_request, reply) => {
    reply.header("Cache-Control", "no-store");
    try {
      await (options.checkDatabase ?? (() => prisma.$queryRaw`SELECT 1`))();
      return { status: "ok", service: "stenzo-api" };
    } catch {
      return reply
        .code(503)
        .send({ status: "unavailable", service: "stenzo-api" });
    }
  });
}
