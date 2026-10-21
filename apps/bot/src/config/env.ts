import { resolve } from "node:path";

import { config } from "dotenv";
import { z } from "zod";

config({ path: resolve(process.cwd(), "../../.env"), quiet: true });

const parsedEnv = z
  .object({
    BOT_MODE: z.enum(["polling", "webhook"]).default("polling"),
    TELEGRAM_WEBHOOK_SECRET: z
      .string()
      .regex(/^[A-Za-z0-9_-]{32,256}$/)
      .optional(),
    PORT: z.coerce.number().int().min(1).max(65535).default(8080),
    INSTANCE_HOST: z.string().default("127.0.0.1"),
    TELEGRAM_BOT_TOKEN: z.string().min(1),
    MINI_APP_URL: z.url(),
  })
  .safeParse(process.env);

if (!parsedEnv.success) {
  throw new Error(
    `Invalid STENZO bot environment:\n${z.prettifyError(parsedEnv.error)}`,
  );
}

export const env = parsedEnv.data;

if (env.BOT_MODE === "webhook" && !env.TELEGRAM_WEBHOOK_SECRET)
  throw new Error("Webhook mode requires TELEGRAM_WEBHOOK_SECRET");
