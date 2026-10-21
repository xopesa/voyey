import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { withDatabase, type Database } from "@stenzo/database";

export function isolatedD1() {
  const sqlite = new DatabaseSync(":memory:");
  for (const file of readdirSync(
    new URL("../../migrations/", import.meta.url),
  ).sort())
    sqlite.exec(
      readFileSync(
        new URL("../../migrations/" + file, import.meta.url),
        "utf8",
      ),
    );
  const prepare = (sql: string, values: unknown[] = []) => ({
    bind: (...v: unknown[]) => {
      assert.ok(v.length <= 100);
      return prepare(sql, v);
    },
    all: async () => ({
      results: sqlite.prepare(sql).all(...(values as never[])),
    }),
    first: async () => sqlite.prepare(sql).get(...(values as never[])) ?? null,
    run: async () => sqlite.prepare(sql).run(...(values as never[])),
    sql,
    values,
  });
  const db = {
    prepare,
    batch: async (statements: ReturnType<typeof prepare>[]) => {
      sqlite.exec("BEGIN IMMEDIATE");
      try {
        const result = statements.map((s) =>
          sqlite.prepare(s.sql).run(...(s.values as never[])),
        );
        sqlite.exec("COMMIT");
        return result;
      } catch (e) {
        sqlite.exec("ROLLBACK");
        throw e;
      }
    },
  } as unknown as Database;
  return { sqlite, run: <T>(fn: () => T) => withDatabase(db, fn) };
}
