import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { atomic, withDatabase, prisma, type Database } from "@stenzo/database";
import {
  D1UserRepository,
  D1CartRepository,
  D1OrderRepository,
  D1PaymentRepository,
  D1AdminCatalogRepository,
} from "../../api/src/d1/repositories.js";
import { D1AdminSessionStore } from "../../api/src/d1/session-store.js";
import { prepareOrder } from "../../api/src/modules/checkout/domain.js";
import { WEB_ADMIN_ACTOR } from "../../api/src/modules/admin/web-session.js";

function isolated() {
  const sqlite = new DatabaseSync(":memory:");
  for (const file of readdirSync(
    new URL("../migrations/", import.meta.url),
  ).sort())
    sqlite.exec(
      readFileSync(new URL("../migrations/" + file, import.meta.url), "utf8"),
    );
  const prepare = (sql: string, values: unknown[] = []) => ({
    bind: (...v: unknown[]) => {
      assert.ok(v.length <= 100, "D1 parameter limit exceeded");
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
  return { run: <T>(fn: () => T) => withDatabase(db, fn), sqlite };
}
async function fixture() {
  const users = new D1UserRepository(),
    catalog = new D1AdminCatalogRepository();
  const user = await users.createOrUpdateFromTelegram({
    telegramId: 9007199254740993n,
    firstName: "Test",
  });
  const category = await catalog.createCategory(WEB_ADMIN_ACTOR, {
    nameRu: "Одежда",
    nameUz: "Kiyim",
    slug: "clothing",
    sortOrder: 0,
    isActive: true,
  });
  const product = await catalog.createProduct(WEB_ADMIN_ACTOR, {
    categoryId: category.id,
    nameRu: "СВИТЕР",
    nameUz: "KO‘YLAK",
    slug: "sweater",
    descriptionRu: "МОЛОЧНЫЙ",
    descriptionUz: "OQ",
    sourceUrl: null,
    price: 210001,
    currency: "UZS",
    status: "ACTIVE",
    isFeatured: true,
  });
  const variant = await catalog.createVariant(WEB_ADMIN_ACTOR, product.id, {
    sku: "TEST-S",
    size: "S",
    color: "white",
    stock: null,
    isActive: true,
  });
  return { user, category, product, variant, catalog };
}
const recipient = {
  fullName: "Test Buyer",
  phone: "+998901234567",
  city: "Tashkent",
  address: "Test street 1",
  apartment: null,
  comment: null,
};
test("D1 preserves Unicode search, booleans, millisecond dates and exact Telegram IDs", async () => {
  const f = isolated();
  await f.run(async () => {
    const { user, catalog } = await fixture();
    assert.equal(user.telegramId, 9007199254740993n);
    assert.ok(user.createdAt instanceof Date);
    const result = await catalog.listProducts({ search: "свитер", limit: 12 });
    assert.equal(result.products.length, 1);
    assert.equal(result.products[0]?.isFeatured, true);
    assert.equal(
      (await catalog.listProducts({ search: "ko‘ylak", limit: 12 })).products
        .length,
      1,
    );
    assert.equal(
      (await catalog.listProducts({ search: "' OR 1=1 --", limit: 12 }))
        .products.length,
      0,
    );
  });
  f.sqlite.close();
});
test("atomic batches roll back writes, audit rows and revision when a later statement fails", async () => {
  const f = isolated();
  await f.run(async () => {
    const before = f.sqlite.prepare("SELECT version FROM _Revision").get()!;
    await assert.rejects(
      atomic(async (b) => {
        b.insert("Category", {
          id: "bad",
          nameRu: "X",
          nameUz: "X",
          slug: "bad",
          sortOrder: 0,
        });
        b.insert("AuditLog", {
          action: "x",
          entityType: "Category",
          entityId: "bad",
        });
        b.insert("Product", {
          id: "invalid",
          categoryId: "missing",
          nameRu: "x",
          nameUz: "x",
          slug: "bad",
          price: -1,
        });
      }),
    );
    assert.equal(await prisma.category.count(), 0);
    assert.equal(await prisma.auditLog.count(), 0);
    assert.deepEqual(
      f.sqlite.prepare("SELECT version FROM _Revision").get(),
      before,
    );
  });
  f.sqlite.close();
});
test("concurrent checkout creates one order, snapshots items, clears cart once and replays the same key", async () => {
  const f = isolated();
  await f.run(async () => {
    const { user, product, variant } = await fixture();
    const cart = new D1CartRepository();
    await cart.addItem(user.id, {
      productId: product.id,
      variantId: variant.id,
      quantity: 1,
      heightCm: 180,
      weightKg: 75,
    });
    const repo = new D1OrderRepository();
    const input = {
      userId: user.id,
      publicId: "STZ-TEST",
      idempotencyKey: "checkout-test-key-0001",
      recipient,
      prepare: prepareOrder,
    };
    const results = await Promise.all([
      repo.checkout(input),
      repo.checkout({ ...input, publicId: "STZ-OTHER" }),
    ]);
    assert.equal(results.filter((r) => r.created).length, 1);
    assert.equal(results[0]!.order.id, results[1]!.order.id);
    assert.equal(results[0]!.order.total, 210001);
    assert.equal(results[0]!.order.requiredPrepayment, 105001);
    assert.equal((await cart.getOrCreate(user.id)).items.length, 0);
    assert.equal(await prisma.order.count(), 1);
    assert.equal(
      await prisma.auditLog.count({ where: { action: "order.create" } }),
      1,
    );
  });
  f.sqlite.close();
});
test("payment submission/review replays safely and final payment preserves all finance constraints", async () => {
  const f = isolated();
  await f.run(async () => {
    const { user, product, variant } = await fixture();
    await new D1CartRepository().addItem(user.id, {
      productId: product.id,
      variantId: variant.id,
      quantity: 1,
      heightCm: 180,
      weightKg: 75,
    });
    const orders = new D1OrderRepository();
    const { order } = await orders.checkout({
      userId: user.id,
      publicId: "STZ-FINANCE",
      idempotencyKey: "checkout-finance-0001",
      recipient,
      prepare: prepareOrder,
    });
    const p = new D1PaymentRepository();
    const input = {
      userId: user.id,
      orderPublicId: order.publicId,
      idempotencyKey: "payment-test-key-0001",
      proofStorageKey: "payment-proofs/test.png",
      proofMimeType: "image/png",
    };
    const submitted = await Promise.all([
      p.submit(input),
      p.submit({ ...input, proofStorageKey: "payment-proofs/duplicate.png" }),
    ]);
    assert.equal(submitted.filter((r) => r.created).length, 1);
    const reviews = await Promise.all([
      p.approve(submitted[0]!.payment.id, WEB_ADMIN_ACTOR),
      p.approve(submitted[0]!.payment.id, WEB_ADMIN_ACTOR),
    ]);
    assert.equal(reviews.filter((r) => r.changed).length, 1);
    await assert.rejects(
      p.reject(submitted[0]!.payment.id, WEB_ADMIN_ACTOR, "conflict"),
    );
    for (const status of [
      "PURCHASED",
      "IN_TRANSIT",
      "ARRIVED",
      "WEIGHING",
    ] as const)
      await p.transitionOrder(order.publicId, status, WEB_ADMIN_ACTOR);
    await p.requestFinalPayment(order.publicId, 20000, WEB_ADMIN_ACTOR);
    const final = await p.submit({
      ...input,
      idempotencyKey: "payment-final-key-0002",
      proofStorageKey: "payment-proofs/final.png",
    });
    assert.equal(final.payment.expectedAmount, 125000);
    await p.approve(final.payment.id, WEB_ADMIN_ACTOR);
    const done = await orders.getForAdmin(order.publicId);
    assert.equal(done?.status, "PAID_FULL");
    assert.equal(done?.remainingAmount, 0);
    assert.equal(done?.paidAmount, 210001);
    assert.equal(done?.cargoPaidAmount, 20000);
  });
  f.sqlite.close();
});
test("primary-image uniqueness, replacement and foreign keys remain enforced", async () => {
  const f = isolated();
  await f.run(async () => {
    const { catalog, product } = await fixture();
    const a = await catalog.createImage(WEB_ADMIN_ACTOR, product.id, {
      url: "/media/a.png",
      sortOrder: 0,
      isPrimary: false,
    });
    const b = await catalog.createImage(WEB_ADMIN_ACTOR, product.id, {
      url: "/media/b.png",
      sortOrder: 1,
      isPrimary: true,
    });
    assert.equal((await catalog.getImage(a.id))?.isPrimary, false);
    assert.equal(b.isPrimary, true);
    await catalog.deleteImage(WEB_ADMIN_ACTOR, b.id);
    assert.equal((await catalog.getImage(a.id))?.isPrimary, true);
    await assert.rejects(
      atomic(async (batch) => {
        batch.insert("ProductImage", {
          productId: product.id,
          url: "bad",
          sortOrder: 0,
          isPrimary: true,
        });
      }),
    );
  });
  f.sqlite.close();
});
test("D1 durable sessions share revocation/expiry and atomic per-IP login limits", async () => {
  const f = isolated();
  await f.run(async () => {
    const a = new D1AdminSessionStore(),
      b = new D1AdminSessionStore();
    const now = Date.now();
    const results = await Promise.all(
      Array.from({ length: 7 }, () => a.reserveAttempt("same-ip", now)),
    );
    assert.equal(results.filter(Boolean).length, 5);
    assert.equal(await b.reserveAttempt("same-ip", now), false);
    assert.equal(await b.reserveAttempt("same-ip", now + 16 * 60000), true);
    assert.equal(
      await a.create(
        "token-hash",
        { csrfToken: "csrf", expiresAt: now + 1000 },
        now,
      ),
      true,
    );
    assert.deepEqual(await b.get("token-hash", now), {
      csrfToken: "csrf",
      expiresAt: now + 1000,
    });
    assert.equal(await b.get("token-hash", now + 1001), null);
    await b.revoke("token-hash");
    assert.equal(await a.get("token-hash", now), null);
  });
  f.sqlite.close();
});

test("relation loading chunks more than 100 parent keys within D1 parameter limits", async () => {
  const f = isolated();
  try {
    await f.run(async () => {
      const catalog = new D1AdminCatalogRepository();
      for (let i = 0; i < 105; i++) {
        await catalog.createCategory(WEB_ADMIN_ACTOR, {
          nameRu: "Category " + i,
          nameUz: "Category " + i,
          slug: "category-" + i,
          sortOrder: i,
          isActive: true,
        });
      }
      const categories = await prisma.category.findMany({
        include: { products: { where: { status: "ACTIVE" } } },
      });
      assert.equal(categories.length, 105);
      assert.ok(categories.every((category) => category.products.length === 0));
    });
  } finally {
    f.sqlite.close();
  }
});
