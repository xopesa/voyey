import { disconnectDatabase } from "@stenzo/database";

import { buildApp } from "./application.js";
import { env } from "./config/env.js";

const app = buildApp();

async function shutdown(signal: string): Promise<void> {
  app.log.info({ signal }, "Shutting down STENZO API");
  await app.close();
  await disconnectDatabase();
  process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

try {
  await app.listen({
    host:
      env.INSTANCE_HOST ??
      (env.NODE_ENV === "production" ? "127.0.0.1" : "0.0.0.0"),
    port: env.PORT ?? env.API_PORT,
  });
} catch (error) {
  app.log.fatal({ err: error }, "Unable to start STENZO API");
  process.exit(1);
}
