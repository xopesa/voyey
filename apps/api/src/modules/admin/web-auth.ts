import cookie from "@fastify/cookie";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { HttpError } from "../auth/errors.js";
import { adminLoginIp } from "./proxy-ip.js";
import {
  COOKIE_NAME,
  ADMIN_LOGIN,
  SESSION_SECONDS,
  type WebAdminSessions,
} from "./web-session.js";

export function registerWebAdminAuth(
  app: FastifyInstance,
  sessions: WebAdminSessions,
) {
  void app.register(cookie);
  app.decorate("webAdminSessions", sessions);
  app.decorateRequest("webAdminActor", undefined);
  app.addHook("onSend", async (request, reply, payload) => {
    if (request.url.startsWith("/admin/"))
      reply.header("Cache-Control", "no-store");
    return payload;
  });
  const options = {
    path: "/",
    httpOnly: true,
    secure: sessions.secure,
    sameSite: "strict" as const,
  };
  app.post("/admin/auth/login", { bodyLimit: 4096 }, async (request, reply) => {
    sessions.checkOrigin(request);
    if (request.headers["x-stenzo-admin"] !== "1")
      throw new HttpError(403, "Invalid login request");
    const input = z
      .object({
        login: z.string().max(100),
        password: z.string().min(1).max(1024),
      })
      .strict()
      .safeParse(request.body);
    const session = await sessions.login(
      adminLoginIp(request),
      input.success ? input.data.login : "",
      input.success ? input.data.password : "",
    );
    await sessions.revoke(request.cookies[COOKIE_NAME]);
    reply.setCookie(COOKIE_NAME, session.token, {
      ...options,
      maxAge: SESSION_SECONDS,
    });
    return {
      login: ADMIN_LOGIN,
      csrfToken: session.csrfToken,
      expiresAt: session.expiresAt,
    };
  });
  app.get("/admin/auth/session", async (request) => {
    const session = await sessions.get(request.cookies[COOKIE_NAME]);
    if (!session) throw new HttpError(401, "Admin session required");
    return { login: ADMIN_LOGIN, ...session };
  });
  app.post("/admin/auth/logout", async (request, reply) => {
    // Reuse mutation validation without granting access to other admin resources.
    await sessions.authorize(request);
    await sessions.revoke(request.cookies[COOKIE_NAME]);
    reply.clearCookie(COOKIE_NAME, options);
    return { ok: true };
  });
}
