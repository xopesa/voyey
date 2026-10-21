import test from "node:test";
import assert from "node:assert/strict";
import { createHash, pbkdf2Sync, randomBytes } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Miniflare, Log, LogLevel, convertV4MiniflareOptions } from "miniflare";
import { adminAuthenticationMode } from "../src/admin-password.js";

test("direct mode requires complete credentials and an explicit known mode", () => {
  assert.equal(adminAuthenticationMode({}), "access");
  assert.throws(() => adminAuthenticationMode({ ADMIN_AUTH_MODE: "password" }));
  assert.throws(() => adminAuthenticationMode({ ADMIN_AUTH_MODE: "public" }));
});

test("direct password mode works without Access; anonymous APIs, old sessions, bearer/header bypass, CSRF and brute force stay blocked", async () => {
  const login = "fixture_direct",
    salt = randomBytes(32);
  const proof = pbkdf2Sync(
    randomBytes(24).toString("hex"),
    salt,
    600000,
    32,
    "sha256",
  ).toString("hex");
  const hash = `pbkdf2-sha256$600000$${salt.toString("hex")}$${createHash("sha256").update(Buffer.from(proof, "hex")).digest("hex")}`;
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
        COMMERCE_ENABLED: "0",
        ADMIN_AUTH_MODE: "password",
        PUBLIC_ORIGIN: "https://preview.invalid",
        ADMIN_ORIGIN: "https://admin.preview.invalid",
        JWT_SECRET: randomBytes(32).toString("hex"),
        ADMIN_PROXY_SECRET: randomBytes(32).toString("hex"),
        ADMIN_PANEL_LOGIN: login,
        ADMIN_PANEL_PASSWORD_HASH: hash,
      },
      outboundService: async () => {
        throw new Error("Direct sign-in must make no external requests");
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
        .map((x) => x.trim())
        .filter(Boolean))
        await db.prepare(sql).run();
    const base = {
      origin: "https://admin.preview.invalid",
      "x-stenzo-admin": "1",
    };
    const call = (
      path: string,
      method = "GET",
      headers: Record<string, string> = base,
      body?: unknown,
    ) =>
      mf.dispatchFetch("https://admin.preview.invalid/api/admin/" + path, {
        method,
        headers: {
          ...headers,
          ...(body ? { "content-type": "application/json" } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
    assert.equal((await call("auth/method")).status, 200);
    assert.equal((await call("auth/session")).status, 401);
    assert.equal((await call("auth/access", "POST")).status, 401);
    for (const path of [
      "catalog/categories",
      "orders",
      "payments",
      "telegram/admins",
    ]) {
      for (const headers of [
        base,
        {
          ...base,
          authorization: "Bearer forged",
          "cf-access-jwt-assertion": "forged",
        },
      ])
        assert.equal((await call(path, "GET", headers)).status, 401);
    }
    assert.equal(
      (await mf.dispatchFetch("https://preview.invalid/api/admin/auth/method"))
        .status,
      403,
    );
    const credentials = { login, passwordProof: proof };
    for (const headers of [
      { ...base, origin: "https://evil.invalid" },
      { ...base, "x-stenzo-admin": "" },
    ])
      assert.equal(
        (await call("auth/login", "POST", headers, credentials)).status,
        403,
      );
    const oldToken = randomBytes(32).toString("base64url");
    await db
      .prepare(
        "INSERT INTO AdminWebSession(tokenHash,csrfToken,expiresAt,principalHash) VALUES(?,?,?,?)",
      )
      .bind(
        createHash("sha256").update(oldToken).digest("hex"),
        "old-csrf",
        Date.now() + 60000,
        "access-only-principal",
      )
      .run();
    assert.equal(
      (
        await call("auth/session", "GET", {
          ...base,
          cookie: "stenzo_admin_session=" + oldToken,
        })
      ).status,
      401,
    );
    for (const bad of [
      { login, passwordProof: "0".repeat(64) },
      { login: "wrong", passwordProof: proof },
      { login, passwordProof: hash.split("$")[3] },
    ])
      assert.equal((await call("auth/login", "POST", base, bad)).status, 401);
    const res = await call("auth/login", "POST", base, credentials);
    assert.equal(res.status, 200);
    const issued = (await res.json()) as { login: string; csrfToken: string };
    assert.equal(issued.login, login);
    const signed = {
      ...base,
      cookie: res.headers.get("set-cookie")!.split(";")[0]!,
      "x-csrf-token": issued.csrfToken,
    };
    assert.equal((await call("auth/session", "GET", signed)).status, 200);
    assert.equal((await call("catalog/categories", "GET", signed)).status, 200);
    assert.equal(
      (
        await call("auth/logout", "POST", {
          ...signed,
          "x-csrf-token": "wrong",
        })
      ).status,
      403,
    );
    assert.equal((await call("auth/logout", "POST", signed)).status, 200);
    assert.equal((await call("auth/session", "GET", signed)).status, 401);
    for (let i = 0; i < 5; i++)
      assert.equal(
        (
          await call("auth/login", "POST", base, {
            login,
            passwordProof: "0".repeat(64),
          })
        ).status,
        401,
      );
    assert.equal(
      (await call("auth/login", "POST", base, credentials)).status,
      429,
    );
    for (const table of [
      "User",
      "Cart",
      "Order",
      "Payment",
      "MediaObject",
      "TelegramAdmin",
    ])
      assert.equal(
        (
          await db
            .prepare(`SELECT count(*) n FROM "${table}"`)
            .first<{ n: number }>()
        )?.n,
        0,
      );
  } finally {
    await mf.dispose();
  }
});
