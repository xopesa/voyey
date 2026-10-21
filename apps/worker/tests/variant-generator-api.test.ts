import test from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Miniflare, Log, LogLevel, convertV4MiniflareOptions } from "miniflare";

test("real Worker generator requires Admin session and CSRF; previews read-only, validates body and applies atomically", async () => {
  const login = "fixture_generator",
    proof = randomBytes(32).toString("hex");
  const mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      scriptPath: fileURLToPath(new URL("../dist/index.js", import.meta.url)),
      compatibilityDate: "2026-10-15",
      compatibilityFlags: ["nodejs_compat"],
      d1Databases: ["DB"],
      log: new Log(LogLevel.NONE),
      serviceBindings: {
        ASSETS: async () => new Response("missing", { status: 404 }),
      },
      bindings: {
        PREVIEW_ONLY: "1",
        COMMERCE_ENABLED: "1",
        ADMIN_AUTH_MODE: "password",
        PUBLIC_ORIGIN: "https://preview.invalid",
        ADMIN_ORIGIN: "https://admin.preview.invalid",
        JWT_SECRET: randomBytes(32).toString("hex"),
        ADMIN_PROXY_SECRET: randomBytes(32).toString("hex"),
        ADMIN_PANEL_LOGIN: login,
        ADMIN_PANEL_PASSWORD_HASH: `pbkdf2-sha256$600000$${randomBytes(32).toString("hex")}$${createHash("sha256").update(Buffer.from(proof, "hex")).digest("hex")}`,
      },
      outboundService: async () => {
        throw new Error("Generator must not make external requests");
      },
    }),
  );
  try {
    const db = await mf.getD1Database("DB");
    for (const file of readdirSync(
      new URL("../migrations/", import.meta.url),
    ).sort())
      for (const sql of readFileSync(
        new URL("../migrations/" + file, import.meta.url),
        "utf8",
      )
        .split(/;\r?\n/)
        .map((s) => s.trim())
        .filter(Boolean))
        await db.prepare(sql).run();
    await db
      .prepare(
        "INSERT INTO Category(id,nameRu,nameUz,slug,updatedAt) VALUES('category','Test','Test','test',1)",
      )
      .run();
    await db
      .prepare(
        "INSERT INTO Product(id,categoryId,nameRu,nameUz,slug,price,updatedAt) VALUES('product','category','Test','Test','test',100,1)",
      )
      .run();
    const base = {
      origin: "https://admin.preview.invalid",
      "x-stenzo-admin": "1",
      "content-type": "application/json",
    };
    const call = (
      path: string,
      headers: Record<string, string>,
      body: unknown,
      method = "POST",
    ) =>
      mf.dispatchFetch("https://admin.preview.invalid/api/admin/" + path, {
        method,
        headers,
        body: JSON.stringify(body),
      });
    const path = "catalog/products/product/variants/";
    const raw = {
      baseSku: " sw-rise ",
      sizes: ["s", "m", "S"],
      colors: [],
      stock: 0,
      isActive: true,
    };
    for (const action of ["generate-preview", "generate"])
      assert.equal((await call(path + action, base, raw)).status, 401);
    const logged = await call("auth/login", base, {
      login,
      passwordProof: proof,
    });
    assert.equal(logged.status, 200);
    const signed = {
      ...base,
      cookie: logged.headers.get("set-cookie")!.split(";")[0]!,
      "x-csrf-token": ((await logged.json()) as { csrfToken: string })
        .csrfToken,
    };
    for (const action of ["generate-preview", "generate"])
      for (const headers of [
        { ...signed, "x-csrf-token": "wrong" },
        { ...signed, origin: "https://evil.invalid" },
      ])
        assert.equal((await call(path + action, headers, raw)).status, 403);
    assert.equal(
      (
        await mf.dispatchFetch(
          "https://preview.invalid/api/admin/" + path + "generate",
          { method: "POST", headers: signed, body: JSON.stringify(raw) },
        )
      ).status,
      403,
    );
    const preview = await call(path + "generate-preview", signed, raw);
    assert.equal(preview.status, 200);
    assert.deepEqual(
      ((await preview.json()) as { rows: { status: string }[] }).rows.map(
        (r) => r.status,
      ),
      ["NEW", "NEW"],
    );
    assert.equal(
      (await db
        .prepare("SELECT count(*) n FROM ProductVariant")
        .first<{ n: number }>())!.n,
      0,
    );
    assert.equal(
      (await db
        .prepare("SELECT count(*) n FROM AuditLog")
        .first<{ n: number }>())!.n,
      0,
    );
    for (const bad of [
      { ...raw, baseSku: "BAD_BASE" },
      { ...raw, stock: -1 },
      { ...raw, sizes: ["X L"] },
      { ...raw, colors: [{ color: "Olive", code: "OLIV" }] },
      { ...raw, rows: [{ sku: "FORGED" }] },
    ])
      assert.equal((await call(path + "generate", signed, bad)).status, 400);
    const applied = await call(path + "generate", signed, raw);
    assert.equal(applied.status, 200);
    assert.equal(
      ((await applied.json()) as { createdCount: number }).createdCount,
      2,
    );
    const repeated = await call(path + "generate", signed, raw);
    assert.equal(repeated.status, 200);
    assert.equal(
      ((await repeated.json()) as { createdCount: number }).createdCount,
      0,
    );
    assert.equal(
      (await call("catalog/products/missing/variants/generate", signed, raw))
        .status,
      404,
    );
    // Manual flow remains available through the same protected Worker boundary.
    const manual = await call("catalog/products/product/variants", signed, {
      sku: "MANUAL",
      size: "L",
      stock: null,
      color: null,
      isActive: true,
    });
    assert.equal(manual.status, 201);
    const id = ((await manual.json()) as { variant: { id: string } }).variant
      .id;
    assert.equal(
      (
        await call(
          `catalog/variants/${id}`,
          signed,
          { stock: 4, sku: "MANUAL-EDIT" },
          "PATCH",
        )
      ).status,
      200,
    );
    for (const action of ["deactivate", "activate"])
      assert.equal(
        (await call(`catalog/variants/${id}/${action}`, signed, {})).status,
        200,
      );
    await db
      .prepare(
        "INSERT INTO Product(id,categoryId,nameRu,nameUz,slug,price,updatedAt) VALUES('bulk','category','Bulk','Bulk','bulk',100,1)",
      )
      .run();
    const bulk = await call("catalog/products/bulk/variants/generate", signed, {
      ...raw,
      sizes: Array.from({ length: 20 }, (_, i) => String(i + 30)),
      colors: [
        { color: "Black", code: "BLK" },
        { color: "White", code: "WHT" },
        { color: "Cream", code: "CRM" },
        { color: "Red", code: "RED" },
        { color: "Blue", code: "BLU" },
      ],
    });
    assert.equal(bulk.status, 200);
    assert.equal(
      ((await bulk.json()) as { createdCount: number }).createdCount,
      100,
    );
    for (const table of [
      "User",
      "Order",
      "OrderItem",
      "Payment",
      "Cart",
      "TelegramAdmin",
    ])
      assert.equal(
        (await db
          .prepare(`SELECT count(*) n FROM "${table}"`)
          .first<{ n: number }>())!.n,
        0,
      );
  } finally {
    await mf.dispose();
  }
});
