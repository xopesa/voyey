import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import Ajv from "ajv";
import ts from "typescript";
const config = ts.parseConfigFileTextToJson(
  "wrangler.jsonc",
  readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8"),
).config;
const schema = JSON.parse(
  readFileSync(
    new URL("../node_modules/wrangler/config-schema.json", import.meta.url),
    "utf8",
  ),
);
const validate = new Ajv({
  allErrors: true,
  strict: false,
  validateFormats: false,
}).compile(schema);
if (!validate(config)) throw new Error(JSON.stringify(validate.errors));
assert.equal(config.workers_dev, false);
assert.equal(config.preview_urls, false);
assert.equal(config.account_id, "0".repeat(32));
assert.equal(config.routes, undefined);
assert.equal(config.hyperdrive, undefined);
assert.equal(config.containers.length, 4);
for (const container of config.containers) {
  assert.equal(container.max_instances, 1);
  assert.equal(container.image_build_context, "../..");
  assert.ok(
    config.durable_objects.bindings.some(
      (b) => b.class_name === container.class_name,
    ),
  );
}
assert.ok(
  Object.values(config.vars).every((value) => !value.includes("stenzo.uz")),
);
console.log(
  "Wrangler schema/config: OK; inactive account placeholder, no routes, live domains or database bindings.",
);

// The preview example must never target the existing production hostnames.
const previewRoutes = JSON.parse(
  readFileSync(new URL("../routes.example.json", import.meta.url), "utf8"),
);
const isolatedHosts = new Set([
  "store.voyey.example.invalid",
  "api.voyey.example.invalid",
  "admin.voyey.example.invalid",
  "bot.voyey.example.invalid",
]);
assert.equal(previewRoutes.length, isolatedHosts.size);
assert.equal(
  new Set(previewRoutes.map((route) => route.pattern)).size,
  isolatedHosts.size,
);
for (const route of previewRoutes) {
  assert.ok(
    isolatedHosts.has(route.pattern),
    "Preview route must use an isolated hostname",
  );
  assert.equal(route.custom_domain, true);
}
console.log(
  "Preview route example: OK; existing production hosts excluded. No routes applied.",
);
