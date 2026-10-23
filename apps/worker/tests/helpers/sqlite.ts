import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { withDatabase, type Database } from "@stenzo/database";

export function isolatedD1(through = "9999") {
  const sqlite = new DatabaseSync(":memory:");
  for (const file of readdirSync(new URL("../../migrations/", import.meta.url))
    .filter((file) => file.slice(0, 4) <= through.slice(0, 4))
    .sort()) {
    const sql = readFileSync(
      new URL("../../migrations/" + file, import.meta.url),
      "utf8",
    );
    if (file.startsWith("0023_")) {
      sqlite.exec("BEGIN IMMEDIATE");
      try {
        sqlite.exec(sql);
        sqlite.exec("COMMIT");
      } catch (error) {
        sqlite.exec("ROLLBACK");
        throw error;
      }
    } else sqlite.exec(sql);
  }
  const prepare = (sql: string, values: unknown[] = []) => ({
    bind: (...v: unknown[]) => {
      assert.ok(v.length <= 100);
      return prepare(
        sql,
        v.map((value) =>
          value instanceof ArrayBuffer ? new Uint8Array(value) : value,
        ),
      );
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
  return { sqlite, db, run: <T>(fn: () => T) => withDatabase(db, fn) };
}
