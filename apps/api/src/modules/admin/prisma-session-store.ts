import { prisma, type Prisma } from "@stenzo/database";
import type { AdminSession, AdminSessionStore } from "./session-store.js";

export class PrismaAdminSessionStore implements AdminSessionStore {
  constructor(private readonly database = prisma) {}
  private locked<T>(
    operation: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    return this.database.$transaction(
      async (tx) => {
        // Transaction lock works with pooled connections and across all API instances.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(782694130)`;
        return operation(tx);
      },
      { maxWait: 5000, timeout: 10000 },
    );
  }
  reserveAttempt(ipKey: string, now: number) {
    return this.locked(async (tx) => {
      const date = new Date(now);
      await tx.adminLoginRateLimit.deleteMany({
        where: { expiresAt: { lte: date } },
      });
      const key = `ip:${ipKey}`;
      const [ip, global, count] = await Promise.all([
        tx.adminLoginRateLimit.findUnique({ where: { key } }),
        tx.adminLoginRateLimit.findUnique({ where: { key: "global" } }),
        tx.adminLoginRateLimit.count({ where: { key: { not: "global" } } }),
      ]);
      if (
        (ip?.count ?? 0) >= 5 ||
        (global?.count ?? 0) >= 30 ||
        (!ip && count >= 10_000)
      )
        return false;
      await tx.adminLoginRateLimit.upsert({
        where: { key },
        create: { key, count: 1, expiresAt: new Date(now + 15 * 60_000) },
        update: { count: { increment: 1 } },
      });
      await tx.adminLoginRateLimit.upsert({
        where: { key: "global" },
        create: { key: "global", count: 1, expiresAt: new Date(now + 60_000) },
        update: { count: { increment: 1 } },
      });
      return true;
    });
  }
  async clearAttempts(ipKey: string) {
    await this.database.adminLoginRateLimit.deleteMany({
      where: { key: `ip:${ipKey}` },
    });
  }
  create(tokenHash: string, session: AdminSession, now: number) {
    return this.locked(async (tx) => {
      await tx.adminWebSession.deleteMany({
        where: { expiresAt: { lte: new Date(now) } },
      });
      if ((await tx.adminWebSession.count()) >= 1000) return false;
      await tx.adminWebSession.create({
        data: {
          tokenHash,
          csrfToken: session.csrfToken,
          expiresAt: new Date(session.expiresAt),
        },
      });
      return true;
    });
  }
  async get(tokenHash: string, now: number) {
    const session = await this.database.adminWebSession.findUnique({
      where: { tokenHash },
    });
    return session && session.expiresAt.getTime() > now
      ? { csrfToken: session.csrfToken, expiresAt: session.expiresAt.getTime() }
      : null;
  }
  async revoke(tokenHash: string) {
    await this.database.adminWebSession.deleteMany({ where: { tokenHash } });
  }
}
