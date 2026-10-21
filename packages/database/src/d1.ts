import { AsyncLocalStorage } from "node:async_hooks";
import { models as schema } from "./d1-schema.js";
export interface Statement {
  bind(...values: unknown[]): Statement;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  run(): Promise<unknown>;
}
export interface Database {
  prepare(sql: string): Statement;
  batch(statements: Statement[]): Promise<unknown[]>;
}
type Row = Record<string, unknown>;
type Relation = {
  table: string;
  local: string;
  foreign: string;
  many: boolean;
};
type Model = {
  fields: Record<string, { type: string; updated: boolean }>;
  relations: Record<string, Relation>;
};
const models = schema as unknown as Record<string, Model>;
const context = new AsyncLocalStorage<Database>();
export const withDatabase = <T>(database: Database, operation: () => T): T =>
  context.run(database, operation);
export function database(): Database {
  const db = context.getStore();
  if (!db) throw new Error("D1 request context required");
  return db;
}
export const fold = (s: string) => s.normalize("NFKC").toLocaleLowerCase("und");
const searchFields = new Set([
  "nameRu",
  "nameUz",
  "descriptionRu",
  "descriptionUz",
  "slug",
  "publicId",
]);
export function bindValue(value: unknown): unknown {
  return value instanceof Date
    ? value.getTime()
    : typeof value === "bigint"
      ? value.toString()
      : typeof value === "boolean"
        ? Number(value)
        : value !== null && typeof value === "object"
          ? JSON.stringify(value)
          : value;
}
function identifier(value: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value))
    throw new Error("Unsafe SQL identifier");
  return `"${value}"`;
}
function whereSQL(
  table: string,
  where: Row = {},
  alias = "t",
  values: unknown[] = [],
): string {
  const clauses: string[] = [];
  const m = models[table]!;
  for (const [key, v] of Object.entries(where)) {
    if (v === undefined) continue;
    if (key === "AND" || key === "OR" || key === "NOT") {
      const parts = (Array.isArray(v) ? v : [v]).map((x) =>
        whereSQL(table, x as Row, alias, values),
      );
      clauses.push(
        `${key === "NOT" ? "NOT " : ""}(${parts.join(key === "OR" ? " OR " : " AND ") || "0"})`,
      );
      continue;
    }
    const rel = m.relations[key];
    if (rel) {
      const a = alias + "_r";
      const nested = (v as Row).some ?? (v as Row).is ?? v;
      clauses.push(
        `EXISTS (SELECT 1 FROM ${identifier(rel.table)} ${a} WHERE ${a}.${identifier(rel.foreign)}=${alias}.${identifier(rel.local)} AND ${whereSQL(rel.table, nested as Row, a, values)})`,
      );
      continue;
    }
    if (!m.fields[key]) {
      if (v && typeof v === "object") {
        clauses.push(whereSQL(table, v as Row, alias, values));
        continue;
      }
      throw new Error("Unknown D1 field");
    }
    const field = `${alias}.${identifier(key)}`;
    const compare = (op: string, value: unknown) => {
      values.push(bindValue(value));
      return `${field} ${op} ?`;
    };
    if (v === null) clauses.push(`${field} IS NULL`);
    else if (typeof v !== "object" || v instanceof Date)
      clauses.push(compare("=", v));
    else
      for (const [op, operand] of Object.entries(v)) {
        if (op === "mode") continue;
        if (op === "contains") {
          const insensitive = (v as Row).mode === "insensitive";
          const col =
            insensitive && searchFields.has(key)
              ? `${alias}.${identifier(key + "__fold")}`
              : field;
          const term = insensitive ? fold(String(operand)) : String(operand);
          values.push(term);
          clauses.push(`instr(${col}, ?) > 0`);
        } else if (op === "in" || op === "notIn") {
          const list = operand as unknown[];
          values.push(...list.map(bindValue));
          clauses.push(
            list.length
              ? `${field} ${op === "notIn" ? "NOT " : ""}IN (${list.map(() => "?").join(",")})`
              : op === "in"
                ? "0"
                : "1",
          );
        } else if (op === "not")
          clauses.push(
            operand === null ? `${field} IS NOT NULL` : compare("!=", operand),
          );
        else {
          const sign: Record<string, string> = {
            equals: "=",
            gt: ">",
            gte: ">=",
            lt: "<",
            lte: "<=",
          };
          if (!sign[op]) throw new Error("Unsupported D1 predicate");
          clauses.push(compare(sign[op], operand));
        }
      }
  }
  return clauses.join(" AND ") || "1";
}
type Query = {
  where?: Row;
  include?: Record<string, Query | boolean>;
  select?: Record<string, Query | boolean>;
  orderBy?: Row | Row[];
  take?: number;
  cursor?: { id: string };
  skip?: number;
};
function decode(table: string, row: Row): Row {
  const result = { ...row };
  for (const [key, f] of Object.entries(models[table]!.fields))
    if (result[key] !== null && result[key] !== undefined) {
      if (f.type === "DateTime")
        result[key] = new Date(
          typeof result[key] === "number"
            ? (result[key] as number)
            : String(result[key]),
        );
      else if (f.type === "Boolean") result[key] = Boolean(result[key]);
      else if (f.type === "BigInt") result[key] = BigInt(String(result[key]));
      else if (f.type === "Json") result[key] = JSON.parse(String(result[key]));
    }
  for (const key of Object.keys(result))
    if (key.endsWith("__fold")) delete result[key];
  return result;
}
async function hydrate(
  table: string,
  rows: Row[],
  query: Query,
): Promise<Row[]> {
  if (!rows.length) return rows;
  const selected = query.include ?? query.select ?? {};
  for (const [name, option] of Object.entries(selected)) {
    const r = models[table]!.relations[name];
    if (!r || !option) continue;
    const args = typeof option === "boolean" ? {} : option;
    const keys = [
      ...new Set(
        rows
          .map((row) => row[r.local])
          .filter((x) => x !== null && x !== undefined),
      ),
    ];
    const filterValues: unknown[] = [];
    whereSQL(r.table, args.where, "t", filterValues);
    const chunkSize = 100 - filterValues.length;
    if (chunkSize < 1)
      throw new Error("D1 relation filter exceeds parameter budget");
    const related: Row[] = [];
    for (let offset = 0; offset < keys.length; offset += chunkSize) {
      related.push(
        ...(await readMany(r.table, {
          ...args,
          take: undefined,
          select: undefined,
          where: {
            AND: [
              args.where ?? {},
              { [r.foreign]: { in: keys.slice(offset, offset + chunkSize) } },
            ],
          },
        })),
      );
    }
    for (const row of rows) {
      const matching = related.filter(
        (x) => String(x[r.foreign]) === String(row[r.local]),
      );
      row[name] = r.many
        ? matching
            .slice(0, args.take ?? matching.length)
            .map((x) => project(x, args))
        : matching[0]
          ? project(matching[0], args)
          : null;
    }
  }
  return rows;
}
function project(row: Row, query: Query): Row {
  return query.select
    ? Object.fromEntries(
        Object.keys(query.select)
          .filter((k) => query.select![k])
          .map((k) => [k, row[k]]),
      )
    : row;
}
export async function readMany(
  table: string,
  query: Query = {},
): Promise<Row[]> {
  const values: unknown[] = [];
  let filter = whereSQL(table, query.where, "t", values);
  const order = (
    Array.isArray(query.orderBy) ? query.orderBy : [query.orderBy ?? {}]
  ).flatMap((x) => Object.entries(x));
  if (query.cursor) {
    const c = await database()
      .prepare(`SELECT * FROM ${identifier(table)} WHERE id=?`)
      .bind(query.cursor.id)
      .first<Row>();
    if (!c) return [];
    if (order.length && !order.every(([, d]) => d === order[0]![1]))
      throw new Error("Mixed cursor directions unsupported");
    const cols = order.length ? order : [["id", "asc"]];
    filter += ` AND (${cols.map(([key]) => `t.${identifier(key!)}`).join(",")}) ${cols[0]![1] === "desc" ? "<" : ">"} (${cols.map(() => "?").join(",")})`;
    values.push(...cols.map(([key]) => c[key!]));
  }
  let sql = `SELECT t.* FROM ${identifier(table)} t WHERE ${filter}`;
  if (order.length)
    sql += ` ORDER BY ${order.map(([key, dir]) => `t.${identifier(key)} ${dir === "desc" ? "DESC" : "ASC"}`).join(",")}`;
  if (query.take !== undefined) {
    sql += " LIMIT ?";
    values.push(query.take);
  }
  const { results } = await database()
    .prepare(sql)
    .bind(...values)
    .all<Row>();
  return (
    await hydrate(
      table,
      results.map((row) => decode(table, row)),
      query,
    )
  ).map((row) => project(row, query));
}
export const readClient = new Proxy(
  {},
  {
    get(_target, name: string) {
      if (name === "$queryRaw")
        return async () => database().prepare("SELECT 1 AS ok").all();
      if (name === "$disconnect") return async () => {};
      const table = name[0]?.toUpperCase() + name.slice(1);
      if (!models[table])
        return () => {
          throw new Error(
            "Interactive Prisma writes are disabled in the D1 runtime",
          );
        };
      return {
        findMany: (q: Query) => readMany(table, q),
        findFirst: async (q: Query) =>
          (await readMany(table, { ...q, take: 1 }))[0] ?? null,
        findUnique: async (q: Query) =>
          (await readMany(table, { ...q, take: 1 }))[0] ?? null,
        findUniqueOrThrow: async (q: Query) => {
          const row = (await readMany(table, { ...q, take: 1 }))[0];
          if (!row)
            throw Object.assign(new Error("Record not found"), {
              code: "P2025",
            });
          return row;
        },
        count: async (q: Query = {}) => {
          const values: unknown[] = [];
          const where = whereSQL(table, q.where, "t", values);
          const r = await database()
            .prepare(
              `SELECT count(*) AS n FROM ${identifier(table)} t WHERE ${where}`,
            )
            .bind(...values)
            .first<{ n: number }>();
          return r!.n;
        },
      };
    },
  },
);
export class D1Conflict extends Error {}
export class Batch {
  readonly statements: Statement[] = [];
  sql(sql: string, ...values: unknown[]): void {
    this.statements.push(
      database()
        .prepare(sql)
        .bind(...values.map(bindValue)),
    );
  }
  insert(table: string, input: Row): string {
    const m = models[table]!;
    const data = { ...input };
    if (m.fields.id && !data.id) data.id = crypto.randomUUID();
    for (const [k, f] of Object.entries(m.fields))
      if ((k === "createdAt" || f.updated) && data[k] === undefined)
        data[k] = new Date();
    this.fold(data);
    const keys = Object.keys(data).filter((k) => data[k] !== undefined);
    this.sql(
      `INSERT INTO ${identifier(table)} (${keys.map(identifier).join(",")}) VALUES (${keys.map(() => "?").join(",")})`,
      ...keys.map((k) => data[k]),
    );
    return String(data.id ?? data.tokenHash ?? data.key);
  }
  update(table: string, id: string, input: Row, key = "id"): void {
    const data = { ...input };
    for (const [k, f] of Object.entries(models[table]!.fields))
      if (f.updated) data[k] = new Date();
    this.fold(data);
    const keys = Object.keys(data).filter((k) => data[k] !== undefined);
    if (!keys.length) return;
    this.sql(
      `UPDATE ${identifier(table)} SET ${keys.map((k) => `${identifier(k)}=?`).join(",")} WHERE ${identifier(key)}=?`,
      ...keys.map((k) => data[k]),
      id,
    );
  }
  delete(table: string, key: string, value: unknown): void {
    this.sql(
      `DELETE FROM ${identifier(table)} WHERE ${identifier(key)}=?`,
      value,
    );
  }
  private fold(data: Row): void {
    for (const [k, v] of Object.entries(data))
      if (searchFields.has(k))
        data[k + "__fold"] = typeof v === "string" ? fold(v) : null;
  }
}
async function revision(): Promise<number> {
  const result = await database()
    .prepare('SELECT version FROM "_Revision" WHERE id=1')
    .first<{ version: number }>();
  if (!result) throw new Error("D1 migrations missing");
  return result.version;
}
// Every write increments the SQL revision. All queued writes and the snapshot guard
// commit in one D1 batch. Callbacks may read/enqueue writes, never external side effects.
export async function atomic<T>(
  operation: (batch: Batch) => Promise<T>,
): Promise<T> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const version = await revision(),
      batch = new Batch();
    let result: T;
    try {
      result = await operation(batch);
    } catch (error) {
      if ((await revision()) !== version) continue;
      throw error;
    }
    const token = crypto.randomUUID();
    const guard = database()
      .prepare(
        'INSERT INTO "_BatchGuard" (id,ok) SELECT ?,CASE WHEN version=? THEN 1 ELSE 0 END FROM "_Revision" WHERE id=1',
      )
      .bind(token, version);
    const cleanup = database()
      .prepare('DELETE FROM "_BatchGuard" WHERE id=?')
      .bind(token);
    try {
      await database().batch([guard, ...batch.statements, cleanup]);
      return result;
    } catch (error) {
      if ((await revision()) !== version) continue;
      throw error;
    }
  }
  throw new D1Conflict("Concurrent database change; retry request");
}
