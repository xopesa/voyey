import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { financeSeed } from "./helpers/finance.js";
test("0013 is additive on a populated legacy 0012 database: no fake reserve/cancellation/refund/archive backfill", () => {
  const db = new DatabaseSync(":memory:");
  try {
    const dir = new URL("../migrations/", import.meta.url);
    for (const file of readdirSync(dir)
      .filter((f) => f < "0013")
      .sort())
      db.exec(readFileSync(new URL(file, dir), "utf8"));
    db.exec(financeSeed);
    db.exec(
      `INSERT INTO Category(id,nameRu,nameUz,slug,updatedAt) VALUES('c','Test','Sinov','c',1);INSERT INTO Product(id,categoryId,nameRu,nameUz,slug,price,status,updatedAt) VALUES('p','c','Test','Sinov','p',1,'ACTIVE',1)`,
    );
    const oldOrder = db.prepare('SELECT * FROM "Order"').get()!,
      oldItem = db.prepare("SELECT * FROM OrderItem").get()!;
    db.exec(
      readFileSync(new URL("0013_order_lifecycle_safety.sql", dir), "utf8"),
    );
    for (const [table, old] of [
      ["Order", oldOrder],
      ["OrderItem", oldItem],
    ] as const) {
      const current = db.prepare(`SELECT * FROM "${table}"`).get()!;
      for (const [key, value] of Object.entries(old))
        assert.equal(current[key], value, table + "." + key);
    }
    const order = db.prepare('SELECT * FROM "Order"').get()!;
    assert.equal(order.cancelledAt, null);
    assert.equal(order.stockReleaseStatus, "NOT_RELEASED");
    assert.equal(
      db.prepare("SELECT inventoryReservedQuantity n FROM OrderItem").get()!.n,
      null,
    );
    assert.equal(db.prepare("SELECT count(*) n FROM Refund").get()!.n, 0);
    assert.equal(
      db.prepare("SELECT archivedAt FROM Product").get()!.archivedAt,
      null,
    );
    assert.equal(
      db.prepare("SELECT archivedAt FROM Category").get()!.archivedAt,
      null,
    );
  } finally {
    db.close();
  }
});
