import Fastify, {
  type FastifyInstance,
  type FastifyServerOptions,
} from "fastify";
import { infrastructureIsolated, isStenzoHost } from "./isolation.js";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";
import { handleAsNodeRequest } from "cloudflare:node";
import { withDatabase } from "@stenzo/database";
import { buildApp } from "../../api/src/application.js";
import { registerErrorHandler } from "../../api/src/plugins/error-handler.js";
import { healthRoutes } from "../../api/src/modules/health/route.js";
import { registerCatalogModule } from "../../api/src/modules/catalog/index.js";
import { CatalogService } from "../../api/src/modules/catalog/service.js";
import { PrismaCatalogRepository } from "../../api/src/modules/catalog/repository.js";
import { UserService } from "../../api/src/modules/users/service.js";
import { CartService } from "../../api/src/modules/cart/service.js";
import { registerCartModule } from "../../api/src/modules/cart/index.js";
import { OrderService } from "../../api/src/modules/orders/service.js";
import { CheckoutService } from "../../api/src/modules/checkout/service.js";
import { PaymentService } from "../../api/src/modules/payments/service.js";
import { AdminCatalogService } from "../../api/src/modules/admin/catalog/service.js";
import { D1VariantGenerator } from "../../api/src/d1/variant-generator.js";
import { AdminDashboardService } from "../../api/src/modules/admin/dashboard.js";
import { D1DashboardRepository } from "../../api/src/d1/dashboard.js";
import { BannerService } from "../../api/src/modules/marketing/banners.js";
import {
  registerPublicBanners,
  registerMarketingAdminRoutes,
} from "../../api/src/modules/marketing/routes.js";
import {
  registerPromoAdmin,
  registerPromoValidation,
} from "../../api/src/modules/marketing/promo-routes.js";
import { createAuthGuard } from "../../api/src/modules/auth/middleware.js";
import { registerManualOrderRoutes } from "../../api/src/modules/admin/manual-orders.js";
import { registerProcurement } from "../../api/src/modules/admin/finance/procurement.js";
import { registerExpenses } from "../../api/src/modules/admin/finance/expenses.js";
import { registerFinance } from "../../api/src/modules/admin/finance/analytics.js";
import { registerLifecycle } from "../../api/src/modules/admin/lifecycle.js";
import { registerOrderDashboardVisibility } from "../../api/src/modules/admin/order-dashboard-visibility.js";
import { registerWarehouseEstimate } from "../../api/src/modules/admin/warehouse-estimate.js";
import { registerRefunds } from "../../api/src/modules/admin/refunds.js";
import { registerCustomerNotes } from "../../api/src/modules/admin/customer-notes.js";
import { registerCustomerRoutes } from "../../api/src/modules/admin/customers.js";
import { createAdminGuard } from "../../api/src/modules/admin/authorization.js";
import { JwtTokenService } from "../../api/src/modules/auth/token.js";
import { registerAuthModule } from "../../api/src/modules/auth/index.js";
import { TelegramChannelPublisher } from "../../api/src/modules/telegram-channel/publisher.js";
import { D1PublicationStore } from "../../api/src/modules/telegram-channel/store.js";
import {
  ImageStorageService,
  PrivateImageStorageService,
} from "../../api/src/modules/media/service.js";
import {
  createPublicStorage,
  createPrivateStorage,
} from "../../api/src/modules/media/providers.js";
import {
  WebAdminSessions,
  COOKIE_NAME,
  ADMIN_LOGIN,
  SESSION_SECONDS,
} from "../../api/src/modules/admin/web-session.js";
import {
  NotificationService,
  TelegramNotificationProvider,
} from "../../api/src/modules/notifications/index.js";
import { D1AdminSessionStore } from "../../api/src/d1/session-store.js";
import { D1MediaBucket } from "../../api/src/d1/media.js";
import {
  D1UserRepository,
  D1CartRepository,
  D1OrderRepository,
  D1PaymentRepository,
  D1AdminCatalogRepository,
} from "../../api/src/d1/repositories.js";
import { withStorage } from "../../api/src/d1/runtime.js";
import { withSettings, type Settings } from "../../api/src/config/env.js";
import { createStenzoBot } from "../../bot/src/bot.js";
import { withAdminPrincipal } from "../../api/src/d1/principal.js";
import { D1TelegramAdminStore } from "../../api/src/d1/telegram-admins.js";
import { D1NotificationDeliveryStore } from "../../api/src/d1/notification-deliveries.js";
import { D1CustomerNotificationDeliveryStore } from "../../api/src/d1/customer-notification-deliveries.js";
import {
  adminAuthenticationMode,
  adminPasswordConfiguration,
  passwordPrincipal,
  verifyAdminPasswordProof,
} from "./admin-password.js";
import {
  authenticateAccess,
  accessConfiguration,
  type AccessIdentity,
} from "./access.js";

export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  PUBLIC_IMAGES?: R2Bucket;
  PRIVATE_PROOFS?: R2Bucket;
  PREVIEW_ONLY: string;
  COMMERCE_ENABLED: string;
  VOYEY_LOCAL_ONLY?: string;
  PUBLIC_ORIGIN?: string;
  ADMIN_ORIGIN?: string;
  ACCESS_TEAM_DOMAIN?: string;
  ACCESS_AUD?: string;
  ADMIN_ACCESS_EMAILS?: string;
  ADMIN_PANEL_LOGIN?: string;
  ADMIN_AUTH_MODE?: string;
  ADMIN_PANEL_PASSWORD_HASH?: string;
  JWT_SECRET?: string;
  ADMIN_PROXY_SECRET?: string;
  ADMIN_TELEGRAM_IDS?: string;
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_WEBHOOK_SECRET?: string;
  TELEGRAM_CHANNEL_ID?: string;
  TELEGRAM_SALES_USERNAME?: string;
  MANUAL_PAYMENT_CARD_HOLDER?: string;
  MANUAL_PAYMENT_CARD_NUMBER?: string;
  MANUAL_PAYMENT_INSTRUCTIONS_RU?: string;
  MANUAL_PAYMENT_INSTRUCTIONS_UZ?: string;
}
const commerceKeys = [
  "PUBLIC_ORIGIN",
  "JWT_SECRET",
  "ADMIN_PROXY_SECRET",
  "TELEGRAM_BOT_TOKEN",
  "MANUAL_PAYMENT_CARD_HOLDER",
  "MANUAL_PAYMENT_CARD_NUMBER",
  "MANUAL_PAYMENT_INSTRUCTIONS_RU",
  "MANUAL_PAYMENT_INSTRUCTIONS_UZ",
] as const;
export function missingConfiguration(env: Env): string[] {
  return commerceKeys.filter((key) => !env[key]);
}
function json(value: unknown, status = 200) {
  return Response.json(value, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
function settings(env: Env): Settings {
  return {
    NODE_ENV: "production",
    ADMIN_PASSWORD_HASH: "",
    ADMIN_ORIGIN: env.ADMIN_ORIGIN ?? env.PUBLIC_ORIGIN!,
    ADMIN_SESSION_DRIVER: "postgres",
    ADMIN_PROXY_SECRET: env.ADMIN_PROXY_SECRET,
    ADMIN_TELEGRAM_IDS: env.ADMIN_TELEGRAM_IDS ?? "",
    JWT_SECRET: env.JWT_SECRET!,
    TELEGRAM_BOT_TOKEN: env.TELEGRAM_BOT_TOKEN ?? "",
    TELEGRAM_INIT_DATA_TTL_SECONDS: 600,
    MANUAL_PAYMENT_CARD_HOLDER: env.MANUAL_PAYMENT_CARD_HOLDER ?? "",
    MANUAL_PAYMENT_CARD_NUMBER: env.MANUAL_PAYMENT_CARD_NUMBER ?? "",
    MANUAL_PAYMENT_INSTRUCTIONS_RU: env.MANUAL_PAYMENT_INSTRUCTIONS_RU ?? "",
    MANUAL_PAYMENT_INSTRUCTIONS_UZ: env.MANUAL_PAYMENT_INSTRUCTIONS_UZ ?? "",
    MAX_IMAGE_UPLOAD_SIZE: 5 * 1024 * 1024,
    MAX_PAYMENT_PROOF_UPLOAD_SIZE: 5 * 1024 * 1024,
    STORAGE_DRIVER: "r2",
    STORAGE_LOCAL_PATH: "/unused-public",
    STORAGE_PRIVATE_PATH: "/unused-private",
    STORAGE_PUBLIC_BASE_URL: env.PUBLIC_ORIGIN! + "/media",
    DATABASE_URL: "d1-binding",
    API_PORT: 3001,
  };
}
const caches = new WeakMap<Env, Map<string, Promise<FastifyInstance>>>();
const paymentServices = new WeakMap<Env, PaymentService>();
const ports = new WeakMap<FastifyInstance, number>();
let nextPort = 45000;
async function appFor(
  env: Env,
  mode: "catalog" | "auth" | "cart" | "full",
): Promise<FastifyInstance> {
  let cache = caches.get(env);
  if (!cache) {
    cache = new Map();
    caches.set(env, cache);
  }
  const key = mode;
  let cached = cache.get(key);
  if (cached) return cached;
  cached = (async () => {
    if (mode !== "full") {
      const app = Fastify({ logger: false, trustProxy: false });
      registerErrorHandler(app);
      registerPublicBanners(app);
      await app.register(healthRoutes);
      registerCatalogModule(app, {
        catalogService: new CatalogService(new PrismaCatalogRepository()),
      });
      if (mode === "auth" || mode === "cart") {
        const userService = new UserService(new D1UserRepository());
        const tokenService = new JwtTokenService(env.JWT_SECRET!);
        registerAuthModule(app, {
          userService,
          tokenService,
        });
        if (mode === "cart")
          registerPromoValidation(
            app,
            createAuthGuard(tokenService, userService),
          );
        if (mode === "cart")
          registerCartModule(app, {
            userService,
            tokenService,
            cartService: new CartService(new D1CartRepository()),
          });
      }
      await app.ready();
      return app;
    }
    const userService = new UserService(new D1UserRepository()),
      tokenService = new JwtTokenService(env.JWT_SECRET!),
      orderRepository = new D1OrderRepository();
    const ids = new Set(
      (env.ADMIN_TELEGRAM_IDS ?? "")
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean),
    );
    const notifications = new NotificationService(
      env.TELEGRAM_BOT_TOKEN
        ? new TelegramNotificationProvider(env.TELEGRAM_BOT_TOKEN)
        : {
            async sendText() {
              throw new Error("Preview notifications are disabled");
            },
          },
      new D1TelegramAdminStore(),
      undefined,
      {
        deliveryStore: new D1NotificationDeliveryStore(),
        customerDeliveryStore: new D1CustomerNotificationDeliveryStore(),
        refundDeliveryStore:
          new D1CustomerNotificationDeliveryStore<"refund.completed">(
            "CustomerRefundNotificationDelivery",
          ),
        adminOrigin: env.ADMIN_ORIGIN,
      },
    );
    const imageStorage = new ImageStorageService(
        createPublicStorage(),
        5 * 1024 * 1024,
      ),
      proofStorage = new PrivateImageStorageService(
        createPrivateStorage(),
        5 * 1024 * 1024,
      );
    const paymentService = new PaymentService(
      new D1PaymentRepository(),
      proofStorage,
      {
        cardNumber: env.MANUAL_PAYMENT_CARD_NUMBER ?? "",
        cardHolder: env.MANUAL_PAYMENT_CARD_HOLDER ?? "",
        instructionsRu: env.MANUAL_PAYMENT_INSTRUCTIONS_RU ?? "",
        instructionsUz: env.MANUAL_PAYMENT_INSTRUCTIONS_UZ ?? "",
      },
      notifications,
    );
    const app = buildApp(
      {
        userService,
        tokenService,
        adminUserService: userService,
        adminTokenService: tokenService,
        adminTelegramIds: ids,
        telegramAdminStore: new D1TelegramAdminStore(),
        catalogService: new CatalogService(new PrismaCatalogRepository()),
        cartService: new CartService(new D1CartRepository()),
        orderService: new OrderService(orderRepository),
        checkoutService: new CheckoutService(
          orderRepository,
          undefined,
          notifications,
        ),
        paymentService,
        adminCatalogService: new AdminCatalogService(
          new D1AdminCatalogRepository(),
          imageStorage,
          new TelegramChannelPublisher(
            new D1PublicationStore(),
            new D1AdminCatalogRepository(),
            {
              token: env.TELEGRAM_BOT_TOKEN,
              channel: env.TELEGRAM_CHANNEL_ID,
              salesUsername: env.TELEGRAM_SALES_USERNAME,
              origin: env.PUBLIC_ORIGIN,
            },
          ),
          new D1VariantGenerator(),
        ),
        adminDashboardService: new AdminDashboardService(
          new D1DashboardRepository(),
        ),
        adminCatalogImageStorage: imageStorage,
        webAdminSessions: new WebAdminSessions(
          "",
          env.ADMIN_ORIGIN ?? env.PUBLIC_ORIGIN!,
          true,
          Date.now,
          new D1AdminSessionStore(),
        ),
      },
      ((options: FastifyServerOptions) =>
        Fastify({
          ...options,
          logger: false,
          trustProxy: false,
        })) as typeof Fastify,
    );
    registerCustomerNotes(
      app,
      createAdminGuard(tokenService, userService, ids),
    );
    registerProcurement(app, createAdminGuard(tokenService, userService, ids));
    registerExpenses(app, createAdminGuard(tokenService, userService, ids));
    registerFinance(app, createAdminGuard(tokenService, userService, ids));
    registerOrderDashboardVisibility(
      app,
      createAdminGuard(tokenService, userService, ids),
    );
    registerWarehouseEstimate(
      app,
      createAdminGuard(tokenService, userService, ids),
    );
    registerLifecycle(
      app,
      createAdminGuard(tokenService, userService, ids),
      notifications,
    );
    registerRefunds(
      app,
      createAdminGuard(tokenService, userService, ids),
      notifications,
    );
    registerManualOrderRoutes(
      app,
      createAdminGuard(tokenService, userService, ids),
    );
    registerPublicBanners(app);
    registerPromoValidation(app, createAuthGuard(tokenService, userService));
    registerPromoAdmin(app, createAdminGuard(tokenService, userService, ids));
    registerCustomerRoutes(
      app,
      createAdminGuard(tokenService, userService, ids),
    );
    registerMarketingAdminRoutes(
      app,
      new BannerService(imageStorage),
      createAdminGuard(tokenService, userService, ids),
    );
    await app.ready();
    paymentServices.set(env, paymentService);
    return app;
  })();
  cache.set(key, cached);
  cached.catch(() => cache!.delete(key));
  return cached;
}
async function limitedBody(request: Request, max: number) {
  if (!request.body) return undefined;
  const reader = request.body.getReader(),
    chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const part = await reader.read();
    if (part.done) break;
    size += part.value.length;
    if (size > max) {
      await reader.cancel();
      throw Object.assign(new Error("Body too large"), { status: 413 });
    }
    chunks.push(part.value);
  }
  return Buffer.concat(
    chunks.map((x) => Buffer.from(x)),
    size,
  );
}
async function api(request: Request, env: Env) {
  const url = new URL(request.url),
    path = url.pathname.slice(4) || "/";
  // No client-supplied forwarding, credentials or internal signature headers are trusted.
  const admin = path === "/admin" || path.startsWith("/admin/");
  let identity: AccessIdentity | undefined;
  let passwordConfig: ReturnType<typeof adminPasswordConfiguration>;
  let adminMode: ReturnType<typeof adminAuthenticationMode>;
  if (admin) {
    if (
      !env.ADMIN_ORIGIN ||
      !env.PUBLIC_ORIGIN ||
      !env.JWT_SECRET ||
      !env.ADMIN_PROXY_SECRET
    )
      return json({ error: "Admin configuration is incomplete" }, 503);
    try {
      adminMode = adminAuthenticationMode(env);
      if (adminMode === "access") accessConfiguration(env);
      passwordConfig = adminPasswordConfiguration(env);
    } catch {
      return json(
        { error: "Admin authentication configuration is incomplete" },
        503,
      );
    }
    if (url.origin !== env.ADMIN_ORIGIN)
      return json({ error: "Use the separate Admin origin" }, 403);
    if (adminMode === "password") {
      identity = {
        principalHash: createHash("sha256")
          .update(JSON.stringify(["password-admin", env.ADMIN_ORIGIN]))
          .digest("hex"),
      };
    } else {
      try {
        identity = await authenticateAccess(request, env);
      } catch {
        return json({ error: "Cloudflare Access authorization required" }, 403);
      }
    }
    if (path === "/admin/auth/login" && !passwordConfig)
      return json({ error: "Use Cloudflare Access sign-in" }, 404);
  }
  const commerce = env.COMMERCE_ENABLED === "1";
  if (!commerce && path === "/admin/orders/manual" && request.method === "POST")
    return json(
      { error: "Preview commerce is disabled", code: "COMMERCE_DISABLED" },
      503,
    );
  const auth =
    path === "/auth/telegram" || path === "/me" || path === "/me/preferences";
  const cart =
    path === "/cart" ||
    path.startsWith("/cart/") ||
    path === "/promo-codes/validate";
  if (
    !commerce &&
    !admin &&
    !auth &&
    !cart &&
    path !== "/home/banners" &&
    !["/health", "/ready"].includes(path) &&
    !path.startsWith("/catalog/")
  )
    return json(
      {
        error:
          "Preview commerce is disabled until separate credentials are configured",
        code: "COMMERCE_DISABLED",
      },
      503,
    );
  if (
    (auth || cart) &&
    (!env.JWT_SECRET ||
      env.JWT_SECRET.length < 32 ||
      !validOrigin(env.PUBLIC_ORIGIN) ||
      (path === "/auth/telegram" && !env.TELEGRAM_BOT_TOKEN))
  )
    return json(
      { error: "Preview authentication is temporarily unavailable" },
      503,
    );
  if (commerce && !admin && !auth) {
    const missing = missingConfiguration(env);
    if (missing.length)
      return json(
        { error: "Missing preview configuration", names: missing },
        503,
      );
  }
  if ((commerce && !auth) || admin) {
    if (
      !env.JWT_SECRET ||
      !env.ADMIN_PROXY_SECRET ||
      env.JWT_SECRET.length < 32 ||
      env.ADMIN_PROXY_SECRET.length < 32 ||
      !validOrigin(env.PUBLIC_ORIGIN) ||
      (admin && !validOrigin(env.ADMIN_ORIGIN))
    )
      return json({ error: "Invalid preview security configuration" }, 503);
  }
  const run = async () => {
    const app = await appFor(
      env,
      admin || (commerce && !auth)
        ? "full"
        : cart
          ? "cart"
          : auth
            ? "auth"
            : "catalog",
    );
    const headers: Record<string, string> = {};
    for (const name of [
      "accept",
      "content-type",
      "authorization",
      "idempotency-key",
      "origin",
      "cookie",
      "x-csrf-token",
      "x-stenzo-admin",
    ]) {
      const value = request.headers.get(name);
      if (value) headers[name] = value;
    }
    if (admin) {
      delete headers.authorization;
      const cookie = request.headers
        .get("cookie")
        ?.split(";")
        .map((x) => x.trim())
        .find((x) => x.startsWith(COOKIE_NAME + "="));
      if (cookie) headers.cookie = cookie;
      else delete headers.cookie;
      if (path === "/admin/auth/method") {
        if (request.method !== "GET")
          return json({ error: "Method not allowed" }, 405);
        return json({
          passwordRequired: !!passwordConfig,
          ...(passwordConfig
            ? {
                challenge: {
                  salt: passwordConfig.hash.split("$")[2],
                  iterations: 600000,
                },
              }
            : {}),
        });
      }
      if (
        path === "/admin/auth/access" ||
        (passwordConfig && path === "/admin/auth/login") ||
        (passwordConfig && path === "/admin/auth/session")
      ) {
        const token = cookie?.slice(COOKIE_NAME.length + 1);
        const sessions = app.webAdminSessions!;
        const login = passwordConfig?.login ?? ADMIN_LOGIN;
        if (path === "/admin/auth/session") {
          if (request.method !== "GET")
            return json({ error: "Method not allowed" }, 405);
          const current = await sessions.get(token);
          return current
            ? json({ login, ...current })
            : json({ error: "Admin session required" }, 401);
        }
        if (request.method !== "POST")
          return json({ error: "Method not allowed" }, 405);
        if (
          request.headers.get("origin") !== env.ADMIN_ORIGIN ||
          request.headers.get("x-stenzo-admin") !== "1"
        )
          return json({ error: "Invalid login request" }, 403);
        const payload = await limitedBody(request, 4096);
        const current = await sessions.get(token);
        if (path === "/admin/auth/access") {
          if (current) return json({ login, ...current });
          if (passwordConfig)
            return json({ error: "Admin password required" }, 401);
        } else {
          const peer = request.headers.get("cf-connecting-ip");
          const ip = peer && isIP(peer) ? peer : "127.0.0.1";
          const attempts = new D1AdminSessionStore();
          const key = createHash("sha256")
            .update(JSON.stringify([identity!.principalHash, ip]))
            .digest("hex");
          if (!(await attempts.reserveAttempt(key, Date.now())))
            return json({ error: "Too many login attempts" }, 429);
          let input: unknown;
          try {
            input = JSON.parse(payload?.toString("utf8") ?? "null");
          } catch {
            /* Invalid input receives the same response as invalid credentials. */
          }
          const validInput =
            input !== null &&
            typeof input === "object" &&
            !Array.isArray(input) &&
            Object.keys(input).length === 2 &&
            "login" in input &&
            typeof input.login === "string" &&
            input.login.length <= 100 &&
            "passwordProof" in input &&
            typeof input.passwordProof === "string";
          if (
            !validInput ||
            !verifyAdminPasswordProof(
              passwordConfig!,
              (input as { login: string }).login,
              (input as { passwordProof: string }).passwordProof,
            )
          )
            return json({ error: "Invalid login or password" }, 401);
          await attempts.clearAttempts(key);
        }
        const issued = await sessions.issueSession();
        await sessions.revoke(token);
        return new Response(
          JSON.stringify({
            login,
            csrfToken: issued.csrfToken,
            expiresAt: issued.expiresAt,
          }),
          {
            headers: {
              "Content-Type": "application/json",
              "Cache-Control": "no-store",
              "Set-Cookie": `${COOKIE_NAME}=${issued.token}; Path=/; Max-Age=${SESSION_SECONDS}; Secure; HttpOnly; SameSite=Strict`,
            },
          },
        );
      }
    }
    const peer = request.headers.get("cf-connecting-ip");
    const ip = peer && isIP(peer) ? peer : "127.0.0.1";
    if (env.ADMIN_PROXY_SECRET) {
      const at = String(Date.now());
      headers["x-stenzo-client-ip"] = ip;
      headers["x-stenzo-client-at"] = at;
      headers["x-stenzo-client-signature"] = createHmac(
        "sha256",
        env.ADMIN_PROXY_SECRET,
      )
        .update(`${at}:${ip}`)
        .digest("hex");
    }
    const body = await limitedBody(request, 5 * 1024 * 1024 + 65536);
    let port = ports.get(app);
    if (port === undefined) {
      port = nextPort++;
      app.server.listen(port);
      ports.set(app, port);
    }
    const target = new URL(request.url);
    target.pathname = path;
    const forwarded = new Request(target, {
      method: request.method,
      headers,
      body: body === undefined ? undefined : new Uint8Array(body),
    });
    const response = await handleAsNodeRequest(port, forwarded);
    const out = new Headers(response.headers);
    out.set("Cache-Control", "no-store");
    out.set("X-Content-Type-Options", "nosniff");
    return new Response(response.body, {
      status: response.status,
      headers: out,
    });
  };
  const configured = () =>
    withSettings(settings(env), () =>
      withStorage(
        {
          publicBucket: env.PUBLIC_IMAGES ?? new D1MediaBucket(false),
          privateBucket: env.PRIVATE_PROOFS ?? new D1MediaBucket(true),
          origin: env.PUBLIC_ORIGIN!,
        },
        run,
      ),
    );
  return admin
    ? withAdminPrincipal(
        passwordPrincipal(identity!.principalHash, passwordConfig),
        configured,
      )
    : commerce || auth || cart
      ? configured()
      : run();
}
function validOrigin(value?: string): boolean {
  try {
    const url = new URL(value ?? "");
    return (
      url.origin === value &&
      url.protocol === "https:" &&
      !isStenzoHost(url.hostname) &&
      !url.username &&
      !url.password
    );
  } catch {
    return false;
  }
}
async function media(request: Request, env: Env) {
  const key = new URL(request.url).pathname.slice("/media/".length);
  if (
    !["GET", "HEAD"].includes(request.method) ||
    !/^products\/[a-f0-9-]+\.(?:png|jpe?g|webp)$/.test(key)
  )
    return json({ error: "Not found" }, 404);
  const bucket = env.PUBLIC_IMAGES ?? new D1MediaBucket(false);
  const object = await bucket.get(key);
  if (!object) return json({ error: "Not found" }, 404);
  const headers = new Headers({
    "Cache-Control": "public, max-age=86400",
    "X-Content-Type-Options": "nosniff",
  });
  object.writeHttpMetadata(headers);
  headers.set("etag", object.httpEtag);
  return new Response(request.method === "HEAD" ? null : object.body, {
    headers,
  });
}
async function webhook(request: Request, env: Env) {
  if (request.method !== "POST")
    return json({ error: "Method not allowed" }, 405);
  if (
    !env.TELEGRAM_BOT_TOKEN ||
    !env.TELEGRAM_WEBHOOK_SECRET ||
    !/^[A-Za-z0-9_-]{1,256}$/.test(env.TELEGRAM_WEBHOOK_SECRET) ||
    !validOrigin(env.PUBLIC_ORIGIN)
  )
    return json({ error: "Separate preview bot is not configured" }, 503);
  const header = Buffer.from(
    request.headers.get("x-telegram-bot-api-secret-token") ?? "",
  );
  const expected = Buffer.from(env.TELEGRAM_WEBHOOK_SECRET);
  if (header.length !== expected.length || !timingSafeEqual(header, expected))
    return json({ error: "Forbidden" }, 403);
  const body = await limitedBody(request, 256 * 1024);
  let update;
  try {
    update = JSON.parse(body?.toString("utf8") ?? "null");
  } catch {
    return json({ error: "Invalid Telegram update" }, 400);
  }
  if (!update || !Number.isSafeInteger(update.update_id))
    return json({ error: "Invalid Telegram update" }, 400);
  const run = async () => {
    const reviewCallback =
      typeof update.callback_query?.data === "string" &&
      update.callback_query.data.startsWith("adm:pay:");
    if (env.COMMERCE_ENABLED === "1" && reviewCallback) {
      if (missingConfiguration(env).length)
        return json(
          { error: "Preview commerce configuration is incomplete" },
          503,
        );
      await appFor(env, "full");
    }
    const bot = createStenzoBot(
      {
        token: env.TELEGRAM_BOT_TOKEN!,
        miniAppUrl: env.PUBLIC_ORIGIN!,
        users: new UserService(new D1UserRepository()),
        telegramAdmins: new D1TelegramAdminStore(),
        paymentReviews:
          env.COMMERCE_ENABLED === "1" && reviewCallback
            ? paymentServices.get(env)
            : undefined,
        adminPanelUrl: env.ADMIN_ORIGIN
          ? new URL("/admin/", env.ADMIN_ORIGIN).href
          : undefined,
      },
      { client: { fetch: fetch.bind(globalThis) } },
    );
    await bot.init();
    await bot.handleUpdate(update);
    return json({ ok: true });
  };
  return withSettings(settings(env), () =>
    withStorage(
      {
        publicBucket: env.PUBLIC_IMAGES ?? new D1MediaBucket(false),
        privateBucket: env.PRIVATE_PROOFS ?? new D1MediaBucket(true),
        origin: env.PUBLIC_ORIGIN!,
      },
      run,
    ),
  );
}
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    // Fail before touching D1, storage, redirects, Access or Telegram.
    if (env.PREVIEW_ONLY !== "1")
      return json({ error: "Preview isolation guard is required" }, 503);
    if (!infrastructureIsolated(env))
      return json({ error: "VOYEY infrastructure isolation check failed" }, 503);
    if (isStenzoHost(url.hostname))
      return json({ error: "Existing production host is not a target" }, 503);
    try {
      if (url.pathname === "/health")
        return json({
          status: "ok",
          service: "stenzo-workers-preview",
          commerceEnabled: env.COMMERCE_ENABLED === "1",
        });
      if (url.pathname.startsWith("/api/"))
        return await withDatabase(env.DB.withSession("first-primary"), () =>
          api(request, env),
        );
      if (url.pathname.startsWith("/media/"))
        return await withDatabase(env.DB.withSession("first-primary"), () =>
          media(request, env),
        );
      if (url.pathname === "/telegram/webhook")
        return await withDatabase(env.DB.withSession("first-primary"), () =>
          webhook(request, env),
        );
      if (!["GET", "HEAD"].includes(request.method))
        return json({ error: "Method not allowed" }, 405);
      if (
        env.ADMIN_ORIGIN &&
        url.origin === env.ADMIN_ORIGIN &&
        (url.pathname === "/" || url.pathname === "/login")
      )
        return Response.redirect(
          env.ADMIN_ORIGIN +
            (url.pathname === "/login" ? "/admin/login" : "/admin/"),
          302,
        );
      if (
        env.ADMIN_ORIGIN &&
        url.origin !== env.ADMIN_ORIGIN &&
        (url.pathname === "/admin" || url.pathname.startsWith("/admin/"))
      )
        return Response.redirect(
          env.ADMIN_ORIGIN + url.pathname + url.search,
          302,
        );
      const asset = await env.ASSETS.fetch(request);
      if (asset.status !== 404) return asset;
      // Only application page routes receive SPA fallback; unknown asset paths remain 404.
      if (/\.[A-Za-z0-9]+$/.test(url.pathname)) return asset;
      const admin =
        url.pathname === "/admin" || url.pathname.startsWith("/admin/");
      url.pathname = admin ? "/admin/index.html" : "/index.html";
      url.search = "";
      const response = await env.ASSETS.fetch(new Request(url, request));
      const headers = new Headers(response.headers);
      headers.set("Cache-Control", "no-store");
      return new Response(response.body, { status: response.status, headers });
    } catch (error) {
      if (error instanceof Error)
        console.error(
          "Preview request failure",
          error.name,
          error.stack?.split("\n").slice(1, 5).join("\n"),
        );
      const status =
        error &&
        typeof error === "object" &&
        "status" in error &&
        error.status === 413
          ? 413
          : 500;
      return json(
        {
          error:
            status === 413
              ? "Request body too large"
              : "Preview request failed",
        },
        status,
      );
    }
  },
};
