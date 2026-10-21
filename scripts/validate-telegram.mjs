/* global process, URL, fetch, AbortSignal, console */
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
const require = createRequire(
  new URL("../apps/api/package.json", import.meta.url),
);
require("dotenv").config({
  path: fileURLToPath(new URL("../.env", import.meta.url)),
  quiet: true,
});
try {
  if (!process.env.TELEGRAM_BOT_TOKEN) throw new Error();
  const response = await fetch(
    `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/getMe`,
    { signal: AbortSignal.timeout(15000) },
  );
  const data = await response.json();
  if (!response.ok || !data.ok || !data.result?.is_bot) throw new Error();
  console.log(
    JSON.stringify({
      valid: true,
      id: data.result.id,
      username: data.result.username,
    }),
  );
} catch {
  console.error(
    "Telegram getMe validation failed (credentials and request URL withheld)",
  );
  process.exitCode = 1;
}
