import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { Miniflare, Log, LogLevel, convertV4MiniflareOptions } from "miniflare";
import { infrastructureIsolated, isStenzoHost } from "../src/isolation.js";
import { accessConfiguration } from "../src/access.js";

test("all STENZO subdomains, old Worker and Access identities are denied", () => {
  for (const host of [
    "stenzo.uz",
    "CF.STENZO.UZ.",
    "cf-admin.stenzo.uz",
    "any.deep.stenzo.uz",
    "stenzo-free-preview.example.workers.dev",
    "cool-bush-5c50.cloudflareaccess.com",
  ])
    assert.equal(isStenzoHost(host), true, host);
  assert.equal(isStenzoHost("store.voyey.example.invalid"), false);
  for (const key of ["PUBLIC_ORIGIN", "ADMIN_ORIGIN", "ACCESS_TEAM_DOMAIN"])
    assert.equal(
      infrastructureIsolated({ [key]: "https://cf.stenzo.uz" }),
      false,
    );
  assert.equal(
    infrastructureIsolated({
      ACCESS_AUD:
        "b8e4a1545e95be70497d182d85814439456c09534a20f36dd20c99dad70fffc0",
    }),
    false,
  );
  const oldAudience =
    "b8e4a1545e95be70497d182d85814439456c09534a20f36dd20c99dad70fffc0";
  for (const audience of [
    oldAudience,
    "a".repeat(64) + ", " + oldAudience.toUpperCase(),
  ]) {
    assert.equal(infrastructureIsolated({ ACCESS_AUD: audience }), false);
    assert.throws(
      () =>
        accessConfiguration({
          ACCESS_TEAM_DOMAIN: "https://voyey-test.cloudflareaccess.com",
          ACCESS_AUD: audience,
          ADMIN_ACCESS_EMAILS: "fixture@example.invalid",
        }),
      /STENZO Access/,
    );
  }
});

test("local-only template refuses external origins and live integration credentials", () => {
  const base = {
    VOYEY_LOCAL_ONLY: "1",
    COMMERCE_ENABLED: "0",
    PUBLIC_ORIGIN: "https://store.voyey.example.invalid",
  };
  assert.equal(infrastructureIsolated(base), true);
  for (const change of [
    { COMMERCE_ENABLED: "1" },
    { PUBLIC_ORIGIN: "https://example.com" },
    { TELEGRAM_BOT_TOKEN: "synthetic" },
    { TELEGRAM_WEBHOOK_SECRET: "synthetic" },
    { TELEGRAM_CHANNEL_ID: "synthetic" },
    { ADMIN_TELEGRAM_IDS: "synthetic" },
    { ACCESS_TEAM_DOMAIN: "https://synthetic.cloudflareaccess.com" },
  ])
    assert.equal(infrastructureIsolated({ ...base, ...change }), false);
});

test("actual Worker blocks unsafe configuration before D1, assets, redirects or outbound calls", async () => {
  let touched = false;
  const mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      scriptPath: fileURLToPath(new URL("../dist/index.js", import.meta.url)),
      compatibilityDate: "2026-10-15",
      compatibilityFlags: ["nodejs_compat"],
      bindings: {
        PREVIEW_ONLY: "1",
        COMMERCE_ENABLED: "0",
        PUBLIC_ORIGIN: "https://cf.stenzo.uz",
        ADMIN_ORIGIN: "https://cf-admin.stenzo.uz",
      },
      // Deliberately no DB binding: touching D1 would fail with 500 rather than 503.
      serviceBindings: {
        ASSETS: async () => {
          touched = true;
          throw new Error("Assets must not be called");
        },
      },
      outboundService: async () => {
        touched = true;
        throw new Error("Network must not be called");
      },
      log: new Log(LogLevel.NONE),
    }),
  );
  try {
    for (const path of [
      "/health",
      "/api/catalog/products",
      "/media/products/test.png",
      "/telegram/webhook",
      "/admin/",
    ])
      assert.equal(
        (await mf.dispatchFetch("https://local.invalid" + path)).status,
        503,
      );
    assert.equal(touched, false);
  } finally {
    await mf.dispose();
  }
});
