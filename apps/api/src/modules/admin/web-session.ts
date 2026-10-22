import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { verify } from "argon2";
import type { FastifyRequest } from "fastify";
import { HttpError } from "../auth/errors.js";
import {
  MemoryAdminSessionStore,
  type AdminSessionStore,
} from "./session-store.js";

export const ADMIN_LOGIN = "voyey_admin";
export const WEB_ADMIN_ACTOR = `web-admin:${ADMIN_LOGIN}`;
export const SESSION_SECONDS = 8 * 60 * 60;
export const COOKIE_NAME = "voyey_admin_session";
const digest = (value: string) =>
  createHash("sha256").update("voyey:admin:").update(value).digest("hex");

export class WebAdminSessions {
  constructor(
    private readonly passwordHash: string,
    public readonly origin: string,
    public readonly secure = false,
    private readonly now = Date.now,
    private readonly store: AdminSessionStore = new MemoryAdminSessionStore(),
  ) {}

  public async login(ip: string, login: string, password: string) {
    const now = this.now();
    const ipKey = digest(ip);
    if (!(await this.store.reserveAttempt(ipKey, now))) {
      throw new HttpError(429, "Too many login attempts. Try again later");
    }
    // Reservation is atomic across instances and precedes expensive Argon2 verification.
    let valid = false;
    try {
      if (this.passwordHash && password.length <= 1024)
        valid = await verify(this.passwordHash, password);
    } catch {
      /* Never expose the hash, password or Argon2 diagnostics. */
    }
    if (!valid || login !== ADMIN_LOGIN)
      throw new HttpError(401, "Invalid login or password");
    await this.store.clearAttempts(ipKey);
    return this.issueSession();
  }

  // Only the Worker boundary may call this after cryptographic Access verification.
  // The legacy password login above and all session/CSRF/scope protections remain intact.
  public async issueSession() {
    const now = this.now();
    const token = randomBytes(32).toString("base64url");
    const session = {
      csrfToken: randomBytes(32).toString("base64url"),
      expiresAt: now + SESSION_SECONDS * 1000,
    };
    if (!(await this.store.create(digest(token), session, this.now())))
      throw new HttpError(503, "Session capacity reached");
    return { token, ...session };
  }

  public async get(token?: string) {
    return token && token.length <= 100
      ? this.store.get(digest(token), this.now())
      : null;
  }

  public async revoke(token?: string) {
    if (token && token.length <= 100) await this.store.revoke(digest(token));
  }

  public checkOrigin(request: FastifyRequest) {
    if (request.headers.origin !== this.origin)
      throw new HttpError(403, "Invalid request origin");
  }

  public async authorize(request: FastifyRequest): Promise<void> {
    const session = await this.get(request.cookies?.[COOKIE_NAME]);
    if (!session) throw new HttpError(401, "Admin session required");
    if (!["GET", "HEAD", "OPTIONS"].includes(request.method)) {
      this.checkOrigin(request);
      const supplied = request.headers["x-csrf-token"];
      if (
        typeof supplied !== "string" ||
        Buffer.byteLength(supplied) !== Buffer.byteLength(session.csrfToken) ||
        !timingSafeEqual(Buffer.from(supplied), Buffer.from(session.csrfToken))
      ) {
        throw new HttpError(403, "Invalid CSRF token");
      }
    }
    const path = request.url.split("?")[0];
    if (
      path !== "/admin/health" &&
      path !== "/admin/dashboard" &&
      !/^\/admin\/orders\/[A-Za-z0-9_-]+\/(?:lifecycle|cancel|stock-reviewed|dashboard-visibility|warehouse-estimate)$/.test(
        path ?? "",
      ) &&
      !/^\/admin\/finance\/refunds(?:\/[A-Za-z0-9_-]+\/complete)?$/.test(
        path ?? "",
      ) &&
      !/^\/admin\/finance(?:\/expenses(?:\/[A-Za-z0-9_-]+(?:\/void)?)?)?$/.test(
        path ?? "",
      ) &&
      !/^\/admin\/orders\/[A-Za-z0-9_-]+\/(?:finance|items\/[A-Za-z0-9_-]+\/procurement-cost)$/.test(
        path ?? "",
      ) &&
      !/^\/admin\/orders\/manual(?:\/preview)?$/.test(path ?? "") &&
      !/^\/admin\/customers(?:\/[A-Za-z0-9_-]+(?:\/(?:orders|notes))?)?$/.test(
        path ?? "",
      ) &&
      !/^\/admin\/marketing\/promo-codes(?:\/[A-Za-z0-9_-]+(?:\/(?:activate|deactivate))?)?$/.test(
        path ?? "",
      ) &&
      !/^\/admin\/marketing\/banners(?:\/[A-Za-z0-9_-]+(?:\/(?:activate|deactivate|images\/upload))?)?$/.test(
        path ?? "",
      ) &&
      path !== "/admin/auth/logout" &&
      !/^\/admin\/telegram\/admins(?:\/[A-Za-z0-9_-]+)?$/.test(path ?? "") &&
      !/^\/admin\/(?:orders(?:\/[A-Za-z0-9_-]+(?:\/(?:status|request-final-payment))?)?|payments(?:\/[A-Za-z0-9_-]+(?:\/(?:proof|approve|reject))?)?)$/.test(
        path ?? "",
      ) &&
      !/^\/admin\/catalog\/(?:upload-config|categories(?:\/[A-Za-z0-9_-]+(?:\/(?:activate|deactivate|archive|restore))?)?|products(?:\/[A-Za-z0-9_-]+(?:\/(?:activate|deactivate|archive|restore|variants(?:\/generate(?:-preview)?)?|images\/upload|telegram(?:\/publish)?))?)?|(?:images|variants)\/[A-Za-z0-9_-]+(?:\/(?:activate|deactivate))?)$/.test(
        path ?? "",
      )
    ) {
      throw new HttpError(
        403,
        "Web admin access is limited to catalog, orders and payment review",
      );
    }
    request.webAdminActor = WEB_ADMIN_ACTOR;
  }
}

declare module "fastify" {
  interface FastifyInstance {
    webAdminSessions?: WebAdminSessions;
  }
  interface FastifyRequest {
    webAdminActor?: string;
  }
}
