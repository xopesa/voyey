import { spawnSync } from "node:child_process";
const run = (args) => {
  const result = spawnSync(process.execPath, args, {
    stdio: "inherit",
    env: process.env,
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
};
// Resolve Corepack relative to the installed Node executable on every machine.
import { dirname, join } from "node:path";
import { existsSync } from "node:fs";
const pnpm =
  process.env.npm_execpath ??
  join(dirname(process.execPath), "node_modules/corepack/dist/pnpm.js");
if (!existsSync(pnpm))
  throw new Error(
    "Corepack must be installed with Node.js; run corepack pnpm manually if it is installed elsewhere",
  );
run(["scripts/check-preview.mjs"]);
for (const name of ["database", "shared", "api", "bot", "miniapp", "admin"])
  run([pnpm, "--filter", "@stenzo/" + name, "build"]);
run(["scripts/build-assets.mjs"]);
run([pnpm, "--filter", "@stenzo/worker", "build"]);
