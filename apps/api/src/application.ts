import Fastify, { type FastifyInstance } from "fastify";

import { env, trustProxy } from "./config/env.js";
import { registerModules, type ModuleDependencies } from "./modules/index.js";
import { registerErrorHandler } from "./plugins/error-handler.js";

export function buildApp(
  dependencies: ModuleDependencies = {},
  createApp: typeof Fastify = Fastify,
): FastifyInstance {
  const app = createApp({
    logger: {
      level: env.NODE_ENV === "production" ? "info" : "debug",
      redact: [
        "req.headers.cookie",
        "req.headers.authorization",
        "req.headers['x-csrf-token']",
        "req.body.password",
        "res.headers['set-cookie']",
      ],
    },
    bodyLimit: 64 * 1024,
    trustProxy,
  });

  registerErrorHandler(app);
  registerModules(app, dependencies);
  return app;
}
