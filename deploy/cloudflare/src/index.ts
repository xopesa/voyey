import { Container } from "@cloudflare/containers";
import {
  containerRequest,
  selectApp,
  uncached,
  type App,
  type RoutingEnvironment,
} from "./routing.js";

type Bindings = RoutingEnvironment &
  Record<string, unknown> & {
    API: DurableObjectNamespace<ApiContainer>;
    MINIAPP: DurableObjectNamespace<MiniappContainer>;
    ADMIN: DurableObjectNamespace<AdminContainer>;
    BOT: DurableObjectNamespace<BotContainer>;
  };

function environment(
  env: Record<string, unknown>,
  names: string[],
): Record<string, string> {
  const result: Record<string, string> = {
    NODE_ENV: "production",
    INSTANCE_HOST: "0.0.0.0",
    HOSTNAME: "0.0.0.0",
    PORT: "8080",
  };
  for (const name of names) {
    const value = env[name];
    if (typeof value !== "string" || (!value && name !== "ADMIN_TELEGRAM_IDS"))
      throw new Error(`Missing required binding: ${name}`);
    result[name] = value;
  }
  return result;
}

export class ApiContainer extends Container<Bindings> {
  override defaultPort = 8080;
  override sleepAfter = "10m";
  override enableInternet = true; // PostgreSQL TCP/TLS, R2 HTTPS and Telegram HTTPS.
  override envVars = {
    ...environment(this.env, [
      "DATABASE_URL",
      "JWT_SECRET",
      "TELEGRAM_BOT_TOKEN",
      "ADMIN_PROXY_SECRET",
      "ADMIN_PASSWORD_HASH",
      "ADMIN_ORIGIN",
      "ADMIN_TELEGRAM_IDS",
      "MANUAL_PAYMENT_CARD_HOLDER",
      "MANUAL_PAYMENT_CARD_NUMBER",
      "MANUAL_PAYMENT_INSTRUCTIONS_RU",
      "MANUAL_PAYMENT_INSTRUCTIONS_UZ",
      "R2_ACCOUNT_ID",
      "R2_ACCESS_KEY_ID",
      "R2_SECRET_ACCESS_KEY",
      "R2_PUBLIC_BUCKET",
      "R2_PRIVATE_BUCKET",
      "STORAGE_PUBLIC_BASE_URL",
    ]),
    STORAGE_DRIVER: "r2",
    ADMIN_SESSION_DRIVER: "postgres",
    TRUST_PROXY: "",
  };
}
export class MiniappContainer extends Container<Bindings> {
  override defaultPort = 8080;
  override sleepAfter = "10m";
  override enableInternet = true;
  override envVars = environment(this.env, ["API_URL"]);
}
export class AdminContainer extends Container<Bindings> {
  override defaultPort = 8080;
  override sleepAfter = "10m";
  override enableInternet = true;
  override envVars = environment(this.env, ["API_URL", "ADMIN_PROXY_SECRET"]);
}
export class BotContainer extends Container<Bindings> {
  override defaultPort = 8080;
  override sleepAfter = "10m";
  override enableInternet = true;
  override envVars = {
    ...environment(this.env, [
      "TELEGRAM_BOT_TOKEN",
      "TELEGRAM_WEBHOOK_SECRET",
      "MINI_APP_URL",
    ]),
    BOT_MODE: "webhook",
  };
}

export default {
  async fetch(request: Request, env: Bindings): Promise<Response> {
    const app = selectApp(request, env);
    if (!app) return new Response("Not found", { status: 404 });
    if (new URL(request.url).protocol !== "https:")
      return new Response("HTTPS required", { status: 400 });
    const forwarded = containerRequest(request);
    if (!forwarded)
      return new Response("Trusted client IP unavailable", { status: 503 });
    const bindings = {
      api: env.API,
      miniapp: env.MINIAPP,
      admin: env.ADMIN,
      bot: env.BOT,
    };
    try {
      // Singleton API preserves existing per-process login throttles; no autoscaling claim.
      const container = bindings[app as App].getByName("primary");
      return uncached(
        await container.fetch(forwarded),
        app,
        new URL(request.url).pathname,
      );
    } catch {
      return new Response("Service unavailable", {
        status: 503,
        headers: { "Cache-Control": "no-store" },
      });
    }
  },
};
