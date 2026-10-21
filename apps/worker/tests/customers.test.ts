import test from "node:test";
import assert from "node:assert/strict";
import {
  CustomerService,
  customerQuery,
} from "../../api/src/modules/admin/customers.js";
import { isolatedD1 } from "./helpers/sqlite.js";
import { marketingRuntime } from "./helpers/marketing-runtime.js";

export function customerFixture() {
  const f = isolatedD1();
  f.sqlite
    .exec(`INSERT INTO User(id,telegramId,username,firstName,lastName,status,createdAt,updatedAt) VALUES
    ('a',1001,'alice_fixture','Alice','Fixture','ACTIVE',10,11),('b',1002,'bob_fixture','Bob','Empty','ACTIVE',10,10),('c',1003,NULL,'Blocked','Buyer','BLOCKED',9,9),('d',1004,'deleted_fixture','Deleted','Fixture','DELETED',8,8);
    INSERT INTO "Order"(id,publicId,userId,idempotencyKey,fullName,phone,city,address,apartment,subtotal,total,requiredPrepayment,remainingAmount,paidAmount,status,createdAt,updatedAt) VALUES
    ('old','STZ-OLD','a','old','Old recipient','9981111111','Old city','Old address',NULL,290001,290001,145001,289991,10,'COMPLETED',20,20),
    ('middle','STZ-MIDDLE','a','middle','Middle recipient','9982222222','Middle city','Middle address',NULL,290001,290001,145001,289991,10,'AWAITING_PURCHASE',30,30),
    ('new','STZ-NEW','a','new','Newest recipient','9983333333','New city','New address','10',290001,290001,145001,289991,10,'AWAITING_PREPAYMENT',30,30),
    ('cancel','STZ-CANCEL','c','cancel','Blocked recipient','9984444444','City','Address',NULL,290001,290001,145001,145000,0,'CANCELLED',25,25);
    INSERT INTO Payment(id,orderId,type,status,expectedAmount,idempotencyKey,proofStorageKey,proofMimeType,submittedAt,updatedAt) VALUES
    ('pre','old','PREPAYMENT','APPROVED',100,'pre','private-fixture-pre','image/png',40,40),
    ('final','old','FINAL','APPROVED',70,'final','private-fixture-final','image/png',41,41),
    ('reject','new','PREPAYMENT','REJECTED',999,'reject','private-fixture-reject','image/png',42,42),
    ('submit','new','PREPAYMENT','SUBMITTED',777,'submit','private-fixture-submit','image/png',43,43);`);
  return f;
}
const q = (input = {}) => customerQuery.parse(input);
test("customer pagination is stable by creation time then ID, bounded and without duplicates", async () => {
  const f = customerFixture();
  try {
    await f.run(async () => {
      const s = new CustomerService(),
        a = await s.list(q({ limit: 2 }));
      assert.deepEqual(
        a.customers.map((c) => c.id),
        ["b", "a"],
      );
      assert.ok(a.nextCursor);
      const b = await s.list(q({ limit: 2, cursor: a.nextCursor }));
      assert.deepEqual(
        b.customers.map((c) => c.id),
        ["c", "d"],
      );
      assert.equal(b.nextCursor, null);
      assert.equal(q().limit, 20);
      assert.equal(customerQuery.safeParse({ limit: 51 }).success, false);
      await assert.rejects(s.list(q({ cursor: "invalid" })));
      assert.equal(
        customerQuery.safeParse({ search: "x".repeat(101) }).success,
        false,
      );
    });
  } finally {
    f.sqlite.close();
  }
});
for (const [search, expected] of [
  ["1001", "a"],
  ["@ALICE", "a"],
  ["alice", "a"],
  ["Fixture", "a"],
  ["333333", "a"],
  ["' OR 1=1 --", null],
] as const)
  test(`customer literal search ${search}`, async () => {
    const f = customerFixture();
    try {
      await f.run(async () => {
        const page = await new CustomerService().list(q({ search }));
        if (expected) assert.ok(page.customers.some((c) => c.id === expected));
        else assert.equal(page.customers.length, 0);
      });
    } finally {
      f.sqlite.close();
    }
  });
for (const [filter, expected] of [
  ["active", ["b", "a"]],
  ["blocked", ["c"]],
  ["with-orders", ["a", "c"]],
  ["no-orders", ["b", "d"]],
] as const)
  test(`customer filter ${filter}`, async () => {
    const f = customerFixture();
    try {
      await f.run(async () =>
        assert.deepEqual(
          (await new CustomerService().list(q({ filter }))).customers.map(
            (c) => c.id,
          ),
          expected,
        ),
      );
    } finally {
      f.sqlite.close();
    }
  });
test("customer aggregates approved payments once, exclude rejected/submitted, count active/completed and select latest recipient", async () => {
  const f = customerFixture();
  try {
    await f.run(async () => {
      const c = await new CustomerService().card("a");
      assert.equal(c.telegramId, "1001");
      assert.equal(c.orderCount, 3);
      assert.equal(c.activeOrders, 2);
      assert.equal(c.completedOrders, 1);
      assert.equal(c.approvedPayments, 170);
      assert.equal(c.prepayments, 100);
      assert.equal(c.finalPayments, 70);
      assert.equal(c.latestOrder?.publicId, "STZ-NEW");
      assert.equal(c.lastInteractionAt, new Date(43).toISOString());
      assert.equal(c.latestRecipient?.fullName, "Newest recipient");
      assert.equal(c.latestRecipient?.apartment, "10");
      const serialized = JSON.stringify(c);
      for (const key of [
        "proofStorageKey",
        "csrfToken",
        "JWT",
        "private-fixture",
      ])
        assert.equal(serialized.includes(key), false);
      const empty = await new CustomerService().card("b");
      assert.equal(empty.orderCount, 0);
      assert.equal(empty.approvedPayments, 0);
      assert.equal(empty.latestRecipient, null);
      assert.equal((await new CustomerService().card("c")).activeOrders, 0);
      await assert.rejects(new CustomerService().card("missing"));
    });
  } finally {
    f.sqlite.close();
  }
});
test("customer history is owner-scoped and paginated newest first with approved paid amounts", async () => {
  const f = customerFixture();
  try {
    await f.run(async () => {
      const s = new CustomerService(),
        first = await s.orders("a", { limit: 2 });
      assert.deepEqual(
        first.orders.map((o) => o.publicId),
        ["STZ-NEW", "STZ-MIDDLE"],
      );
      assert.equal(first.orders[0]!.paid, 0);
      const second = await s.orders("a", {
        limit: 2,
        cursor: first.nextCursor!,
      });
      assert.equal(second.orders[0]!.publicId, "STZ-OLD");
      assert.equal(second.orders[0]!.paid, 170);
      assert.equal(second.nextCursor, null);
      assert.equal((await s.orders("b", { limit: 20 })).orders.length, 0);
      await assert.rejects(s.orders("missing", { limit: 20 }));
    });
  } finally {
    f.sqlite.close();
  }
});
test("real Worker customer directory/card/history are Admin only and mutations are not admitted", async () => {
  const f = await marketingRuntime();
  try {
    for (const path of [
      "/customers",
      "/customers/missing",
      "/customers/missing/orders",
    ])
      assert.equal((await f.call("/admin" + path)).status, 401);
    assert.equal((await f.admin("/customers")).status, 200);
    assert.equal((await f.admin("/customers/missing")).status, 404);
    assert.equal((await f.admin("/customers?limit=51")).status, 400);
    assert.equal((await f.admin("/customers?cursor=bad")).status, 400);
    assert.equal((await f.admin("/customers", "POST", {})).status, 404);
    assert.equal((await f.call("/customers")).status, 404);
  } finally {
    await f.mf.dispose();
  }
});
