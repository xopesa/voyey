import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
// Explicitly synthetic process-only fixtures. Never load a real .env or enable DB/browser tests.
if (existsSync(new URL("../../../.env", import.meta.url)))
  throw new Error(
    "Use an isolated checkout without .env; this runner never reads it.",
  );
const osEnv = {};
for (const name of [
  "PATH",
  "SYSTEMROOT",
  "WINDIR",
  "COMSPEC",
  "PATHEXT",
  "TEMP",
  "TMP",
  "APPDATA",
  "LOCALAPPDATA",
  "USERPROFILE",
  "HOMEDRIVE",
  "HOMEPATH",
  "HOME",
  "COREPACK_HOME",
  "PNPM_HOME",
  "NO_COLOR",
  "TERM",
])
  if (process.env[name] !== undefined) osEnv[name] = process.env[name];
const result = spawnSync(
  process.platform === "win32" ? "cmd.exe" : "corepack",
  process.platform === "win32"
    ? ["/d", "/s", "/c", "corepack pnpm test --cache=local:w --env-mode=loose"]
    : ["pnpm", "test", "--cache=local:w", "--env-mode=loose"],
  {
    cwd: fileURLToPath(new URL("../../../", import.meta.url)),
    stdio: "inherit",
    windowsHide: true,
    env: {
      ...osEnv,
      NODE_ENV: "test",
      DATABASE_URL: "postgresql://test:test@127.0.0.1:1/test",
      JWT_SECRET: "test-only-fixture-".repeat(4),
      TELEGRAM_BOT_TOKEN: "test-only-unusable-token",
      ADMIN_PROXY_SECRET: "test-only-proxy-fixture-".repeat(3),
      ADMIN_PASSWORD_HASH: "",
      ADMIN_ORIGIN: "http://localhost:3002",
      ADMIN_SESSION_DRIVER: "memory",
      ADMIN_TELEGRAM_IDS: "",
      MANUAL_PAYMENT_CARD_HOLDER: "test fixture",
      MANUAL_PAYMENT_CARD_NUMBER: "test fixture",
      MANUAL_PAYMENT_INSTRUCTIONS_RU: "test fixture",
      MANUAL_PAYMENT_INSTRUCTIONS_UZ: "test fixture",
      STORAGE_DRIVER: "local",
      VERCEL: "",
      RUN_POSTGRES_TESTS: "0",
      STENZO_TEST_POSTGRES: "0",
      STENZO_ORDERS_UI_TEST: "0",
      TURBO_TELEMETRY_DISABLED: "1",
      NEXT_TELEMETRY_DISABLED: "1",
      DO_NOT_TRACK: "1",
    },
  },
);
if (result.error) {
  console.error("Unable to start local test runner");
  process.exitCode = 1;
} else process.exitCode = result.status ?? 1;
