import { atomic, prisma, D1Conflict } from "@stenzo/database";
import type {
  AdminSession,
  AdminSessionStore,
} from "../modules/admin/session-store.js";
import { adminPrincipalHash } from "./principal.js";
export class D1AdminSessionStore implements AdminSessionStore {
  async reserveAttempt(ipKey: string, now: number) {
    try {
      return await atomic(async (b) => {
        const key = "ip:" + ipKey;
        const [ip, global, count] = await Promise.all([
          prisma.adminLoginRateLimit.findFirst({
            where: { key, expiresAt: { gt: new Date(now) } },
          }),
          prisma.adminLoginRateLimit.findFirst({
            where: { key: "global", expiresAt: { gt: new Date(now) } },
          }),
          prisma.adminLoginRateLimit.count({
            where: { key: { not: "global" }, expiresAt: { gt: new Date(now) } },
          }),
        ]);
        if (
          (ip?.count ?? 0) >= 5 ||
          (global?.count ?? 0) >= 30 ||
          (!ip && count >= 10000)
        )
          return false;
        b.sql('DELETE FROM "AdminLoginRateLimit" WHERE expiresAt<=?', now);
        if (ip)
          b.update("AdminLoginRateLimit", key, { count: ip.count + 1 }, "key");
        else
          b.insert("AdminLoginRateLimit", {
            key,
            count: 1,
            expiresAt: new Date(now + 15 * 60000),
          });
        if (global)
          b.update(
            "AdminLoginRateLimit",
            "global",
            { count: global.count + 1 },
            "key",
          );
        else
          b.insert("AdminLoginRateLimit", {
            key: "global",
            count: 1,
            expiresAt: new Date(now + 60000),
          });
        return true;
      });
    } catch (error) {
      if (error instanceof D1Conflict) return false;
      throw error;
    }
  }
  async clearAttempts(ipKey: string) {
    await atomic(async (b) => {
      b.delete("AdminLoginRateLimit", "key", "ip:" + ipKey);
    });
  }
  async create(tokenHash: string, session: AdminSession, now: number) {
    return atomic(async (b) => {
      if (
        (await prisma.adminWebSession.count({
          where: { expiresAt: { gt: new Date(now) } },
        })) >= 1000
      )
        return false;
      b.sql('DELETE FROM "AdminWebSession" WHERE expiresAt<=?', now);
      b.insert("AdminWebSession", {
        tokenHash,
        csrfToken: session.csrfToken,
        expiresAt: new Date(session.expiresAt),
        principalHash: adminPrincipalHash(),
      });
      return true;
    });
  }
  async get(tokenHash: string, now: number) {
    const session = await prisma.adminWebSession.findUnique({
      where: { tokenHash },
    });
    const owner =
      (session as unknown as { principalHash?: string | null } | null)
        ?.principalHash ?? null;
    return session &&
      owner === adminPrincipalHash() &&
      session.expiresAt.getTime() > now
      ? { csrfToken: session.csrfToken, expiresAt: session.expiresAt.getTime() }
      : null;
  }
  async revoke(tokenHash: string) {
    await atomic(async (b) => {
      b.delete("AdminWebSession", "tokenHash", tokenHash);
    });
  }
}
