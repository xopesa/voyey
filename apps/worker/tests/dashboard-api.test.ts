import test from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Miniflare, Log, LogLevel, convertV4MiniflareOptions } from "miniflare";
import type { AdminDashboard } from "@stenzo/shared";

test("Worker Dashboard is Admin-only, GET needs no CSRF, query validated, DTO read-only and scoped", async () => {
  const login = "dashboard_fixture",
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
        ASSETS: async () => new Response("fixture", { status: 200 }),
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
        throw new Error("Dashboard must not make outbound calls");
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
    const url = "https://admin.preview.invalid/api/admin/";
    for (const headers of [
      {},
      { authorization: "Bearer forged", "cf-access-jwt-assertion": "forged" },
    ])
      assert.equal(
        (await mf.dispatchFetch(url + "dashboard", { headers })).status,
        401,
      );
    assert.equal(
      (await mf.dispatchFetch("https://preview.invalid/api/admin/dashboard"))
        .status,
      403,
    );
    const signedIn = await mf.dispatchFetch(url + "auth/login", {
      method: "POST",
      headers: {
        origin: "https://admin.preview.invalid",
        "x-stenzo-admin": "1",
        "content-type": "application/json",
      },
      body: JSON.stringify({ login, passwordProof: proof }),
    });
    assert.equal(signedIn.status, 200);
    const cookie = signedIn.headers.get("set-cookie")!.split(";")[0]!;
    const csrf = ((await signedIn.json()) as { csrfToken: string }).csrfToken;
    const before = (await db
      .prepare("SELECT version FROM _Revision")
      .first<{ version: number }>())!.version;
    for (const range of [
      "today",
      "7d",
      "30d",
      "custom&from=2026-10-01&to=2026-10-19",
    ]) {
      const response = await mf.dispatchFetch(
        url + "dashboard?range=" + range,
        { headers: { cookie } },
      );
      assert.equal(response.status, 200);
      const body = (await response.json()) as AdminDashboard;
      assert.ok(Object.values(body.kpis).every((n) => n === 0));
      assert.equal(body.period.timezone, "Asia/Tashkent");
      assert.deepEqual(body.latestOrders, []);
      assert.doesNotMatch(
        JSON.stringify(body),
        /token|secret|proof|password|credential/i,
      );
      assert.match(response.headers.get("cache-control") ?? "", /no-store/);
    }
    assert.equal(
      (
        await mf.dispatchFetch(
          url + "dashboard?range=custom&from=2026-10-20&to=2026-10-19",
          { headers: { cookie } },
        )
      ).status,
      400,
    );
    assert.equal(
      (
        await mf.dispatchFetch(url + "dashboard", {
          method: "POST",
          headers: {
            cookie,
            origin: "https://admin.preview.invalid",
            "x-csrf-token": csrf,
          },
        })
      ).status,
      404,
    );
    assert.equal(
      (await db
        .prepare("SELECT version FROM _Revision")
        .first<{ version: number }>())!.version,
      before,
    );
    for (const path of [
      "catalog/categories",
      "catalog/products",
      "orders",
      "telegram/admins",
    ])
      assert.equal(
        (await mf.dispatchFetch(url + path, { headers: { cookie } })).status,
        200,
      );
    for (const table of [
      "User",
      "Product",
      "ProductVariant",
      "Order",
      "Payment",
      "Cart",
      "TelegramAdmin",
      "AuditLog",
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
