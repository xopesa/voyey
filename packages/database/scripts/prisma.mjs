/* global process */
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
const args = process.argv.slice(2);
if (!["generate", "validate"].includes(args[0]))
  throw new Error(
    "This independent target supports only Prisma type generation/validation; use D1 migrations",
  );
// Generation/validation need URL syntax only; never connect to the placeholder.
process.env.DATABASE_URL =
  "postgresql://placeholder:placeholder@127.0.0.1:5432/placeholder";
const require = createRequire(import.meta.url);
const result = spawnSync(
  process.execPath,
  [require.resolve("prisma/build/index.js"), ...args],
  { stdio: "inherit", env: process.env },
);
process.exitCode = result.status ?? 1;
