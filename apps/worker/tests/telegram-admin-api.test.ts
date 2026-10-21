import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Miniflare, Log, LogLevel, convertV4MiniflareOptions } from "miniflare";
import { generateKeyPair, exportJWK, SignJWT } from "jose";
import type { TelegramAdminDto } from "@stenzo/shared";

let mf: Miniflare;
let headers: Record<string, string>;
let assertion: string;
const webhookSecret = randomBytes(32).toString("base64url");
const calls: { method: string; body: Record<string, unknown> }[] = [];
before(async () => {
  const { privateKey, publicKey } = await generateKeyPair("RS256");
  const issuer = "https://b3-test.cloudflareaccess.com",
    aud = "e".repeat(64),
    email = "owner@example.test";
  assertion = await new SignJWT({ email, type: "app" })
    .setProtectedHeader({ alg: "RS256", kid: "b3" })
    .setIssuer(issuer)
    .setAudience(aud)
    .setSubject("owner")
    .setIssuedAt()
    .setExpirationTime("15m")
    .sign(privateKey);
  mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      scriptPath: fileURLToPath(new URL("../dist/index.js", import.meta.url)),
      compatibilityDate: "2026-10-15",
      compatibilityFlags: ["nodejs_compat"],
      d1Databases: ["DB"],
      serviceBindings: {
        ASSETS: async () => new Response("missing", { status: 404 }),
      },
      bindings: {
        PREVIEW_ONLY: "1",
        COMMERCE_ENABLED: "0",
        PUBLIC_ORIGIN: "https://preview.invalid",
        ADMIN_ORIGIN: "https://admin.preview.invalid",
        ACCESS_TEAM_DOMAIN: issuer,
        ACCESS_AUD: aud,
        ADMIN_ACCESS_EMAILS: email,
        JWT_SECRET: randomBytes(32).toString("hex"),
        ADMIN_PROXY_SECRET: randomBytes(32).toString("hex"),
        TELEGRAM_BOT_TOKEN: "123456:" + randomBytes(32).toString("base64url"),
        TELEGRAM_WEBHOOK_SECRET: webhookSecret,
        ADMIN_TELEGRAM_IDS: "999",
      },
      outboundService: async (request: Request) => {
        const url = new URL(request.url);
        if (url.origin === issuer)
          return Response.json({
            keys: [
              {
                ...(await exportJWK(publicKey)),
                kid: "b3",
                alg: "RS256",
                use: "sig",
              },
            ],
          });
        assert.equal(url.hostname, "api.telegram.org");
        const method = url.pathname.split("/").at(-1)!,
          body = (await request.json()) as Record<string, unknown>;
        calls.push({ method, body });
        const result =
          method === "getMe"
            ? {
                id: 123456,
                is_bot: true,
                first_name: "Test",
                username: "synthetic_preview_bot",
              }
            : method === "answerCallbackQuery"
              ? true
              : {
                  message_id: calls.length,
                  date: 1,
                  chat: { id: Number(body.chat_id), type: "private" },
                };
        return Response.json({ ok: true, result });
      },
      log: new Log(LogLevel.NONE),
    }),
  );
  const db = await mf.getD1Database("DB");
  for (const name of readdirSync(
    new URL("../migrations/", import.meta.url),
  ).sort())
    for (const sql of readFileSync(
      new URL("../migrations/" + name, import.meta.url),
      "utf8",
    )
      .split(/;\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean))
      await db.prepare(sql).run();
  headers = {
    "cf-access-jwt-assertion": assertion,
    origin: "https://admin.preview.invalid",
    "x-stenzo-admin": "1",
    "content-type": "application/json",
  };
  const login = await admin("auth/access", { method: "POST" });
  assert.equal(login.status, 200);
  headers.cookie = login.headers.get("set-cookie")!.split(";")[0]!;
  headers["x-csrf-token"] = (
    (await login.json()) as { csrfToken: string }
  ).csrfToken;
});
after(async () => {
  await mf?.dispose();
});
function admin(
  path: string,
  init: RequestInit = {},
  overrides: Record<string, string | undefined> = {},
) {
  const combined = { ...headers, ...overrides };
  if (!init.body) delete combined["content-type"];
  return mf.dispatchFetch("https://admin.preview.invalid/api/admin/" + path, {
    ...init,
    headers: combined,
  } as never);
}
async function botCommand(id: number, text = "/admin") {
  const update = {
    update_id: calls.length + 1,
    message: {
      message_id: calls.length + 1,
      date: 1,
      from: {
        id,
        is_bot: false,
        first_name: "Test",
        username: "owner",
        language_code: "ru",
      },
      chat: { id, type: "private" },
      text,
      entities: [{ offset: 0, length: text.length, type: "bot_command" }],
    },
  };
  const response = await mf.dispatchFetch(
    "https://preview.invalid/telegram/webhook",
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-telegram-bot-api-secret-token": webhookSecret,
      },
      body: JSON.stringify(update),
    },
  );
  assert.equal(response.status, 200);
}

test("Telegram settings require Access AND web session; public host and bearer cannot bypass", async () => {
  for (const overrides of [
    { "cf-access-jwt-assertion": "" },
    { cookie: "" },
    { cookie: "", authorization: "Bearer untrusted", "x-stenzo-admin": "1" },
  ]) {
    const response = await admin("telegram/admins", {}, overrides);
    assert.ok([401, 403].includes(response.status));
  }
  assert.equal(
    (
      await mf.dispatchFetch(
        "https://preview.invalid/api/admin/telegram/admins",
        { headers },
      )
    ).status,
    403,
  );
});

test("Telegram admin mutations enforce Origin/CSRF, strict validation, defaults and duplicates", async () => {
  const body = JSON.stringify({ telegramId: "101", label: "Synthetic" });
  for (const overrides of [
    { "x-csrf-token": "" },
    { origin: "https://evil.invalid" },
  ])
    assert.equal(
      (await admin("telegram/admins", { method: "POST", body }, overrides))
        .status,
      403,
    );
  for (const telegramId of [
    "0",
    "-1",
    "01",
    "1e2",
    "9007199254740992",
    "@owner",
  ])
    assert.equal(
      (
        await admin("telegram/admins", {
          method: "POST",
          body: JSON.stringify({ telegramId }),
        })
      ).status,
      400,
    );
  assert.equal(
    (
      await admin("telegram/admins", {
        method: "POST",
        body: JSON.stringify({ telegramId: "101", admin: true }),
      })
    ).status,
    400,
  );
  const created = await admin("telegram/admins", { method: "POST", body });
  assert.equal(created.status, 201);
  const row = (await created.json()) as TelegramAdminDto;
  assert.ok(row.isActive && row.notifyNewOrders && row.notifyPayments);
  assert.equal(row.user, null);
  assert.equal(
    (await admin("telegram/admins", { method: "POST", body })).status,
    409,
  );
  assert.equal(
    (
      await admin("telegram/admins/missing", {
        method: "PATCH",
        body: JSON.stringify({ isActive: false }),
      })
    ).status,
    404,
  );
  assert.equal(
    (
      await admin(`telegram/admins/${row.id}`, {
        method: "PATCH",
        body: JSON.stringify({ telegramId: "999" }),
      })
    ).status,
    400,
  );
});

test("Worker bot uses fresh D1 role, legacy env cannot grant bot role; disable/enable immediate", async () => {
  const list = (await (await admin("telegram/admins")).json()) as {
    admins: TelegramAdminDto[];
  };
  const row = list.admins.find((a) => a.telegramId === "101")!;
  assert.ok(row);
  calls.length = 0;
  await botCommand(999);
  assert.equal(calls.filter((c) => c.method === "sendMessage").length, 0);
  await botCommand(999, "/start");
  assert.match(String(calls.at(-1)!.body.text), /STENZO/);
  calls.length = 0;
  await botCommand(101);
  assert.equal(calls.at(-1)!.body.text, "STENZO Admin");
  assert.ok(
    JSON.stringify(calls.at(-1)!.body.reply_markup).includes(
      "https://admin.preview.invalid/admin/",
    ),
  );
  assert.equal(
    (
      await admin(`telegram/admins/${row.id}`, {
        method: "PATCH",
        body: JSON.stringify({ isActive: false, notifyPayments: false }),
      })
    ).status,
    200,
  );
  calls.length = 0;
  await botCommand(101);
  assert.equal(calls.filter((c) => c.method === "sendMessage").length, 0);
  assert.equal(
    (
      await admin(`telegram/admins/${row.id}`, {
        method: "PATCH",
        body: JSON.stringify({ isActive: true }),
      })
    ).status,
    200,
  );
  await botCommand(101);
  assert.equal(calls.at(-1)!.body.text, "STENZO Admin");
  const db = await mf.getD1Database("DB");
  const audit = await db
    .prepare("SELECT action,metadata FROM AuditLog WHERE entityId=?")
    .bind(row.id)
    .all<{ action: string; metadata: string }>();
  for (const suffix of ["created", "updated", "disabled", "enabled"])
    assert.ok(
      audit.results.some((a) => a.action === `telegram_admin.${suffix}`),
    );
  const linked = (await (await admin("telegram/admins")).json()) as {
    admins: TelegramAdminDto[];
  };
  assert.equal(linked.admins[0]!.user?.preferredLocale, "uz");
});

test("B3 role management leaves commerce closed and webhook secret required", async () => {
  for (const path of [
    "checkout",
    "orders",
    "payments",
    "payment-proofs/test",
  ]) {
    const response = await mf.dispatchFetch(
      "https://preview.invalid/api/" + path,
      { method: path === "checkout" ? "POST" : "GET" },
    );
    assert.equal(response.status, 503, path);
  }
  assert.equal(
    (
      await mf.dispatchFetch("https://preview.invalid/telegram/webhook", {
        method: "POST",
        body: "{}",
      })
    ).status,
    403,
  );
  const health = await mf.dispatchFetch("https://preview.invalid/health");
  assert.equal(health.status, 200);
  assert.equal(
    ((await health.json()) as { commerceEnabled: boolean }).commerceEnabled,
    false,
  );
  assert.equal((await admin("health")).status, 200);
});
