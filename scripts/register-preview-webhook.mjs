import { pathToFileURL } from "node:url";

const previewUrl = "https://store.voyey.example.invalid/telegram/webhook";
export async function registerPreviewWebhook({
  token,
  secret,
  username,
  fetcher,
}) {
  if (
    !/^[0-9]+:[A-Za-z0-9_-]+$/.test(token) ||
    !/^[A-Za-z0-9_-]{1,256}$/.test(secret)
  )
    throw new Error("Invalid preview credentials");
  if (!/^[A-Za-z0-9_]{5,32}$/.test(username))
    throw new Error("Provide the dedicated preview bot username");
  if (typeof fetcher !== "function")
    throw new Error(
      "Remote webhook registration is disabled; only an injected test transport is allowed",
    );
  const call = async (method, body = {}) => {
    try {
      const response = await fetcher(
        `https://api.telegram.org/bot${token}/${method}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(20000),
        },
      );
      const data = await response.json();
      if (!response.ok || data.ok !== true) throw new Error();
      return data.result;
    } catch {
      throw new Error("Telegram request failed; credential values are hidden");
    }
  };
  const bot = await call("getMe");
  if (bot.username?.toLowerCase() !== username.toLowerCase())
    throw new Error(
      "Bot identity does not match the supplied preview username",
    );
  const existing = await call("getWebhookInfo");
  if (existing.url && existing.url !== previewUrl)
    throw new Error("Refusing to replace a webhook outside this preview");
  const menu = await call("getChatMenuButton");
  if (
    menu.type === "web_app" &&
    new URL(menu.web_app.url).origin !== "https://store.voyey.example.invalid"
  )
    throw new Error("Refusing a bot whose menu points outside this preview");
  // An update with no sender/message creates no User and sends no chat message.
  // Probe the deployed secret before asking Telegram to deliver updates there.
  let probe;
  try {
    probe = await fetcher(previewUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-telegram-bot-api-secret-token": secret,
      },
      body: JSON.stringify({ update_id: 0 }),
      signal: AbortSignal.timeout(20000),
    });
  } catch {
    throw new Error("Preview webhook probe failed; credentials are hidden");
  }
  if (probe.status !== 200)
    throw new Error(
      "Preview webhook is not ready or its secret does not match Wrangler",
    );
  await call("setWebhook", {
    url: previewUrl,
    secret_token: secret,
    allowed_updates: ["message", "callback_query"],
    max_connections: 1,
    drop_pending_updates: false,
  });
  const current = await call("getWebhookInfo");
  if (current.url !== previewUrl)
    throw new Error("Preview webhook was not confirmed");
  return { bot: bot.username, url: previewUrl, registered: true };
}

// CLI is deliberately disabled before reading credentials or making any request.
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  await import("./blocked-remote.mjs");
}
