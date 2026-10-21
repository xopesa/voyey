/* global process, URL, console */
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));
const api = resolve(root, "apps/api");
const database = resolve(root, "packages/database");
const require = createRequire(resolve(api, "package.json"));
const docker = process.env.STENZO_TEST_DOCKER || "docker";
const password = randomBytes(32).toString("hex");
const port = process.env.STENZO_PG15_TEST_PORT || "55432";
if (
  !/^\d+$/.test(port) ||
  Number(port) < 1024 ||
  Number(port) > 65535 ||
  port === "5432"
)
  throw new Error("The test port must differ from the working PostgreSQL port");
const url = `postgresql://stenzo_pg15_test:${password}@127.0.0.1:${port}/stenzo_pg15_test?schema=public`;
const env = {
  ...process.env,
  STENZO_PG15_TEST_PASSWORD: password,
  STENZO_PG15_TEST_PORT: port,
  DATABASE_URL: url,
  DIRECT_DATABASE_URL: url,
  NODE_ENV: "test",
  STENZO_TEST_POSTGRES: "1",
  RUN_POSTGRES_TESTS: "1",
  STENZO_ORDERS_UI_TEST: "",
  TELEGRAM_BOT_TOKEN: "isolated-tests-no-telegram-network",
  JWT_SECRET: "isolated-test-jwt-secret-at-least-32-characters",
  ADMIN_TELEGRAM_IDS: "",
  MANUAL_PAYMENT_CARD_NUMBER: "test-only",
  MANUAL_PAYMENT_CARD_HOLDER: "test-only",
  MANUAL_PAYMENT_INSTRUCTIONS_RU: "Test only",
  MANUAL_PAYMENT_INSTRUCTIONS_UZ: "Test only",
};
const compose = [
  "compose",
  "--project-name",
  "stenzo-pg15-check",
  "--file",
  resolve(root, "docker-compose.pg15-test.yml"),
];
function run(command, args, cwd = root) {
  const result = spawnSync(command, args, { cwd, env, stdio: "inherit" });
  if (result.status !== 0)
    throw new Error("PostgreSQL 15 check step failed; no reset was attempted");
}
// Never adopt a container left by another run or touch the main compose project.
const existing = spawnSync(docker, [...compose, "ps", "--all", "--quiet"], {
  cwd: root,
  env,
  encoding: "utf8",
});
if (existing.status !== 0) throw new Error("Docker is unavailable");
if (existing.stdout.trim())
  throw new Error(
    "A previous test container exists; inspect it before starting a fresh check",
  );
try {
  run(docker, [
    ...compose,
    "up",
    "--detach",
    "--wait",
    "--wait-timeout",
    "90",
    "postgres",
  ]);
  for (const args of [["validate"], ["generate"], ["migrate", "deploy"]])
    run(
      process.execPath,
      [resolve(database, "scripts/prisma.mjs"), ...args],
      database,
    );
  run(
    process.execPath,
    [require.resolve("tsx/cli"), resolve(database, "prisma/seed.ts")],
    database,
  );
  run(process.execPath, [require.resolve("vitest/vitest.mjs"), "run"], api);
  console.log(
    "PostgreSQL 15 compatible: YES (fresh migrations and all enabled database tests)",
  );
} finally {
  run(docker, [...compose, "down"]);
}
