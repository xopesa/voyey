import { randomUUID, randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";
import { PrismaAdminSessionStore } from "../src/modules/admin/prisma-session-store.js";
import { WebAdminSessions } from "../src/modules/admin/web-session.js";

describe.skipIf(process.env.RUN_POSTGRES_TESTS !== "1")(
  "persistent admin auth on isolated PostgreSQL schema",
  () => {
    it("shares sessions, revocation, expiry and atomic limits across warm instances", async () => {
      const { PrismaClient, prisma } =
        await vi.importActual<typeof import("@stenzo/database")>(
          "@stenzo/database",
        );
      const schema = `stz_auth_test_${randomUUID().replaceAll("-", "")}`;
      if (!/^stz_auth_test_[a-f0-9]{32}$/.test(schema))
        throw Error("Unsafe test schema");
      const url = new URL(process.env.DATABASE_URL!);
      if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname))
        throw Error("Persistence test requires local PostgreSQL");
      url.searchParams.set("schema", schema);
      const db = new PrismaClient({ datasourceUrl: url.toString(), log: [] });
      const db2 = new PrismaClient({ datasourceUrl: url.toString(), log: [] });
      await prisma.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
      try {
        const migration = await readFile(
          new URL(
            "../../../packages/database/prisma/migrations/20261001120000_persistent_admin_auth/migration.sql",
            import.meta.url,
          ),
          "utf8",
        );
        for (const statement of migration
          .split(";")
          .map((s) => s.trim())
          .filter(Boolean))
          await db.$executeRawUnsafe(statement);
        const store = new PrismaAdminSessionStore(db),
          other = new PrismaAdminSessionStore(db2);
        let time = Date.now();
        const token = randomBytes(32).toString("base64url");
        const digest = (await import("node:crypto"))
          .createHash("sha256")
          .update(token)
          .digest("hex");
        const session = { csrfToken: "test-csrf", expiresAt: time + 1000 };
        expect(await store.create(digest, session, time)).toBe(true);
        const restarted = new WebAdminSessions(
          "",
          "https://admin.example",
          true,
          () => time,
          other,
        );
        expect(await restarted.get(token)).toEqual(session);
        await restarted.revoke(token);
        expect(await store.get(digest, time)).toBeNull();
        await store.create(digest, session, time);
        time += 1000;
        expect(await restarted.get(token)).toBeNull();
        expect(
          await Promise.all(
            Array.from({ length: 12 }, (_, i) =>
              (i % 2 ? other : store).reserveAttempt("same-client", time),
            ),
          ).then((values) => values.filter(Boolean).length),
        ).toBe(5);
        await other.clearAttempts("same-client");
        expect(await store.reserveAttempt("same-client", time)).toBe(true);
        time += 15 * 60_000;
        const results = await Promise.all(
          Array.from({ length: 40 }, (_, i) =>
            (i % 2 ? other : store).reserveAttempt(`client-${i}`, time),
          ),
        );
        expect(results.filter(Boolean)).toHaveLength(30);
        expect(await db.adminLoginRateLimit.count()).toBeLessThanOrEqual(10001);
        await db.adminWebSession.createMany({
          data: Array.from({ length: 1000 }, (_, i) => ({
            tokenHash: `capacity-${i}`,
            csrfToken: "test",
            expiresAt: new Date(time + 1000),
          })),
        });
        expect(
          await other.create(
            "beyond-capacity",
            { csrfToken: "test", expiresAt: time + 1000 },
            time,
          ),
        ).toBe(false);
      } finally {
        await db.$disconnect();
        await db2.$disconnect();
        // Only the disposable schema generated and validated above; commerce data untouched.
        await prisma.$executeRawUnsafe(`DROP SCHEMA "${schema}" CASCADE`);
      }
    }, 30000);
  },
);
