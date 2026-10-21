import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { prisma } from "@stenzo/database";
import { ProcurementService } from "../../api/src/modules/admin/finance/procurement.js";
import { WEB_ADMIN_ACTOR } from "../../api/src/modules/admin/web-session.js";
import { OrderService } from "../../api/src/modules/orders/service.js";
import {
  D1OrderRepository,
  D1PaymentRepository,
} from "../../api/src/d1/repositories.js";
import { financeFixture, financeSeed } from "./helpers/finance.js";
import { marketingRuntime } from "./helpers/marketing-runtime.js";
import { runtimeUser } from "./helpers/customer-operations.js";
const service = new ProcurementService();
for (const cost of [0, -1, 2147483648, 1.1, "100", undefined])
  test(`procurement rejects invalid cost ${cost}`, async () => {
    const f = financeFixture();
    try {
      await f.run(async () => {
        await assert.rejects(
          service.update("STZ-FINANCE", "i", WEB_ADMIN_ACTOR, {
            procurementUnitCost: cost,
          }),
        );
        assert.equal(
          (await prisma.orderItem.findUniqueOrThrow({ where: { id: "i" } }))
            .procurementUnitCost,
          null,
        );
        assert.equal(await prisma.auditLog.count(), 0);
      });
    } finally {
      f.sqlite.close();
    }
  });
test("procurement null -> positive -> update -> explicit null keeps audit and exact quantity multiplication", async () => {
  const f = financeFixture();
  try {
    await f.run(async () => {
      const initial = await service.order("STZ-FINANCE");
      assert.equal(initial.costComplete, false);
      assert.equal(initial.profit, null);
      assert.equal(initial.items[0]!.procurementUnitCost, null);
      const first = await service.update("STZ-FINANCE", "i", WEB_ADMIN_ACTOR, {
        procurementUnitCost: 90000,
      });
      assert.equal(first.procurementCost, 180000);
      assert.equal(first.profit, 110000);
      assert.equal(first.items[0]!.procurementLineCost, 180000);
      assert.ok(first.items[0]!.procurementUpdatedAt);
      await service.update("STZ-FINANCE", "i", WEB_ADMIN_ACTOR, {
        procurementUnitCost: 100000,
      });
      await service.update("STZ-FINANCE", "i", WEB_ADMIN_ACTOR, {
        procurementUnitCost: null,
      });
      await service.update("STZ-FINANCE", "i", WEB_ADMIN_ACTOR, {
        procurementUnitCost: null,
      });
      const logs = await prisma.auditLog.findMany({
        where: { action: "order_item.procurement_cost_updated" },
        orderBy: { createdAt: "asc" },
      });
      assert.equal(logs.length, 3);
      assert.deepEqual(
        logs.map((l) => [
          (l.metadata as { previousCost: number | null }).previousCost,
          (l.metadata as { newCost: number | null }).newCost,
        ]),
        [
          [null, 90000],
          [90000, 100000],
          [100000, null],
        ],
      );
      assert.equal(logs[0]!.actorId, null);
      assert.equal((await service.order("STZ-FINANCE")).profit, null);
    });
  } finally {
    f.sqlite.close();
  }
});
test("procurement is private in normal user DTO, historical and bounded to the correct order item", async () => {
  const f = financeFixture();
  try {
    await f.run(async () => {
      await service.update("STZ-FINANCE", "i", WEB_ADMIN_ACTOR, {
        procurementUnitCost: 2147483647,
      });
      const dto = await new OrderService(new D1OrderRepository()).getForUser(
        "finance-user",
        "STZ-FINANCE",
      );
      assert.equal(JSON.stringify(dto).includes("procurement"), false);
      assert.equal(JSON.stringify(dto).includes("profit"), false);
      assert.equal(
        (await service.order("STZ-FINANCE")).procurementCost,
        4294967294,
      );
      await assert.rejects(
        service.update("OTHER", "i", WEB_ADMIN_ACTOR, {
          procurementUnitCost: 1,
        }),
      );
      await assert.rejects(
        service.update("STZ-FINANCE", "other", WEB_ADMIN_ACTOR, {
          procurementUnitCost: 1,
        }),
      );
      f.sqlite.exec(
        "INSERT INTO Category(id,nameRu,nameUz,slug,updatedAt) VALUES('c','A','A','c',1); INSERT INTO Product(id,categoryId,nameRu,nameUz,slug,price,updatedAt) VALUES('p','c','A','A','p',1,1); UPDATE OrderItem SET productId='p' WHERE id='i'; UPDATE Product SET price=2,nameRu='Changed' WHERE id='p';",
      );
      assert.equal(
        (await service.order("STZ-FINANCE")).items[0]!.procurementUnitCost,
        2147483647,
      );
    });
  } finally {
    f.sqlite.close();
  }
});
test("completion timestamp is new-transition-only, replay stable, existing completed null stays null and state machine unchanged", async () => {
  const f = financeFixture();
  try {
    await f.run(async () => {
      const p = new D1PaymentRepository();
      await p.transitionOrder("STZ-FINANCE", "PURCHASED", WEB_ADMIN_ACTOR);
      assert.equal(
        (await prisma.order.findUniqueOrThrow({ where: { id: "o" } }))
          .completedAt,
        null,
      );
      await assert.rejects(
        p.transitionOrder("STZ-FINANCE", "COMPLETED", WEB_ADMIN_ACTOR),
      );
      f.sqlite.exec("UPDATE \"Order\" SET status='SHIPPED' WHERE id='o'");
      await p.transitionOrder("STZ-FINANCE", "COMPLETED", WEB_ADMIN_ACTOR);
      const t = (await prisma.order.findUniqueOrThrow({ where: { id: "o" } }))
        .completedAt;
      assert.ok(t);
      await p.transitionOrder("STZ-FINANCE", "COMPLETED", WEB_ADMIN_ACTOR);
      assert.deepEqual(
        (await prisma.order.findUniqueOrThrow({ where: { id: "o" } }))
          .completedAt,
        t,
      );
      assert.equal(
        await prisma.auditLog.count({ where: { action: "order.completed" } }),
        1,
      );
      f.sqlite.exec('UPDATE "Order" SET completedAt=NULL');
      await p.transitionOrder("STZ-FINANCE", "COMPLETED", WEB_ADMIN_ACTOR);
      assert.equal(
        (await prisma.order.findUniqueOrThrow({ where: { id: "o" } }))
          .completedAt,
        null,
      );
    });
  } finally {
    f.sqlite.close();
  }
});
test("0012 is additive, preserves legacy completed orders without a fabricated date and seeds no finance records", () => {
  const db = new DatabaseSync(":memory:");
  try {
    const folder = new URL("../migrations/", import.meta.url);
    for (const file of readdirSync(folder)
      .sort()
      .filter((f) => f < "0012"))
      db.exec(readFileSync(new URL(file, folder), "utf8"));
    db.exec(financeSeed);
    db.exec("UPDATE \"Order\" SET status='COMPLETED'");
    const before = db.prepare('SELECT * FROM "Order"').get()!;
    db.exec(readFileSync(new URL("0012_finance.sql", folder), "utf8"));
    const after = db.prepare('SELECT * FROM "Order"').get()!;
    assert.equal(after.completedAt, null);
    for (const key of Object.keys(before))
      assert.equal(after[key], before[key]);
    assert.equal(db.prepare("SELECT count(*) n FROM Expense").get()!.n, 0);
    assert.equal(
      db.prepare("SELECT procurementUnitCost FROM OrderItem").get()!
        .procurementUnitCost,
      null,
    );
    assert.throws(
      () => db.exec("UPDATE OrderItem SET procurementUnitCost=0"),
      /CHECK/,
    );
    assert.equal(db.prepare("SELECT count(*) n FROM AuditLog").get()!.n, 0);
  } finally {
    db.close();
  }
});
test("actual Worker procurement requires Admin and CSRF; authenticated customer never sees internal data", async () => {
  const f = await marketingRuntime();
  try {
    for (const sql of financeSeed
      .trim()
      .split(";")
      .map((s) => s.trim())
      .filter(Boolean))
      await f.db.prepare(sql).run();
    const user = await runtimeUser(f, 980002);
    await f.db.prepare('UPDATE "Order" SET userId=?').bind(user.id).run();
    const path = "/admin/orders/STZ-FINANCE/items/i/procurement-cost",
      body = { procurementUnitCost: 90000 };
    assert.equal((await f.call(path, "PATCH", body)).status, 401);
    const noCsrf = { ...f.signed };
    delete (noCsrf as Partial<typeof noCsrf>)["x-csrf-token"];
    assert.equal((await f.call(path, "PATCH", body, noCsrf)).status, 403);
    assert.equal(
      (await f.call("/admin/orders/STZ-FINANCE/finance")).status,
      401,
    );
    assert.equal((await f.call(path, "PATCH", body, f.signed)).status, 200);
    const r = await f.call(
      "/orders/STZ-FINANCE",
      "GET",
      undefined,
      { authorization: "Bearer " + user.token },
      "https://preview.invalid",
    );
    assert.equal(r.status, 200);
    const dto = await r.text();
    assert.equal(dto.includes("procurement"), false);
    assert.equal(dto.includes("margin"), false);
    assert.equal(dto.includes("profit"), false);
    assert.equal((await f.admin("/orders/STZ-FINANCE/finance")).status, 200);
    assert.equal(f.outboundCalls(), 0);
  } finally {
    await f.mf.dispose();
  }
});
