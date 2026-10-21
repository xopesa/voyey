import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { WarehouseEstimateService } from "../../api/src/modules/admin/warehouse-estimate.js";
import { WEB_ADMIN_ACTOR } from "../../api/src/modules/admin/web-session.js";
import { D1OrderRepository } from "../../api/src/d1/repositories.js";
import { toOrderDto } from "../../api/src/modules/orders/service.js";
import { financeFixture, financeSeed, payment } from "./helpers/finance.js";
import { marketingRuntime } from "./helpers/marketing-runtime.js";
import { runtimeUser } from "./helpers/customer-operations.js";
const service = new WarehouseEstimateService();

test("warehouse date is editable/clearable, audited and idempotent without money/status/stock/payment changes", async () => {
  const f = financeFixture();
  try {
    await f.run(async () => {
      const original = { ...f.sqlite.prepare('SELECT * FROM "Order"').get() };
      for (const status of ["AWAITING_PURCHASE", "PURCHASED", "IN_TRANSIT"]) {
        f.sqlite.prepare('UPDATE "Order" SET status=?').run(status);
        await service.set("STZ-FINANCE", WEB_ADMIN_ACTOR, {
          estimatedWarehouseArrival: "2026-11-05",
        });
        await service.set("STZ-FINANCE", WEB_ADMIN_ACTOR, {
          estimatedWarehouseArrival: "2026-11-05",
        });
        await service.set("STZ-FINANCE", WEB_ADMIN_ACTOR, {
          estimatedWarehouseArrival: null,
        });
      }
      const { estimatedWarehouseArrival, status, updatedAt, ...rest } = f.sqlite
        .prepare('SELECT * FROM "Order"')
        .get()!;
      const {
        estimatedWarehouseArrival: previous,
        status: initialStatus,
        updatedAt: previousUpdate,
        ...before
      } = original;
      assert.equal(estimatedWarehouseArrival, null);
      assert.equal(previous, null);
      assert.equal(initialStatus, "AWAITING_PURCHASE");
      assert.equal(status, "IN_TRANSIT");
      assert.ok(Number(updatedAt) >= Number(previousUpdate));
      assert.deepEqual(rest, before);
      assert.equal(
        f.sqlite.prepare("SELECT COUNT(*) n FROM AuditLog").get()!.n,
        6,
      );
      assert.equal(
        f.sqlite.prepare("SELECT COUNT(*) n FROM Payment").get()!.n,
        0,
      );
    });
  } finally {
    f.sqlite.close();
  }
});

test("reject invalid dates/extra fields and statuses after warehouse arrival or before payment", async () => {
  const f = financeFixture();
  try {
    await f.run(async () => {
      for (const value of [
        "2026-02-29",
        "2026-02-30",
        "2026-13-01",
        "05.11.2026",
        "2026-11-05T00:00:00Z",
        "",
        123,
      ])
        await assert.rejects(
          service.set("STZ-FINANCE", WEB_ADMIN_ACTOR, {
            estimatedWarehouseArrival: value,
          }),
          { statusCode: 400 },
        );
      await assert.rejects(
        service.set("STZ-FINANCE", WEB_ADMIN_ACTOR, {
          estimatedWarehouseArrival: "2026-11-05",
          userId: "other",
        }),
        { statusCode: 400 },
      );
      await assert.rejects(
        service.set("missing", WEB_ADMIN_ACTOR, {
          estimatedWarehouseArrival: null,
        }),
        { statusCode: 404 },
      );
      await service.set("STZ-FINANCE", WEB_ADMIN_ACTOR, {
        estimatedWarehouseArrival: "2028-02-29",
      });
      for (const status of [
        "AWAITING_PREPAYMENT",
        "PREPAYMENT_SUBMITTED",
        "ARRIVED",
        "WEIGHING",
        "AWAITING_FINAL_PAYMENT",
        "FINAL_PAYMENT_SUBMITTED",
        "PAID_FULL",
        "READY_TO_SHIP",
        "SHIPPED",
        "COMPLETED",
        "CANCELLED",
      ]) {
        f.sqlite.prepare('UPDATE "Order" SET status=?').run(status);
        await assert.rejects(
          service.set("STZ-FINANCE", WEB_ADMIN_ACTOR, {
            estimatedWarehouseArrival: null,
          }),
          { statusCode: 409 },
        );
      }
      assert.equal(
        f.sqlite.prepare('SELECT estimatedWarehouseArrival FROM "Order"').get()!
          .estimatedWarehouseArrival,
        "2028-02-29",
      );
    });
  } finally {
    f.sqlite.close();
  }
});

test("customer timestamps come only from approved payments reviewedAt; no submitted/rejected dates or private metadata", async () => {
  const f = financeFixture();
  try {
    await f.run(async () => {
      const repo = new D1OrderRepository();
      const dto = async () =>
        toOrderDto((await repo.getForAdmin("STZ-FINANCE"))!);
      assert.deepEqual((await dto()).paymentConfirmations, {
        prepayment: null,
        final: null,
      });
      const pre = Date.parse("2026-10-21T08:17:00Z"),
        final = Date.parse("2026-10-23T09:20:00Z");
      payment(
        f.sqlite,
        "pre",
        "PREPAYMENT",
        "APPROVED",
        145000,
        pre - 5000,
        pre,
      );
      payment(f.sqlite, "rejected", "FINAL", "REJECTED", 145000, final - 1000);
      assert.equal(
        (await dto()).paymentConfirmations!.prepayment!.getTime(),
        pre,
      );
      assert.equal((await dto()).paymentConfirmations!.final, null);
      payment(
        f.sqlite,
        "final",
        "FINAL",
        "APPROVED",
        145000,
        final - 5000,
        final,
      );
      await service.set("STZ-FINANCE", WEB_ADMIN_ACTOR, {
        estimatedWarehouseArrival: "2026-11-05",
      });
      const result = await dto();
      assert.equal(result.paymentConfirmations!.final!.getTime(), final);
      assert.equal(result.estimatedWarehouseArrival, "2026-11-05");
      assert.deepEqual(Object.keys(result.paymentConfirmations!).sort(), [
        "final",
        "prepayment",
      ]);
      for (const key of [
        "actorId",
        "reviewedBy",
        "proofStorageKey",
        "cancellationNote",
        "dashboardHiddenAt",
      ])
        assert.equal(key in result, false);
      f.sqlite.exec("UPDATE Payment SET reviewedAt=NULL WHERE id='pre'");
      assert.equal((await dto()).paymentConfirmations!.prepayment, null);
    });
  } finally {
    f.sqlite.close();
  }
});

test("migration adds optional date without changing existing order snapshots", () => {
  const db = new DatabaseSync(":memory:");
  try {
    for (const file of readdirSync(new URL("../migrations/", import.meta.url))
      .sort()
      .filter((f) => !f.startsWith("0016_")))
      db.exec(
        readFileSync(new URL("../migrations/" + file, import.meta.url), "utf8"),
      );
    db.exec(financeSeed);
    const before = db.prepare('SELECT * FROM "Order"').get();
    db.exec(
      readFileSync(
        new URL(
          "../migrations/0016_order_warehouse_estimate.sql",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    const { estimatedWarehouseArrival, ...after } = db
      .prepare('SELECT * FROM "Order"')
      .get()!;
    assert.equal(estimatedWarehouseArrival, null);
    assert.deepEqual(after, { ...before });
  } finally {
    db.close();
  }
});

test("Worker ETA requires Admin/CSRF; owner can read but cannot write, foreign owner sees 404; no external notifications", async () => {
  const r = await marketingRuntime();
  try {
    const user = await runtimeUser(r, 88101),
      other = await runtimeUser(r, 88102);
    await r.db
      .prepare(
        `INSERT INTO "Order"(id,publicId,userId,idempotencyKey,status,fullName,phone,city,address,subtotal,total,requiredPrepayment,remainingAmount,updatedAt) VALUES('o','STZ-ETA',?,'eta-fixture-key-0001','PURCHASED','Isolated','0000000','Test','Fixture',290000,290000,145000,145000,1)`,
      )
      .bind(user.id)
      .run();
    const path = "/admin/orders/STZ-ETA/warehouse-estimate",
      body = { estimatedWarehouseArrival: "2026-11-05" };
    assert.equal((await r.call(path, "PATCH", body)).status, 401);
    assert.equal(
      (
        await r.call(path, "PATCH", body, {
          ...r.signed,
          "x-csrf-token": "invalid",
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await r.call(
          path,
          "PATCH",
          body,
          { authorization: "Bearer " + user.token },
          "https://preview.invalid",
        )
      ).status,
      403,
    );
    assert.equal(
      (await r.admin("/orders/STZ-ETA/warehouse-estimate", "PATCH", body))
        .status,
      200,
    );
    assert.equal(
      (
        await r.admin("/orders/STZ-ETA/warehouse-estimate", "PATCH", {
          estimatedWarehouseArrival: "2026-02-30",
        })
      ).status,
      400,
    );
    const response = await r.call(
      "/orders/STZ-ETA",
      "GET",
      undefined,
      { authorization: "Bearer " + user.token },
      "https://preview.invalid",
    );
    assert.equal(response.status, 200);
    const order = (
      (await response.json()) as {
        order: {
          estimatedWarehouseArrival: string;
          paymentConfirmations: object;
          status: string;
        };
      }
    ).order;
    assert.equal(order.estimatedWarehouseArrival, "2026-11-05");
    assert.equal(order.status, "PURCHASED");
    assert.deepEqual(order.paymentConfirmations, {
      prepayment: null,
      final: null,
    });
    assert.equal(
      (
        await r.call(
          "/orders/STZ-ETA",
          "GET",
          undefined,
          { authorization: "Bearer " + other.token },
          "https://preview.invalid",
        )
      ).status,
      404,
    );
    assert.equal(
      (
        await r.call(
          "/orders/STZ-ETA/warehouse-estimate",
          "PATCH",
          body,
          { authorization: "Bearer " + user.token },
          "https://preview.invalid",
        )
      ).status,
      404,
    );
    assert.equal(r.outboundCalls(), 0);
  } finally {
    await r.mf.dispose();
  }
});
