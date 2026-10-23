import assert from "node:assert/strict";
import {
  readFileSync,
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
} from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import {
  assertLocalConfiguration,
  assertLegacyConfiguration,
  assertEnvironmentTemplate,
  assertNoRuntimeFiles,
  checkProject,
  root,
} from "./check-preview.mjs";
import { localArguments, localEnvironment } from "./worker-local.mjs";

const config = () =>
  JSON.parse(
    readFileSync(
      new URL("../apps/worker/wrangler.jsonc", import.meta.url),
      "utf8",
    ),
  );

test("checked-in VOYEY configuration is inactive and credential-free", () => {
  checkProject();
});

test("even the env example cannot inject credentials or origins into Wrangler", () => {
  const text = readFileSync(join(root, ".env.example"), "utf8");
  for (const change of [
    text.replace("JWT_SECRET=", "JWT_SECRET=synthetic"),
    text.replace("VOYEY_OWNER_TELEGRAM_ID=", "VOYEY_OWNER_TELEGRAM_ID=1001"),
    text + "\nCLOUDFLARE_API_TOKEN=synthetic\n",
    text + "\nJWT_SECRET=\n",
    text.replace("COMMERCE_ENABLED=0", "COMMERCE_ENABLED=1"),
    text.replace("store.voyey.example.invalid", "cf.stenzo.uz"),
  ])
    assert.throws(() => assertEnvironmentTemplate(change));
});

test("historical Containers configuration and route examples cannot regain live targets", () => {
  const legacy = JSON.parse(
    readFileSync(
      join(root, "deploy/cloudflare/wrangler.jsonc"),
      "utf8",
    ).replace(/,\s*([}\]])/g, "$1"),
  );
  const routes = JSON.parse(
    readFileSync(join(root, "deploy/cloudflare/routes.example.json"), "utf8"),
  );
  assertLegacyConfiguration(legacy, routes);
  assert.throws(() =>
    assertLegacyConfiguration({ ...legacy, account_id: "old" }, routes),
  );
  assert.throws(() =>
    assertLegacyConfiguration({ ...legacy, env: { production: {} } }, routes),
  );
  assert.throws(() =>
    assertLegacyConfiguration(
      { ...legacy, vars: { API_URL: "https://api.stenzo.uz" } },
      routes,
    ),
  );
  assert.throws(() =>
    assertLegacyConfiguration(legacy, [{ pattern: "cf.stenzo.uz" }]),
  );
});

test("Cloudflare/D1/routes/remote bindings and environment overrides fail closed", () => {
  const changes = [
    (c) => {
      c.account_id = "21451653d8243b3dcfab6c23b8f9cc04";
    },
    (c) => {
      delete c.account_id;
    },
    (c) => {
      c.d1_databases[0].database_id = "ed46a2ff-cff3-4b00-9853-d2438a57e806";
    },
    (c) => {
      c.d1_databases[0].remote = true;
    },
    (c) => {
      c.routes = [{ pattern: "cf.stenzo.uz", custom_domain: true }];
    },
    (c) => {
      c.workers_dev = true;
    },
    (c) => {
      c.preview_urls = true;
    },
    (c) => {
      c.env = { production: {} };
    },
    (c) => {
      c.r2_buckets = [{ binding: "PUBLIC_IMAGES", bucket_name: "old" }];
    },
    (c) => {
      c.services = [{ binding: "OLD", service: "stenzo-free-preview" }];
    },
    (c) => {
      c.vars.PUBLIC_ORIGIN = "https://stenzo.uz";
    },
    (c) => {
      c.vars.ADMIN_ORIGIN = "https://cf-admin.stenzo.uz";
    },
    (c) => {
      c.vars.COMMERCE_ENABLED = "1";
    },
    (c) => {
      delete c.vars.VOYEY_LOCAL_ONLY;
    },
    (c) => {
      c.vars.TELEGRAM_BOT_TOKEN = "synthetic-not-a-real-token";
    },
    (c) => {
      c.vars.ACCESS_TEAM_DOMAIN = "https://cool-bush-5c50.cloudflareaccess.com";
    },
    (c) => {
      c.assets.directory = "../../another-project";
    },
  ];
  for (const change of changes) {
    const altered = config();
    change(altered);
    assert.throws(() => assertLocalConfiguration(altered));
  }
});

test("local runner rejects deploy, remote mode, alternate config and forwarded arguments", () => {
  assert.ok(localArguments("build").includes("--dry-run"));
  assert.ok(localArguments("dev").includes("--local"));
  assert.ok(localArguments("dev").includes("--remote=false"));
  assert.ok(localArguments("dev").includes("--tunnel=false"));
  assert.ok(
    localArguments("dev").includes("--show-interactive-dev-session=false"),
  );
  for (const mode of ["deploy", "secret", "d1", undefined])
    assert.throws(() => localArguments(mode));
  for (const args of [
    ["--remote"],
    ["--config", "old.jsonc"],
    ["--env", "production"],
    ["--var", "COMMERCE_ENABLED:1"],
  ])
    assert.throws(() => localArguments("dev", args));
});

test("ambient credentials and process injection cannot reach the local Worker", () => {
  const env = localEnvironment({
    PATH: "local-bin",
    SYSTEMROOT: "local-system",
    CLOUDFLARE_API_TOKEN: "synthetic",
    CF_API_KEY: "synthetic",
    CLOUDFLARE_ACCOUNT_ID: "old",
    TELEGRAM_BOT_TOKEN: "synthetic",
    JWT_SECRET: "synthetic",
    NODE_OPTIONS: "--import=old.mjs",
    HTTPS_PROXY: "https://old.invalid",
    WRANGLER_ENV: "production",
  });
  assert.equal(env.PATH, "local-bin");
  for (const key of [
    "CLOUDFLARE_API_TOKEN",
    "CF_API_KEY",
    "CLOUDFLARE_ACCOUNT_ID",
    "TELEGRAM_BOT_TOKEN",
    "JWT_SECRET",
    "NODE_OPTIONS",
    "HTTPS_PROXY",
    "WRANGLER_ENV",
  ])
    assert.equal(env[key], undefined);
  assert.equal(env.CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV, "false");
  assert.ok(env.USERPROFILE.startsWith(join(root, ".cache")));
});

test("runtime env files and alternate Wrangler configs are rejected before loading", () => {
  const parent = join(root, ".cache");
  mkdirSync(parent, { recursive: true });
  const temporary = mkdtempSync(join(parent, "voyey-guard-test-"));
  try {
    for (const relative of [
      "apps/worker",
      "apps/api",
      "apps/bot",
      "apps/admin",
      "apps/miniapp",
    ])
      mkdirSync(join(temporary, relative), { recursive: true });
    for (const file of [
      ".env",
      ".env.local",
      "apps/bot/.env",
      "apps/worker/.dev.vars",
      "apps/worker/.dev.vars.test",
      "apps/worker/wrangler.toml",
    ]) {
      writeFileSync(join(temporary, file), "SYNTHETIC_ONLY=1\n");
      assert.throws(() => assertNoRuntimeFiles(temporary));
      rmSync(join(temporary, file));
    }
    assertNoRuntimeFiles(temporary);
  } finally {
    assert.ok(temporary.startsWith(join(root, ".cache", "voyey-guard-test-")));
    rmSync(temporary, { recursive: true, force: true });
  }
});

test("legacy remote scripts exit before prompting or contacting services", () => {
  for (const file of [
    "blocked-remote.mjs",
    "set-preview-admin-password.mjs",
    "validate-telegram.mjs",
    "register-preview-webhook.mjs",
  ]) {
    const result = spawnSync(process.execPath, [join(root, "scripts", file)], {
      encoding: "utf8",
      timeout: 5000,
      env: localEnvironment(process.env),
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /stage 1\.1.*disabled/);
  }
});

test("deployment and legacy package entrypoints stay explicitly blocked", () => {
  const manifest = (file) => JSON.parse(readFileSync(join(root, file), "utf8"));
  assert.equal(
    manifest("package.json").scripts.deploy,
    "node scripts/blocked-remote.mjs",
  );
  assert.equal(
    manifest("package.json").scripts.dev,
    "node scripts/worker-local.mjs dev",
  );
  assert.equal(
    manifest("apps/worker/package.json").scripts.deploy,
    "node ../../scripts/blocked-remote.mjs",
  );
  for (const app of ["api", "bot", "admin", "miniapp"])
    assert.equal(
      manifest(`apps/${app}/package.json`).scripts.start,
      "node ../../scripts/blocked-remote.mjs",
    );
  for (const app of ["api", "admin", "miniapp"]) {
    assert.equal(
      manifest(`deploy/turon/${app}/package.json`).scripts.start,
      "node ../../../scripts/blocked-remote.mjs",
    );
    assert.equal(
      manifest(`apps/${app}/vercel.json`).buildCommand,
      "cd ../.. && node scripts/blocked-remote.mjs",
    );
  }
});

test("webhook helper has no implicit network transport", async () => {
  const { registerPreviewWebhook } =
    await import("./register-preview-webhook.mjs");
  await assert.rejects(
    registerPreviewWebhook({
      token: "123456:synthetic",
      secret: "synthetic",
      username: "voyey_test_bot",
    }),
    /only an injected test transport/,
  );
});
