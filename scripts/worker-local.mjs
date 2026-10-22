import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { checkProject, root } from "./check-preview.mjs";

export function localArguments(mode, extra = []) {
  if (extra.length || !["build", "dev"].includes(mode))
    throw new Error(
      "Only fixed local build/dev commands are allowed; overrides and remote operations are disabled",
    );
  const config = fileURLToPath(
    new URL("../apps/worker/wrangler.jsonc", import.meta.url),
  );
  const envFile = join(root, ".env.example");
  return mode === "build"
    ? [
        "deploy",
        "--dry-run",
        "--outdir",
        "dist",
        "--config",
        config,
        "--env-file",
        envFile,
      ]
    : [
        "dev",
        "--local",
        "--remote=false",
        "--tunnel=false",
        "--show-interactive-dev-session=false",
        "--ip",
        "127.0.0.1",
        "--persist-to",
        ".wrangler/voyey-local",
        "--config",
        config,
        "--env-file",
        envFile,
      ];
}

export function localEnvironment(source) {
  // No ambient account tokens, proxy credentials, NODE_OPTIONS or service settings.
  const allowed =
    /^(?:PATH|PATHEXT|SYSTEMROOT|WINDIR|COMSPEC|TEMP|TMP|TMPDIR|PROGRAMFILES(?:\(X86\))?|PROGRAMDATA|SYSTEMDRIVE|NUMBER_OF_PROCESSORS|CI|TERM|NO_COLOR)$/i;
  const env = Object.fromEntries(
    Object.entries(source).filter(([key]) => allowed.test(key)),
  );
  const home = join(root, ".cache/voyey-bootstrap/wrangler-home");
  return {
    ...env,
    HOME: home,
    USERPROFILE: home,
    APPDATA: home,
    LOCALAPPDATA: home,
    XDG_CONFIG_HOME: home,
    XDG_CACHE_HOME: home,
    WRANGLER_LOG_PATH: join(home, "wrangler.log"),
    WRANGLER_SEND_METRICS: "false",
    WRANGLER_CI_DISABLE_CONFIG_WATCHING: "true",
    CLOUDFLARE_INCLUDE_PROCESS_ENV: "false",
    CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV: "false",
    CI: "1",
  };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const args = localArguments(process.argv[2], process.argv.slice(3));
  checkProject();
  const cwd = fileURLToPath(new URL("../apps/worker/", import.meta.url));
  const wrangler = fileURLToPath(
    new URL(
      "../apps/worker/node_modules/wrangler/bin/wrangler.js",
      import.meta.url,
    ),
  );
  const env = localEnvironment(process.env);
  mkdirSync(env.HOME, { recursive: true });
  const result = spawnSync(process.execPath, [wrangler, ...args], {
    cwd,
    stdio: "inherit",
    env,
  });
  if (result.error) throw new Error("Local Wrangler could not start");
  process.exitCode = result.status ?? 1;
}
