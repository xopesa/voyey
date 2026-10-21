import { webhookCallback } from "grammy";
import { createStenzoBot } from "./bot.js";
import { env } from "./config/env.js";
import { createWebhookServer } from "./webhook-server.js";
import { nodeUsers } from "./node-users.js";

const bot = createStenzoBot({
  token: env.TELEGRAM_BOT_TOKEN,
  miniAppUrl: env.MINI_APP_URL,
  users: nodeUsers,
});

if (env.BOT_MODE === "webhook") {
  // init/getMe only. Never register/delete a Telegram webhook at application startup.
  try {
    await bot.init();
  } catch {
    throw new Error("Unable to initialize STENZO webhook bot");
  }
  const handler = webhookCallback(bot, "std/http", {
    secretToken: env.TELEGRAM_WEBHOOK_SECRET!,
    timeoutMilliseconds: 20_000,
    onTimeout: "throw",
  });
  const server = createWebhookServer(handler, env.TELEGRAM_WEBHOOK_SECRET!);
  server.on("error", () => {
    console.error("Unable to start STENZO webhook server");
    process.exitCode = 1;
  });
  server.listen(env.PORT, env.INSTANCE_HOST, () =>
    console.info("STENZO bot webhook server ready"),
  );
  for (const signal of ["SIGINT", "SIGTERM"])
    process.once(signal, () => {
      server.close(() => {
        process.exitCode = 0;
      });
      server.closeIdleConnections();
    });
} else {
  process.once("SIGINT", () => bot.stop());
  process.once("SIGTERM", () => bot.stop());
  console.info("Starting STENZO Telegram bot");
  await bot.start({ drop_pending_updates: true });
}
