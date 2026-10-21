import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { prisma } from "@stenzo/database";
import { CustomerNoteService } from "../../api/src/modules/admin/customer-notes.js";
import { WEB_ADMIN_ACTOR } from "../../api/src/modules/admin/web-session.js";
import { isolatedD1 } from "./helpers/sqlite.js";
import { marketingRuntime } from "./helpers/marketing-runtime.js";
import { runtimeUser } from "./helpers/customer-operations.js";

test("notes trim text, retain append-only history newest first, paginate and audit without copying body", async () => {
  const f = isolatedD1();
  try {
    await f.run(async () => {
      f.sqlite.exec(
        "INSERT INTO User(id,telegramId,updatedAt) VALUES('a',101,1)",
      );
      const s = new CustomerNoteService();
      const a = await s.create("a", WEB_ADMIN_ACTOR, {
          body: "  Private fixture note  ",
        }),
        b = await s.create("a", WEB_ADMIN_ACTOR, {
          body: "Another private note",
        });
      assert.equal(a.body, "Private fixture note");
      assert.equal(a.createdBy, "web-admin");
      f.sqlite
        .prepare("UPDATE CustomerNote SET createdAt=? WHERE id=?")
        .run(1, a.id);
      const page = await s.list("a", 1);
      assert.equal(page.notes[0]!.id, b.id);
      assert.ok(page.nextCursor);
      assert.equal((await s.list("a", 1, page.nextCursor!)).notes[0]!.id, a.id);
      const logs = await prisma.auditLog.findMany({
        where: { action: "customer.note.created" },
      });
      assert.equal(logs.length, 2);
      for (const log of logs) {
        assert.equal(
          JSON.stringify(log.metadata).includes("Private fixture"),
          false,
        );
        assert.equal(
          JSON.stringify(log.metadata).includes("Another private"),
          false,
        );
        assert.ok(JSON.stringify(log.metadata).includes("noteId"));
      }
      assert.equal(await prisma.user.count(), 1);
      await assert.rejects(
        s.create("missing", WEB_ADMIN_ACTOR, { body: "Note" }),
      );
    });
  } finally {
    f.sqlite.close();
  }
});
for (const body of ["", "   ", "x".repeat(2001)])
  test(`notes reject ${body.length} invalid characters`, async () => {
    const f = isolatedD1();
    try {
      await f.run(async () => {
        await assert.rejects(
          new CustomerNoteService().create("a", WEB_ADMIN_ACTOR, { body }),
        );
        assert.equal(await prisma.customerNote.count(), 0);
      });
    } finally {
      f.sqlite.close();
    }
  });
test("notes require Admin auth and CSRF, are absent from public/User APIs and have no edit/delete route", async () => {
  const f = await marketingRuntime();
  try {
    const user = await runtimeUser(f, 940001),
      path = `/customers/${user.id}/notes`;
    assert.equal((await f.call("/admin" + path)).status, 401);
    const noCsrf = { ...f.signed };
    delete (noCsrf as Partial<typeof noCsrf>)["x-csrf-token"];
    assert.equal(
      (
        await f.call(
          "/admin" + path,
          "POST",
          { body: "secret local fixture" },
          noCsrf,
        )
      ).status,
      403,
    );
    const created = await f.admin(path, "POST", { body: "Private local note" });
    assert.equal(created.status, 201);
    const note = (await created.json()) as { note: { id: string } };
    assert.equal((await f.admin(path, "DELETE")).status, 404);
    assert.ok(
      [403, 404].includes(
        (await f.admin(path + "/" + note.note.id, "PATCH", { body: "edited" }))
          .status,
      ),
    );
    const denied = await f.call(
      "/admin" + path,
      "GET",
      undefined,
      { authorization: "Bearer " + user.token },
      "https://preview.invalid",
    );
    assert.ok([401, 403].includes(denied.status));
    const me = await f.call(
      "/me",
      "GET",
      undefined,
      { authorization: "Bearer " + user.token },
      "https://preview.invalid",
    );
    assert.equal(me.status, 200);
    assert.equal((await me.text()).includes("Private local note"), false);
    assert.equal((await f.call(path)).status, 404);
    assert.equal((await f.admin(path)).status, 200);
  } finally {
    await f.mf.dispose();
  }
});
test("0011 is additive, preserves existing order amounts and assigns MINIAPP without business seeds", () => {
  const db = new DatabaseSync(":memory:");
  try {
    const dir = new URL("../migrations/", import.meta.url);
    for (const name of readdirSync(dir)
      .sort()
      .filter((n) => n < "0011"))
      db.exec(readFileSync(new URL(name, dir), "utf8"));
    db.exec(
      `INSERT INTO User(id,telegramId,updatedAt) VALUES('old',100,1);INSERT INTO "Order"(id,publicId,userId,idempotencyKey,fullName,phone,city,address,subtotal,total,requiredPrepayment,remainingAmount,updatedAt) VALUES('old','OLD','old','old','Test','1234567','Test','Test',101,101,51,50,1);`,
    );
    const old = db.prepare('SELECT * FROM "Order"').get()!;
    db.exec(
      readFileSync(
        new URL("0011_customer_notes_and_order_source.sql", dir),
        "utf8",
      ),
    );
    const current = db.prepare('SELECT * FROM "Order"').get()!;
    for (const key of Object.keys(old)) assert.equal(current[key], old[key]);
    assert.equal(current.source, "MINIAPP");
    assert.equal(db.prepare("SELECT count(*) n FROM CustomerNote").get()!.n, 0);
    assert.equal(db.prepare("SELECT count(*) n FROM User").get()!.n, 1);
  } finally {
    db.close();
  }
});
