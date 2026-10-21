import { isIP } from "node:net";

export type App = "api" | "miniapp" | "admin" | "bot";
export interface RoutingEnvironment {
  API_HOST: string;
  MINIAPP_HOST: string;
  ADMIN_HOST: string;
  BOT_HOST: string;
}

export function selectApp(
  request: Request,
  env: RoutingEnvironment,
): App | undefined {
  const { hostname } = new URL(request.url);
  if (hostname === env.API_HOST) return "api";
  if (hostname === env.ADMIN_HOST) return "admin";
  if (hostname === env.MINIAPP_HOST) return "miniapp";
  if (
    hostname === env.BOT_HOST &&
    new URL(request.url).pathname === "/telegram/webhook"
  )
    return "bot";
  return undefined;
}

// Called only by the public Worker fetch handler. Container ingress is private to its DO.
export function containerRequest(request: Request): Request | undefined {
  const ip = request.headers.get("CF-Connecting-IP")?.trim();
  if (!ip || !isIP(ip)) return undefined;
  const forwarded = new Request(request);
  for (const name of [
    "forwarded",
    "x-real-ip",
    "x-forwarded-for",
    "x-forwarded-host",
    "x-forwarded-proto",
    "x-vercel-forwarded-for",
    "x-vercel-proxied-for",
    "true-client-ip",
  ])
    forwarded.headers.delete(name);
  forwarded.headers.set("X-Real-IP", ip);
  forwarded.headers.set("X-Forwarded-For", ip);
  forwarded.headers.set("X-Forwarded-Proto", "https");
  forwarded.headers.set("X-Forwarded-Host", new URL(request.url).host);
  // Existing x-stenzo-client-* HMAC from Next -> API is intentionally retained.
  return forwarded;
}

export function uncached(
  response: Response,
  app: App,
  pathname: string,
): Response {
  const result = new Response(response.body, response);
  // No custom Cache API. Only immutable Next chunks may retain their build headers.
  if (app !== "miniapp" || !pathname.startsWith("/_next/static/"))
    result.headers.set("Cache-Control", "private, no-store");
  return result;
}
