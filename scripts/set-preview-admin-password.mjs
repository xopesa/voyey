import { spawn } from "node:child_process";
import { createHash, randomBytes, pbkdf2Sync } from "node:crypto";
import { fileURLToPath } from "node:url";

// Password stays in memory. Only the salted hash and login go to Wrangler stdin.
// ADMIN_AUTH_MODE chooses direct password login or an additional Access factor.
const login = process.argv[2];
if (!/^[A-Za-z0-9_-]{3,100}$/.test(login ?? ""))
  throw new Error("Pass the Admin login as the only argument");
if (!process.stdin.isTTY)
  throw new Error("A hidden interactive terminal is required");
process.stdout.write("Admin password (hidden): ");
let password = await new Promise((resolve, reject) => {
  let value = "";
  process.stdin.setRawMode(true);
  process.stdin.setEncoding("utf8");
  process.stdin.resume();
  const stop = () => {
    process.stdin.setRawMode(false);
    process.stdin.pause();
    process.stdin.off("data", receive);
  };
  const receive = (chunk) => {
    for (const character of chunk) {
      if (character === "\u0003") {
        stop();
        reject(new Error("Cancelled"));
        return;
      }
      if (character === "\r" || character === "\n") {
        stop();
        resolve(value);
        return;
      }
      if (character === "\u007f" || character === "\b")
        value = value.slice(0, -1);
      else if (character >= " " && value.length < 1025) value += character;
    }
  };
  process.stdin.on("data", receive);
});
process.stdout.write("\n");
if (password.length < 10 || password.length > 1024)
  throw new Error("Password must contain 10–1024 characters");
const salt = randomBytes(32);
const derivedKey = pbkdf2Sync(password, salt, 600000, 32, "sha256");
const hash = `pbkdf2-sha256$600000$${salt.toString("hex")}$${createHash("sha256").update(derivedKey).digest("hex")}`;
derivedKey.fill(0);
password = "";
const cwd = fileURLToPath(new URL("../apps/worker/", import.meta.url));
const cli = fileURLToPath(
  new URL(
    "../apps/worker/node_modules/wrangler/bin/wrangler.js",
    import.meta.url,
  ),
);
const child = spawn(
  process.execPath,
  [
    cli,
    "secret",
    "bulk",
    "--name",
    "stenzo-free-preview",
    "--config",
    "wrangler.jsonc",
  ],
  { cwd, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] },
);
child.stdout.resume();
child.stderr.resume();
child.stdin.on("error", () => {});
child.stdin.end(
  JSON.stringify({ ADMIN_PANEL_LOGIN: login, ADMIN_PANEL_PASSWORD_HASH: hash }),
);
const code = await new Promise((resolve, reject) => {
  child.once("error", reject);
  child.once("exit", resolve);
});
if (code !== 0)
  throw new Error("Wrangler secret update failed; output suppressed");
console.log(
  "Preview Admin login and salted password hash saved. No password was printed or stored in a file.",
);
