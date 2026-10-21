const { cpSync } = require("node:fs");
const { resolve } = require("node:path");
const { locate } = require("./runtime-deps.cjs");
const [source, target] = process.argv.slice(2);
function generated(root) {
  const database = locate("@stenzo/database", root) ?? root;
  const client = locate("@prisma/client", database);
  if (!client) throw new Error("Prisma runtime dependency missing");
  return resolve(client, "../../.prisma");
}
cpSync(generated(source), generated(target), { recursive: true });
