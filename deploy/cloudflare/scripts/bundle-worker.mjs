import { createRequire } from "node:module";
import { realpathSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
const requireWrangler = createRequire(
  realpathSync(
    new URL("../node_modules/wrangler/package.json", import.meta.url),
  ),
);
const { build } = await import(
  pathToFileURL(requireWrangler.resolve("esbuild")).href
);
await build({
  entryPoints: [fileURLToPath(new URL("../src/index.ts", import.meta.url))],
  outfile: fileURLToPath(new URL("../dist/worker.js", import.meta.url)),
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  external: ["node:*", "cloudflare:*"],
  logLevel: "warning",
});
console.log(
  "Worker bundle: OK (local esbuild bundled with pinned Wrangler; no deploy/network).",
);
