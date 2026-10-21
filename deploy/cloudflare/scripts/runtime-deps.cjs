const assert = require("node:assert/strict");
const { existsSync, readFileSync, realpathSync } = require("node:fs");
const { createRequire } = require("node:module");
const { dirname, join, resolve, relative } = require("node:path");
function locate(name, root) {
  const requireFrom = createRequire(resolve(root, "package.json"));
  for (const modules of requireFrom.resolve.paths(name) ?? []) {
    const path = join(modules, name, "package.json");
    if (existsSync(path)) return dirname(realpathSync(path));
  }
  return undefined;
}
function verify(source, target) {
  const seen = new Set();
  function visit(a, b) {
    if (seen.has(`${a}|${b}`)) return;
    const within = relative(realpathSync(target), b);
    assert.ok(
      !within.startsWith("..") && !require("node:path").isAbsolute(within),
      "Runtime dependency escapes package",
    );
    seen.add(`${a}|${b}`);
    const left = JSON.parse(readFileSync(join(a, "package.json"), "utf8"));
    const right = JSON.parse(readFileSync(join(b, "package.json"), "utf8"));
    assert.equal(right.name, left.name, "Runtime package name differs");
    assert.equal(
      right.version,
      left.version,
      `Runtime version drift: ${left.name}`,
    );
    for (const name of Object.keys({
      ...left.dependencies,
      ...left.optionalDependencies,
    })) {
      const from = locate(name, a);
      const to = locate(name, b);
      if (!from && !to && name in (left.optionalDependencies ?? {})) continue;
      assert.ok(from && to, `Missing production dependency: ${name}`);
      visit(from, to);
    }
  }
  visit(realpathSync(source), realpathSync(target));
  console.log(
    `Production dependency versions match frozen build (${seen.size} package pairs).`,
  );
}
module.exports = { locate, verify };
if (require.main === module) verify(...process.argv.slice(2));
