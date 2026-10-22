import test from "node:test";
import assert from "node:assert/strict";
import { createHash, pbkdf2Sync, randomBytes } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Miniflare, Log, LogLevel, convertV4MiniflareOptions } from "miniflare";
import { generateKeyPair, exportJWK, SignJWT } from "jose";
import {
  adminPasswordConfiguration,
  passwordPrincipal,
  verifyAdminPasswordProof,
} from "../src/admin-password.js";

const fixturePassword = randomBytes(24).toString("base64url");
const salt = randomBytes(32).toString("hex");
const fixtureProof = pbkdf2Sync(
  fixturePassword,
  Buffer.from(salt, "hex"),
  600000,
  32,
  "sha256",
).toString("hex");
const fixtureHash = `pbkdf2-sha256$600000$${salt}$${createHash("sha256").update(Buffer.from(fixtureProof, "hex")).digest("hex")}`;
const login = "fixture_admin";

test("password configuration fails closed, verifies salted hash and rotates session principal", async () => {
  assert.equal(adminPasswordConfiguration({}), undefined);
  for (const env of [
    { ADMIN_PANEL_LOGIN: login },
    { ADMIN_PANEL_PASSWORD_HASH: fixtureHash },
    { ADMIN_PANEL_LOGIN: "", ADMIN_PANEL_PASSWORD_HASH: "" },
    { ADMIN_PANEL_LOGIN: login, ADMIN_PANEL_PASSWORD_HASH: "plaintext" },
  ])
    assert.throws(() => adminPasswordConfiguration(env));
  const config = adminPasswordConfiguration({
    ADMIN_PANEL_LOGIN: login,
    ADMIN_PANEL_PASSWORD_HASH: fixtureHash,
  })!;
  assert.equal(verifyAdminPasswordProof(config, login, fixtureProof), true);
  assert.equal(verifyAdminPasswordProof(config, "wrong", fixtureProof), false);
  assert.equal(verifyAdminPasswordProof(config, login, "0".repeat(64)), false);
  assert.equal(
    verifyAdminPasswordProof(config, login, fixtureHash.split("$")[3]!),
    false,
  );
  assert.notEqual(passwordPrincipal("access-only", config), "access-only");
  assert.notEqual(
    passwordPrincipal("access-only", config),
    passwordPrincipal("other-access", config),
  );
  assert.notEqual(
    passwordPrincipal("access-only", config),
    passwordPrincipal("access-only", { ...config, login: "rotated" }),
  );
});

test("actual Worker requires Access AND password; no bypass, strict origin/CSRF, persistent rate limit and logout", async () => {
  const { privateKey, publicKey } = await generateKeyPair("RS256");
  const issuer = "https://password-test.cloudflareaccess.com",
    aud = "c".repeat(64),
    email = "owner@example.test";
  const assertion = await new SignJWT({ email, type: "app" })
    .setProtectedHeader({ alg: "RS256", kid: "password-test" })
    .setIssuer(issuer)
    .setAudience(aud)
    .setSubject("owner")
    .setIssuedAt()
    .setExpirationTime("10m")
    .sign(privateKey);
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
        PUBLIC_ORIGIN: "https://preview.invalid",
        ADMIN_ORIGIN: "https://admin.preview.invalid",
        ACCESS_TEAM_DOMAIN: issuer,
        ACCESS_AUD: aud,
        ADMIN_ACCESS_EMAILS: email,
        JWT_SECRET: randomBytes(32).toString("hex"),
        ADMIN_PROXY_SECRET: randomBytes(32).toString("hex"),
        ADMIN_PANEL_LOGIN: login,
        ADMIN_PANEL_PASSWORD_HASH: fixtureHash,
      },
      outboundService: async (request) => {
        assert.equal(
          new URL(request.url).origin,
          issuer,
          "No Telegram or other live service calls",
        );
        return Response.json({
          keys: [
            {
              ...(await exportJWK(publicKey)),
              kid: "password-test",
              alg: "RS256",
              use: "sig",
            },
          ],
        });
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
    const access = {
      "cf-access-jwt-assertion": assertion,
      origin: "https://admin.preview.invalid",
      "x-stenzo-admin": "1",
    };
    const call = (
      path: string,
      method = "GET",
      headers: Record<string, string> = access,
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
    const credentials = { login, passwordProof: fixtureProof };
    assert.equal(
      (await call("auth/login", "POST", {}, credentials)).status,
      403,
    );
    assert.equal(
      (
        await call(
          "auth/login",
          "POST",
          { ...access, "cf-access-jwt-assertion": "forged" },
          credentials,
        )
      ).status,
      403,
    );
    assert.equal(
      (
        await call(
          "auth/login",
          "POST",
          { ...access, origin: "https://evil.invalid" },
          credentials,
        )
      ).status,
      403,
    );
    assert.equal(
      (
        await call(
          "auth/login",
          "POST",
          { ...access, "x-stenzo-admin": "" },
          credentials,
        )
      ).status,
      403,
    );
    assert.equal((await call("auth/login")).status, 405);
    assert.equal((await call("auth/method")).status, 200);
    assert.deepEqual(await (await call("auth/method")).json(), {
      passwordRequired: true,
      challenge: { salt, iterations: 600000 },
    });
    assert.equal((await call("auth/access", "POST")).status, 401);
    for (const bad of [
      { login, passwordProof: "0".repeat(64) },
      { login: "wrong", passwordProof: fixtureProof },
      { ...credentials, userId: "forged" },
    ])
      assert.equal((await call("auth/login", "POST", access, bad)).status, 401);
    assert.equal(
      (
        await db
          .prepare("SELECT count(*) n FROM AdminWebSession")
          .first<{ n: number }>()
      )?.n,
      0,
    );
    // An Access-only session created before the extra factor cannot bypass it.
    const oldToken = randomBytes(32).toString("base64url");
    const oldPrincipal = createHash("sha256")
      .update(`${issuer}:owner:${email}`)
      .digest("hex");
    await db
      .prepare(
        "INSERT INTO AdminWebSession(tokenHash,csrfToken,expiresAt,principalHash) VALUES(?,?,?,?)",
      )
      .bind(
        createHash("sha256").update(oldToken).digest("hex"),
        "old-csrf",
        Date.now() + 60000,
        oldPrincipal,
      )
      .run();
    const legacy = { ...access, cookie: "voyey_admin_session=" + oldToken };
    assert.equal((await call("auth/session", "GET", legacy)).status, 401);
    assert.equal((await call("auth/access", "POST", legacy)).status, 401);
    assert.equal((await call("catalog/categories", "GET", legacy)).status, 401);
    const response = await call("auth/login", "POST", access, credentials);
    assert.equal(response.status, 200);
    const issued = (await response.json()) as {
      login: string;
      csrfToken: string;
    };
    assert.equal(issued.login, login);
    const setCookie = response.headers.get("set-cookie")!;
    for (const flag of ["Secure", "HttpOnly", "SameSite=Strict"])
      assert.ok(setCookie.includes(flag));
    const signed = {
      ...access,
      cookie: setCookie.split(";")[0]!,
      "x-csrf-token": issued.csrfToken,
    };
    assert.equal((await call("auth/session", "GET", signed)).status, 200);
    assert.equal((await call("catalog/categories", "GET", signed)).status, 200);
    assert.equal((await call("auth/access", "POST", signed)).status, 200);
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
          await call("auth/login", "POST", access, {
            login,
            passwordProof: "0".repeat(64),
          })
        ).status,
        401,
      );
    assert.equal(
      (await call("auth/login", "POST", access, credentials)).status,
      429,
    );
    for (const table of [
      "User",
      "Cart",
      "Order",
      "Payment",
      "TelegramAdmin",
      "MediaObject",
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
