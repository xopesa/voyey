import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { join } from "node:path";

export const root = fileURLToPath(new URL("../", import.meta.url));
export const inactiveAccount = "0".repeat(32);
export const inactiveDatabase = "00000000-0000-0000-0000-000000000000";
export const publicOrigin = "https://store.voyey.example.invalid";
export const adminOrigin = "https://admin.voyey.example.invalid";

export function assertEnvironmentTemplate(text) {
  const entries = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .map((line) => {
      assert.match(line, /^[A-Z_]+=[^\r\n]*$/);
      const index = line.indexOf("=");
      return [line.slice(0, index), line.slice(index + 1)];
    });
  assert.equal(
    new Set(entries.map(([key]) => key)).size,
    entries.length,
    "Duplicate env keys are forbidden",
  );
  const values = Object.fromEntries(entries);
  const expected = {
    PREVIEW_ONLY: "1",
    COMMERCE_ENABLED: "0",
    VOYEY_LOCAL_ONLY: "1",
    PUBLIC_ORIGIN: publicOrigin,
    ADMIN_ORIGIN: adminOrigin,
    ADMIN_AUTH_MODE: "password",
    ADMIN_PANEL_LOGIN: "voyey_admin",
    ADMIN_ACCESS_EMAILS: "admin@example.invalid",
  };
  for (const key of [
    "ADMIN_PANEL_PASSWORD_HASH",
    "ACCESS_TEAM_DOMAIN",
    "ACCESS_AUD",
    "JWT_SECRET",
    "ADMIN_PROXY_SECRET",
    "TELEGRAM_BOT_TOKEN",
    "TELEGRAM_WEBHOOK_SECRET",
    "TELEGRAM_CHANNEL_ID",
    "TELEGRAM_SALES_USERNAME",
    "ADMIN_TELEGRAM_IDS",
    "VOYEY_OWNER_TELEGRAM_ID",
    "MANUAL_PAYMENT_CARD_HOLDER",
    "MANUAL_PAYMENT_CARD_NUMBER",
    "MANUAL_PAYMENT_INSTRUCTIONS_RU",
    "MANUAL_PAYMENT_INSTRUCTIONS_UZ",
  ])
    expected[key] = "";
  assert.deepEqual(
    values,
    expected,
    "The future env template must contain only inactive placeholders",
  );
}

// Stage 1.1 is local only. Unknown keys and environment overrides fail closed.
export function assertLocalConfiguration(config) {
  const keys = [
    "$schema",
    "name",
    "account_id",
    "main",
    "compatibility_date",
    "compatibility_flags",
    "workers_dev",
    "preview_urls",
    "routes",
    "assets",
    "alias",
    "observability",
    "d1_databases",
    "vars",
  ];
  assert.ok(
    Object.keys(config).every((key) => keys.includes(key)),
    "Unknown Worker configuration/override",
  );
  assert.equal(config.name, "voyey-local", "Unexpected Worker target");
  assert.equal(
    config.account_id,
    inactiveAccount,
    "Only an inactive account placeholder is allowed",
  );
  assert.equal(config.main, "src/index.ts");
  assert.equal(config.workers_dev, false);
  assert.equal(config.preview_urls, false);
  assert.deepEqual(config.routes, []);
  assert.deepEqual(config.d1_databases, [
    {
      binding: "DB",
      database_name: "voyey-local",
      database_id: inactiveDatabase,
      migrations_dir: "migrations",
    },
  ]);
  assert.deepEqual(config.vars, {
    PREVIEW_ONLY: "1",
    COMMERCE_ENABLED: "0",
    VOYEY_LOCAL_ONLY: "1",
    PUBLIC_ORIGIN: publicOrigin,
    ADMIN_ORIGIN: adminOrigin,
    ADMIN_AUTH_MODE: "password",
    ADMIN_ACCESS_EMAILS: "admin@example.invalid",
  });
  assert.deepEqual(config.alias, { argon2: "./src/password-disabled.ts" });
  assert.deepEqual(config.assets, {
    directory: "public",
    binding: "ASSETS",
    html_handling: "none",
    not_found_handling: "none",
    run_worker_first: ["/api/*", "/media/*", "/telegram/*", "/health"],
  });
  assert.deepEqual(config.observability, { enabled: false });
  assert.deepEqual(config.compatibility_flags, ["nodejs_compat"]);
  assert.equal(config.compatibility_date, "2026-10-15");
}

export function assertNoRuntimeFiles(directory = root) {
  for (const relative of [
    "",
    "apps/worker",
    "apps/api",
    "apps/bot",
    "apps/admin",
    "apps/miniapp",
  ])
    for (const file of readdirSync(join(directory, relative)))
      if (
        /^(?:\.env|\.dev\.vars)(?:\.|$)/.test(file) &&
        file !== ".env.example"
      )
        throw new Error(
          "Runtime env files are disabled during local isolation: " +
            join(relative, file),
        );
  for (const relative of ["", "apps/worker"])
    for (const file of [
      "wrangler.toml",
      "wrangler.json",
      "wrangler.config.ts",
      "cloudflare.config.ts",
    ])
      assert.ok(
        !existsSync(join(directory, relative, file)),
        "Unexpected alternate Wrangler configuration: " + join(relative, file),
      );
}

export function assertLegacyConfiguration(config, routes) {
  assert.equal(config.account_id, inactiveAccount);
  assert.equal(config.workers_dev, false);
  assert.equal(config.preview_urls, false);
  for (const key of ["routes", "env", "d1_databases", "r2_buckets", "services"])
    assert.equal(
      config[key],
      undefined,
      "Legacy remote target must stay inactive",
    );
  for (const [key, value] of Object.entries(config.vars)) {
    if (key === "ADMIN_TELEGRAM_IDS") {
      assert.equal(value, "");
      continue;
    }
    assert.ok(
      [
        "API_HOST",
        "MINIAPP_HOST",
        "ADMIN_HOST",
        "BOT_HOST",
        "API_URL",
        "ADMIN_ORIGIN",
        "MINI_APP_URL",
        "STORAGE_PUBLIC_BASE_URL",
      ].includes(key),
    );
    const url = new URL(value.includes("://") ? value : "https://" + value);
    assert.ok(
      url.hostname.endsWith(".invalid") && !url.username && !url.password,
    );
  }
  for (const route of routes)
    assert.ok(route.pattern.endsWith(".voyey.example.invalid"));
}

export function checkProject() {
  assertLocalConfiguration(
    JSON.parse(readFileSync(join(root, "apps/worker/wrangler.jsonc"), "utf8")),
  );
  assertEnvironmentTemplate(readFileSync(join(root, ".env.example"), "utf8"));
  // This historical file contains trailing commas but no comments or executable config.
  const legacy = JSON.parse(
    readFileSync(
      join(root, "deploy/cloudflare/wrangler.jsonc"),
      "utf8",
    ).replace(/,\s*([}\]])/g, "$1"),
  );
  assertLegacyConfiguration(
    legacy,
    JSON.parse(
      readFileSync(join(root, "deploy/cloudflare/routes.example.json"), "utf8"),
    ),
  );
  assertNoRuntimeFiles();
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  checkProject();
  console.log(
    "VOYEY local isolation: OK; inactive Cloudflare/D1, no routes, credentials or env overrides.",
  );
}
