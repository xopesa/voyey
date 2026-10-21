import assert from "node:assert/strict";
import { test } from "node:test";
import { containerRequest, selectApp, uncached } from "../src/routing.js";
const hosts = {
  API_HOST: "api.preview.invalid",
  MINIAPP_HOST: "miniapp.preview.invalid",
  ADMIN_HOST: "admin.preview.invalid",
  BOT_HOST: "bot.preview.invalid",
};

test("routes only configured hosts and the dedicated webhook path", () => {
  for (const [host, app] of [
    [hosts.API_HOST, "api"],
    [hosts.MINIAPP_HOST, "miniapp"],
    [hosts.ADMIN_HOST, "admin"],
    [hosts.BOT_HOST, "bot"],
  ])
    assert.equal(
      selectApp(new Request(`https://${host}/telegram/webhook`), hosts),
      app,
    );
  assert.equal(
    selectApp(new Request("https://unknown.example/"), hosts),
    undefined,
  );
  assert.equal(
    selectApp(new Request(`https://${hosts.BOT_HOST}/health`), hosts),
    undefined,
  );
});

for (const ip of ["203.0.113.10", "2001:db8::10"])
  test(`overwrites spoofed forwarding headers for ${ip} and preserves Admin HMAC/body/cookies`, async () => {
    const original = new Request(
      "https://admin.preview.invalid/api/admin/auth/login",
      {
        method: "POST",
        body: "unchanged",
        headers: {
          "cf-connecting-ip": ip,
          "x-real-ip": "198.51.100.1",
          "x-forwarded-for": "spoof, 198.51.100.2",
          "x-forwarded-host": "attacker.example",
          "x-forwarded-proto": "http",
          "x-vercel-forwarded-for": "198.51.100.3",
          forwarded: "for=spoof",
          cookie: "session=test",
          "x-stenzo-client-signature": "existing-signature",
        },
      },
    );
    const forwarded = containerRequest(original)!;
    assert.equal(forwarded.headers.get("x-real-ip"), ip);
    assert.equal(forwarded.headers.get("x-forwarded-for"), ip);
    assert.equal(forwarded.headers.get("x-forwarded-proto"), "https");
    assert.equal(
      forwarded.headers.get("x-forwarded-host"),
      "admin.preview.invalid",
    );
    assert.equal(forwarded.headers.get("x-vercel-forwarded-for"), null);
    assert.equal(forwarded.headers.get("forwarded"), null);
    assert.equal(forwarded.headers.get("cookie"), "session=test");
    assert.equal(
      forwarded.headers.get("x-stenzo-client-signature"),
      "existing-signature",
    );
    assert.equal(await forwarded.text(), "unchanged");
  });

test("fails closed without a valid platform IP; never falls back to client XFF", () => {
  for (const value of [undefined, "", "invalid", "203.0.113.1, 203.0.113.2"]) {
    const headers: Record<string, string> = {
      "x-real-ip": "203.0.113.1",
      "x-forwarded-for": "203.0.113.1",
    };
    if (value !== undefined) headers["cf-connecting-ip"] = value;
    assert.equal(
      containerRequest(new Request("https://api.preview.invalid", { headers })),
      undefined,
    );
  }
});

test("bypasses caching for private/dynamic responses and preserves Set-Cookie", () => {
  for (const app of ["api", "admin", "bot", "miniapp"] as const) {
    const response = uncached(
      new Response("private", {
        headers: {
          "cache-control": "public",
          "set-cookie": "session=unchanged; Secure; HttpOnly",
        },
      }),
      app,
      "/orders",
    );
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    assert.equal(
      response.headers.get("set-cookie"),
      "session=unchanged; Secure; HttpOnly",
    );
  }
  assert.equal(
    uncached(
      new Response("chunk", {
        headers: { "cache-control": "public, immutable" },
      }),
      "miniapp",
      "/_next/static/chunk.js",
    ).headers.get("cache-control"),
    "public, immutable",
  );
});
