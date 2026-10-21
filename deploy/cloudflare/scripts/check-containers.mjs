import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../../../", import.meta.url));
const ignore = readFileSync(resolve(root, ".dockerignore"), "utf8");
for (const excluded of [
  "**/.env",
  "**/.env.*",
  "**/.dev.vars*",
  "**/node_modules",
  "**/.git",
  "**/storage",
  "**/storage-private",
  "**/payment-proofs",
])
  assert.ok(ignore.split(/\r?\n/).includes(excluded));
for (const app of ["api", "miniapp", "admin", "bot"]) {
  const dockerfile = readFileSync(
    new URL(`../${app}/Dockerfile`, import.meta.url),
    "utf8",
  );
  for (const required of [
    "node:24.21.0-bookworm-slim",
    "--frozen-lockfile",
    "USER node",
    "EXPOSE 8080",
    "HEALTHCHECK",
    'ENTRYPOINT ["/usr/bin/tini", "--"]',
  ])
    assert.ok(dockerfile.includes(required), `${app}: ${required}`);
  assert.ok(!/migrate|db:seed|wrangler deploy|COPY.*\.env/.test(dockerfile));
  assert.ok(dockerfile.includes("FROM base AS runtime"));
  const runtime = dockerfile.split("FROM base AS runtime")[1];
  assert.ok(!runtime.includes("pnpm install") && !runtime.includes("COPY . ."));
  if (["miniapp", "admin"].includes(app))
    assert.ok(runtime.includes(".next/standalone"));
  else assert.ok(dockerfile.includes("deploy --legacy --prod --offline /out"));
  console.log(`${app}: static container contract OK`);
}
const docker = spawnSync("docker", ["info"], {
  encoding: "utf8",
  timeout: 10000,
  windowsHide: true,
});
if (docker.error || docker.status !== 0)
  console.log(
    "Container image build: NOT AVAILABLE (Docker engine absent/unavailable); static checks only.",
  );
else
  console.log(
    "Docker available. Build linux/amd64 images using the documented commands; this check does not deploy or build automatically.",
  );
