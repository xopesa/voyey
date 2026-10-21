import test from "node:test";
import assert from "node:assert/strict";
import { prisma } from "@stenzo/database";
import { ExpenseService } from "../../api/src/modules/admin/finance/expenses.js";
import { WEB_ADMIN_ACTOR } from "../../api/src/modules/admin/web-session.js";
import { financeFixture } from "./helpers/finance.js";
import { marketingRuntime } from "./helpers/marketing-runtime.js";
const service = new ExpenseService();
const input = {
  category: "CARGO",
  amount: 60000,
  occurredAt: "2026-10-20T00:00",
  description: "  Isolated expense  ",
  orderPublicId: "STZ-FINANCE",
};
for (const [name, patch] of [
  ["zero", { amount: 0 }],
  ["negative", { amount: -1 }],
  ["decimal", { amount: 1.5 }],
  ["above int32", { amount: 2147483648 }],
  ["invalid category", { category: "PROCUREMENT" }],
  ["long description", { description: "x".repeat(501) }],
  ["invalid order", { orderPublicId: "MISSING" }],
  ["invalid date", { occurredAt: "2026-02-30T00:00" }],
  ["client timezone", { occurredAt: "2026-10-20T00:00Z" }],
  ["server fields", { createdBy: "spoof" }],
] as const)
  test(`expense rejects ${name} atomically`, async () => {
    const f = financeFixture();
    try {
      await f.run(async () => {
        await assert.rejects(
          service.save(WEB_ADMIN_ACTOR, { ...input, ...patch }),
        );
        assert.equal(await prisma.expense.count(), 0);
        assert.equal(await prisma.auditLog.count(), 0);
      });
    } finally {
      f.sqlite.close();
    }
  });
test("global and linked expenses use explicit Tashkent time, positive Int32, trimmed description and safe audit", async () => {
  const f = financeFixture();
  try {
    await f.run(async () => {
      const linked = await service.save(WEB_ADMIN_ACTOR, input),
        global = await service.save(WEB_ADMIN_ACTOR, {
          ...input,
          amount: 2147483647,
          orderPublicId: null,
          description: " ",
        });
      assert.equal(linked.occurredAt, "2026-10-19T19:00:00.000Z");
      assert.equal(linked.description, "Isolated expense");
      assert.equal(linked.orderPublicId, "STZ-FINANCE");
      assert.equal(global.orderPublicId, null);
      assert.equal(global.description, null);
      assert.equal(linked.createdBy, "web-admin");
      assert.equal(JSON.stringify(linked).includes("orderId"), false);
      const log = (
        await prisma.auditLog.findMany({ where: { action: "expense.create" } })
      )[0]!;
      assert.equal(log.actorId, null);
      assert.equal((log.metadata as { orderId: string }).orderId, "o");
      assert.equal(
        JSON.stringify(log.metadata).includes("Isolated expense"),
        false,
      );
    });
  } finally {
    f.sqlite.close();
  }
});
test("edit optimistic timestamp, idempotent void, audit history and no unvoid/update after void", async () => {
  const f = financeFixture();
  try {
    await f.run(async () => {
      const first = await service.save(WEB_ADMIN_ACTOR, input);
      const edit = await service.save(
        WEB_ADMIN_ACTOR,
        { ...input, amount: 65000, expectedUpdatedAt: first.updatedAt },
        first.id,
      );
      assert.equal(edit.amount, 65000);
      assert.ok(Date.parse(edit.updatedAt) > Date.parse(first.updatedAt));
      await assert.rejects(
        service.save(
          WEB_ADMIN_ACTOR,
          { ...input, expectedUpdatedAt: first.updatedAt },
          first.id,
        ),
      );
      await assert.rejects(
        service.save(
          WEB_ADMIN_ACTOR,
          { ...input, expectedUpdatedAt: "2000-01-01T00:00:00.000Z" },
          first.id,
        ),
      );
      const v = await service.void(WEB_ADMIN_ACTOR, first.id);
      assert.ok(v.voidedAt);
      assert.equal(
        (await service.void(WEB_ADMIN_ACTOR, first.id)).voidedAt,
        v.voidedAt,
      );
      await assert.rejects(service.save(WEB_ADMIN_ACTOR, input, first.id));
      await assert.rejects(
        service.save(WEB_ADMIN_ACTOR, { ...input, voidedAt: null }, first.id),
      );
      assert.equal(await prisma.expense.count(), 1);
      assert.equal((await service.list({})).expenses.length, 0);
      assert.equal(
        (await service.list({ state: "voided" })).expenses.length,
        1,
      );
      assert.equal(
        await prisma.auditLog.count({ where: { action: "expense.create" } }),
        1,
      );
      assert.equal(
        await prisma.auditLog.count({ where: { action: "expense.update" } }),
        1,
      );
      assert.equal(
        await prisma.auditLog.count({ where: { action: "expense.void" } }),
        1,
      );
    });
  } finally {
    f.sqlite.close();
  }
});
test("expense cursor ordering, bounds and category/date/order/state filters remain paginated", async () => {
  const f = financeFixture();
  try {
    await f.run(async () => {
      for (let i = 0; i < 4; i++)
        await service.save(WEB_ADMIN_ACTOR, {
          ...input,
          category: i === 0 ? "PACKAGING" : "CARGO",
          orderPublicId: i === 1 ? null : "STZ-FINANCE",
          occurredAt: i === 3 ? "2026-10-21T00:00" : input.occurredAt,
        });
      const a = await service.list({ limit: 2 }),
        b = await service.list({ limit: 2, cursor: a.nextCursor });
      assert.equal(
        new Set([...a.expenses, ...b.expenses].map((e) => e.id)).size,
        4,
      );
      assert.equal(b.nextCursor, null);
      assert.equal(
        (await service.list({ category: "PACKAGING" })).expenses.length,
        1,
      );
      assert.equal(
        (await service.list({ order: "STZ-FINANCE" })).expenses.length,
        3,
      );
      assert.equal(
        (await service.list({ from: "2026-10-20", to: "2026-10-20" })).expenses
          .length,
        3,
      );
      await assert.rejects(service.list({ limit: 51 }));
      await assert.rejects(service.list({ cursor: "bad" }));
      await assert.rejects(service.list({ from: "2026-10-20" }));
    });
  } finally {
    f.sqlite.close();
  }
});
test("actual expense routes require Admin/CSRF and expose no hard-delete endpoint", async () => {
  const f = await marketingRuntime();
  try {
    const body = { ...input, orderPublicId: null };
    assert.equal((await f.call("/admin/finance/expenses")).status, 401);
    assert.equal(
      (await f.call("/admin/finance/expenses", "POST", body)).status,
      401,
    );
    const noCsrf = { ...f.signed };
    delete (noCsrf as Partial<typeof noCsrf>)["x-csrf-token"];
    assert.equal(
      (await f.call("/admin/finance/expenses", "POST", body, noCsrf)).status,
      403,
    );
    const created = await f.admin("/finance/expenses", "POST", body);
    assert.equal(created.status, 201);
    const id = ((await created.json()) as { expense: { id: string } }).expense
      .id;
    assert.equal(
      (await f.admin("/finance/expenses/" + id, "DELETE")).status,
      404,
    );
    assert.equal(
      (await f.admin("/finance/expenses/" + id + "/void", "POST")).status,
      200,
    );
    assert.equal(
      (await f.admin("/finance/expenses/" + id + "/void", "POST")).status,
      200,
    );
    assert.equal(
      (await f.db
        .prepare("SELECT count(*) n FROM Expense")
        .first<{ n: number }>())!.n,
      1,
    );
    assert.equal(f.outboundCalls(), 0);
  } finally {
    await f.mf.dispose();
  }
});
