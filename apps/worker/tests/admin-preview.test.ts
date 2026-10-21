import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Miniflare, Log, LogLevel, convertV4MiniflareOptions } from "miniflare";
import { generateKeyPair, exportJWK, SignJWT } from "jose";

test("commerce disabled and no Telegram/payment credentials: Admin Access, catalog, session, CSRF and logout remain protected", async () => {
  const { privateKey, publicKey } = await generateKeyPair("RS256");
  const issuer = "https://admin-regression.cloudflareaccess.com",
    aud = "b".repeat(64),
    email = "owner@example.test";
  const jwt = () =>
    new SignJWT({ email, type: "app" })
      .setProtectedHeader({ alg: "RS256", kid: "test" })
      .setIssuer(issuer)
      .setAudience(aud)
      .setSubject("owner")
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(privateKey);
  const mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      scriptPath: fileURLToPath(new URL("../dist/index.js", import.meta.url)),
      compatibilityDate: "2026-10-15",
      compatibilityFlags: ["nodejs_compat"],
      d1Databases: ["DB"],
      serviceBindings: {
        ASSETS: async () => new Response("not found", { status: 404 }),
      },
      bindings: {
        PREVIEW_ONLY: "1",
        COMMERCE_ENABLED: "0",
        PUBLIC_ORIGIN: "https://preview.invalid",
        ADMIN_ORIGIN: "https://admin.preview.invalid",
        ACCESS_TEAM_DOMAIN: issuer,
        ACCESS_AUD: aud,
        ADMIN_ACCESS_EMAILS: email,
        JWT_SECRET: randomBytes(32).toString("hex"),
        ADMIN_PROXY_SECRET: randomBytes(32).toString("hex"),
      },
      outboundService: async (request) => {
        assert.equal(new URL(request.url).origin, issuer);
        return Response.json({
          keys: [
            {
              ...(await exportJWK(publicKey)),
              kid: "test",
              alg: "RS256",
              use: "sig",
            },
          ],
        });
      },
      log: new Log(LogLevel.NONE),
    }),
  );
  try {
    const db = await mf.getD1Database("DB");
    for (const name of readdirSync(
      new URL("../migrations/", import.meta.url),
    ).sort())
      for (const sql of readFileSync(
        new URL("../migrations/" + name, import.meta.url),
        "utf8",
      )
        .split(/;\r?\n/)
        .map((x) => x.trim())
        .filter(Boolean))
        await db.prepare(sql).run();
    const admin = (path: string, init: RequestInit = {}) =>
      mf.dispatchFetch(
        "https://admin.preview.invalid/api/admin/" + path,
        init as never,
      );
    assert.equal((await admin("catalog/categories")).status, 403);
    assert.equal(
      (
        await admin("auth/access", {
          method: "POST",
          headers: { "cf-access-jwt-assertion": "forged" },
        })
      ).status,
      403,
    );
    const headers = {
      "cf-access-jwt-assertion": await jwt(),
      origin: "https://admin.preview.invalid",
      "x-stenzo-admin": "1",
    };
    assert.equal((await admin("catalog/products", { headers })).status, 401);
    const login = await admin("auth/access", { method: "POST", headers });
    assert.equal(login.status, 200);
    const cookie = login.headers.get("set-cookie")!.split(";")[0]!;
    const session = (await login.json()) as { csrfToken: string };
    const signed = { ...headers, cookie, "x-csrf-token": session.csrfToken };
    assert.equal(
      (await admin("auth/session", { headers: signed })).status,
      200,
    );
    assert.equal(
      (await admin("catalog/categories", { headers: signed })).status,
      200,
    );
    assert.equal(
      (await admin("catalog/products", { headers: signed })).status,
      200,
    );
    assert.equal(
      (
        await admin("catalog/categories", {
          method: "POST",
          headers: { ...headers, cookie, "content-type": "application/json" },
          body: JSON.stringify({
            nameRu: "Synthetic test",
            nameUz: "Synthetic test",
            slug: "csrf-blocked",
            sortOrder: 0,
          }),
        })
      ).status,
      403,
    );
    assert.equal(
      (await admin("auth/logout", { method: "POST", headers: signed })).status,
      200,
    );
    assert.equal(
      (await admin("auth/session", { headers: signed })).status,
      401,
    );
  } finally {
    await mf.dispose();
  }
});
