/* global process, console */
import { execFileSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";

const git = (...args) => execFileSync("git", args, { encoding: "utf8" });
const tracked = process.argv.includes("--tracked");
const files = (tracked
  ? git("ls-files", "-z")
  : git("diff", "--cached", "--name-only", "--diff-filter=ACMR", "-z"))
  .split("\0")
  .filter(Boolean);
const forbidden =
  /(?:^|\/)(?:node_modules|\.next|dist|build|storage|storage-private|uploads?|payment-proofs|dumps|backups|\.vercel)(?:\/|$)|(?:^|\/)\.env(?:\..*)?$|(?:-fixture-.*\.png$)|\.(?:dump|dmp|backup|sql\.gz)$/;
const sensitive = /(?:SECRET|TOKEN|PASSWORD|DATABASE_URL|MANUAL_PAYMENT_CARD)/;
const known = [];
if (existsSync(".env")) {
  for (const line of readFileSync(".env", "utf8").split(/\r?\n/)) {
    const match = line.match(/^([A-Z_]+)=(.*)$/);
    if (!match || !sensitive.test(match[1])) continue;
    const value = match[2].trim().replace(/^(['"])(.*)\1$/, "$2");
    if (value.length >= 12 && !value.startsWith("replace-with-"))
      known.push(value);
  }
}
const rules = [
  ["Telegram token", /\b\d{7,12}:[A-Za-z0-9_-]{35}\b/],
  [
    "Argon2 hash",
    /\$argon2id\$v=19\$m=\d+,t=\d+,p=\d+\$[A-Za-z0-9+/]{16,}\$[A-Za-z0-9+/]{32,}/,
  ],
  ["Private key", /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
  [
    "GitHub credential",
    /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})\b/,
  ],
];
const issues = [];
for (const file of files) {
  if (forbidden.test(file) && !file.endsWith(".env.example"))
    issues.push(`${file}: forbidden artifact`);
  const content = git("show", `:${file}`);
  for (const [name, pattern] of rules)
    if (pattern.test(content)) issues.push(`${file}: ${name}`);
  if (known.some((value) => content.includes(value)))
    issues.push(`${file}: local credential match`);
}
if (issues.length) {
  console.error(issues.join("\n"));
  process.exitCode = 1;
} else
  console.log(
    `${tracked ? "Tracked" : "Staged"} secret/artifact scan passed (${files.length} files). Values never logged.`,
  );
