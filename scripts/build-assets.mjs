import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
const root = new URL("../", import.meta.url),
  output = new URL("apps/worker/public/", root);
mkdirSync(output, { recursive: true });
for (const app of ["miniapp", "admin"]) {
  const source = new URL(`apps/${app}/dist/`, root);
  if (!existsSync(source)) throw new Error(`Build ${app} first`);
  cpSync(source, app === "admin" ? new URL("admin/", output) : output, {
    recursive: true,
    force: true,
  });
}
// Static public pages have no customer data. APIs and private proofs never use asset caching.
writeFileSync(
  new URL("_headers", output),
  "/assets/*\n  Cache-Control: public, max-age=31536000, immutable\n/admin/assets/*\n  Cache-Control: public, max-age=31536000, immutable\n/*\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: strict-origin-when-cross-origin\n",
);
const manifest = JSON.parse(
  readFileSync(new URL("package.json", root), "utf8"),
);
console.log(
  `Static assets prepared for ${manifest.name}; no upload performed.`,
);
