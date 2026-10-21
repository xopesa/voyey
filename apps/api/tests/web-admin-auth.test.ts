import { randomBytes } from "node:crypto";
import { argon2id, hash } from "argon2";
import Fastify from "fastify";
import { beforeAll, describe, expect, it } from "vitest";
import {
  createAdminGuard,
  registerAdminProtection,
} from "../src/modules/admin/authorization.js";
import { registerWebAdminAuth } from "../src/modules/admin/web-auth.js";
import {
  ADMIN_LOGIN,
  COOKIE_NAME,
  SESSION_SECONDS,
  WebAdminSessions,
} from "../src/modules/admin/web-session.js";
import { JwtTokenService } from "../src/modules/auth/token.js";
import { createAuthGuard } from "../src/modules/auth/middleware.js";
import { createTestUserService } from "./helpers/auth.js";

const origin = "http://localhost:3002";
const password = randomBytes(32).toString("base64url");
let passwordHash: string;
beforeAll(async () => {
  passwordHash = await hash(password, {
    type: argon2id,
    memoryCost: 65536,
    timeCost: 3,
    parallelism: 1,
  });
});

function fixture(
  secure = false,
  now = Date.now,
  configuredHash = passwordHash,
) {
  const app = Fastify();
  const tokens = new JwtTokenService(
    "stenzo-web-auth-test-secret-more-than-32-characters",
  );
  const users = createTestUserService();
  app.decorateRequest("currentUser", null);
  registerWebAdminAuth(
    app,
    new WebAdminSessions(configuredHash, origin, secure, now),
  );
  registerAdminProtection(
    app,
    createAdminGuard(tokens, users, new Set(["42"])),
  );
  // Even an endpoint that forgets its own guard is protected by the admin layer.
  app.get("/admin/future", async () => ({ ok: true }));
  app.get("/admin/catalog/categories", async (request) => ({
    actor: request.webAdminActor,
  }));
  app.post("/admin/catalog/categories", async () => ({ ok: true }));
  app.get("/admin/payments", async () => ({ ok: true }));
  app.get(
    "/customer",
    { preHandler: createAuthGuard(tokens, users) },
    async () => ({ ok: true }),
  );
  return { app, tokens };
}
type App = ReturnType<typeof fixture>["app"];
async function login(
  app: App,
  suppliedPassword = password,
  suppliedLogin = ADMIN_LOGIN,
  remoteAddress?: string,
) {
  return app.inject({
    method: "POST",
    url: "/admin/auth/login",
    headers: { origin, "x-stenzo-admin": "1" },
    payload: { login: suppliedLogin, password: suppliedPassword },
    ...(remoteAddress ? { remoteAddress } : {}),
  });
}
async function session(app: App) {
  const response = await login(app);
  expect(response.statusCode).toBe(200);
  const cookie = String(response.headers["set-cookie"]).split(";")[0]!;
  return {
    cookie,
    origin,
    "x-csrf-token": response.json<{ csrfToken: string }>().csrfToken,
  };
}

describe("web admin authentication", () => {
  it("sets an opaque HttpOnly bounded cookie, no-store and Secure in production", async () => {
    const { app } = fixture(true);
    const response = await login(app);
    expect(response.statusCode).toBe(200);
    expect(response.headers["set-cookie"]).toContain("HttpOnly");
    expect(response.headers["set-cookie"]).toContain("Secure");
    expect(response.headers["set-cookie"]).toContain("SameSite=Strict");
    expect(response.headers["set-cookie"]).toContain(
      `Max-Age=${SESSION_SECONDS}`,
    );
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.body).not.toContain(password);
    const cookie = String(response.headers["set-cookie"]).split(";")[0]!;
    expect(cookie).toMatch(new RegExp(`^${COOKIE_NAME}=[A-Za-z0-9_-]{43}$`));
    expect(
      (
        await app.inject({ url: "/admin/auth/session", headers: { cookie } })
      ).json(),
    ).toMatchObject({ login: ADMIN_LOGIN });
    await app.close();
  });
  it("rejects wrong password, wrong login and missing configuration", async () => {
    const { app } = fixture();
    expect((await login(app, randomBytes(24).toString("hex"))).statusCode).toBe(
      401,
    );
    expect((await login(app, password, "unknown")).statusCode).toBe(401);
    await app.close();
    const disabled = fixture(false, Date.now, "");
    expect((await login(disabled.app)).statusCode).toBe(401);
    await disabled.app.close();
  });
  it("blocks anonymous, forged and future admin API access", async () => {
    const { app } = fixture();
    for (const url of [
      "/admin/catalog/categories",
      "/admin/payments",
      "/admin/future",
      "/admin/auth/session",
    ]) {
      expect((await app.inject({ url })).statusCode).toBe(401);
      expect(
        (
          await app.inject({
            url,
            headers: { cookie: `${COOKIE_NAME}=forged` },
          })
        ).statusCode,
      ).toBe(401);
    }
    await app.close();
  });
  it("requires origin and custom header for login", async () => {
    const { app } = fixture();
    for (const headers of [
      { origin: "https://attacker.example", "x-stenzo-admin": "1" },
      { origin },
      { "x-stenzo-admin": "1" },
    ]) {
      expect(
        (
          await app.inject({
            method: "POST",
            url: "/admin/auth/login",
            headers,
            payload: { login: ADMIN_LOGIN, password },
          })
        ).statusCode,
      ).toBe(403);
    }
    await app.close();
  });
  it("requires matching CSRF and origin on cookie mutations, including logout", async () => {
    const { app } = fixture();
    const headers = await session(app);
    for (const url of ["/admin/catalog/categories", "/admin/auth/logout"]) {
      for (const invalid of [
        { cookie: headers.cookie, origin },
        { ...headers, origin: "https://attacker.example" },
        { ...headers, "x-csrf-token": "bad" },
        { ...headers, "x-csrf-token": "é".repeat(43) },
      ]) {
        expect(
          (await app.inject({ method: "POST", url, headers: invalid }))
            .statusCode,
        ).toBe(403);
      }
    }
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/admin/catalog/categories",
          headers,
        })
      ).statusCode,
    ).toBe(200);
    await app.close();
  });
  it("revokes session on logout, rejects replay and clears cookie", async () => {
    const { app } = fixture();
    const headers = await session(app);
    const logout = await app.inject({
      method: "POST",
      url: "/admin/auth/logout",
      headers,
    });
    expect(logout.statusCode).toBe(200);
    expect(logout.headers["set-cookie"]).toContain("Expires=Thu, 01 Jan 1970");
    expect(
      (await app.inject({ url: "/admin/catalog/categories", headers }))
        .statusCode,
    ).toBe(401);
    await app.close();
  });
  it("expires sessions after eight hours and replaces the current session on login", async () => {
    let time = Date.now();
    const { app } = fixture(false, () => time);
    const first = await session(app);
    const replacement = await app.inject({
      method: "POST",
      url: "/admin/auth/login",
      headers: { ...first, "x-stenzo-admin": "1" },
      payload: { login: ADMIN_LOGIN, password },
    });
    expect(replacement.statusCode).toBe(200);
    expect(
      (await app.inject({ url: "/admin/auth/session", headers: first }))
        .statusCode,
    ).toBe(401);
    time += SESSION_SECONDS * 1000;
    expect(
      (
        await app.inject({
          url: "/admin/auth/session",
          headers: {
            cookie: String(replacement.headers["set-cookie"]).split(";")[0]!,
          },
        })
      ).statusCode,
    ).toBe(401);
    await app.close();
  });
  it("throttles concurrent failures before password verification and resets after expiry", async () => {
    let time = Date.now();
    const { app } = fixture(false, () => time);
    const wrong = randomBytes(24).toString("hex");
    const attempts = await Promise.all(
      Array.from({ length: 6 }, () => login(app, wrong)),
    );
    expect(attempts.map((result) => result.statusCode).sort()).toEqual([
      401, 401, 401, 401, 401, 429,
    ]);
    expect((await login(app)).statusCode).toBe(429);
    time += 15 * 60_000;
    expect((await login(app)).statusCode).toBe(200);
    await app.close();
  });
  it("keeps web and Telegram/JWT identities separate and limits web admin scope", async () => {
    const { app, tokens } = fixture();
    const headers = await session(app);
    expect(
      (await app.inject({ url: "/admin/catalog/categories", headers }))
        .statusCode,
    ).toBe(200);
    expect(
      (await app.inject({ url: "/admin/future", headers })).statusCode,
    ).toBe(403);
    expect(
      (await app.inject({ url: "/admin/payments", headers })).statusCode,
    ).toBe(200);
    expect((await app.inject({ url: "/customer", headers })).statusCode).toBe(
      401,
    );
    expect(
      (
        await app.inject({
          url: "/admin/catalog/categories",
          headers: { ...headers, authorization: "Bearer invalid" },
        })
      ).statusCode,
    ).toBe(401);
    const customer = await tokens.issue("user-1");
    expect(
      (
        await app.inject({
          url: "/admin/future",
          headers: { authorization: `Bearer ${customer}` },
        })
      ).statusCode,
    ).toBe(403);
    const admin = await tokens.issue("admin");
    expect(
      (
        await app.inject({
          url: "/admin/future",
          headers: { authorization: `Bearer ${admin}` },
        })
      ).statusCode,
    ).toBe(200);
    await app.close();
  });
});
