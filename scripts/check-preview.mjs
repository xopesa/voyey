import { readFileSync } from "node:fs";
const config = JSON.parse(
  readFileSync(
    new URL("../apps/worker/wrangler.jsonc", import.meta.url),
    "utf8",
  ),
);
if (config.name !== "stenzo-free-preview")
  throw new Error("Unexpected Worker target");
if (config.containers || config.durable_objects)
  throw new Error("This target must not use Containers or Durable Objects");
const allowedHosts = new Set(["cf.stenzo.uz", "cf-admin.stenzo.uz"]);
for (const route of config.routes ?? []) {
  if (!route.custom_domain || !allowedHosts.has(route.pattern))
    throw new Error(
      "Only the two inventoried isolated custom domains are allowed",
    );
}
if (config.account_id !== "21451653d8243b3dcfab6c23b8f9cc04")
  throw new Error("Unexpected Cloudflare account");
if (config.vars?.PREVIEW_ONLY !== "1")
  throw new Error("Preview isolation guard missing");
if (
  config.d1_databases?.length !== 1 ||
  config.d1_databases[0].database_name !== "stenzo-free-preview" ||
  config.d1_databases[0].database_id !== "ed46a2ff-cff3-4b00-9853-d2438a57e806"
)
  throw new Error("Unexpected database target");
console.log("Preview target is isolated; no production routes or Containers.");
