import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { createHmac, randomBytes } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Miniflare, Log, LogLevel, convertV4MiniflareOptions } from "miniflare";

const botToken = "123456:" + randomBytes(32).toString("base64url");
// Telegram permits 1–256 characters; exercise a credential shorter than 32.
const webhookSecret = randomBytes(21).toString("base64url");
const telegramCalls: { method: string; payload: Record<string, unknown> }[] =
  [];
let mf: Miniflare;
before(async () => {
  mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      scriptPath: fileURLToPath(new URL("../dist/index.js", import.meta.url)),
      compatibilityDate: "2026-10-15",
      compatibilityFlags: ["nodejs_compat"],
      d1Databases: ["DB"],
      serviceBindings: {
        ASSETS: async () => new Response("not found", { status: 404 }),
      },
      bindings: {
        PREVIEW_ONLY: "1",
        COMMERCE_ENABLED: "0",
        PUBLIC_ORIGIN: "https://preview.invalid",
        JWT_SECRET: randomBytes(32).toString("hex"),
        TELEGRAM_BOT_TOKEN: botToken,
        TELEGRAM_WEBHOOK_SECRET: webhookSecret,
      },
      outboundService: async (request: Request) => {
        const url = new URL(request.url);
        assert.equal(url.hostname, "api.telegram.org");
        const method = url.pathname.split("/").at(-1)!;
        assert.ok(
          ["getMe", "sendMessage", "answerCallbackQuery"].includes(method),
        );
        const payload = request.body
          ? ((await request.json()) as Record<string, unknown>)
          : {};
        telegramCalls.push({ method, payload });
        return Response.json({
          ok: true,
          result:
            method === "getMe"
              ? {
                  id: 123456,
                  is_bot: true,
                  first_name: "Test",
                  username: "preview_test_bot",
                }
              : method === "answerCallbackQuery"
                ? true
                : {
                    message_id: 1,
                    date: 1,
                    chat: { id: 91001, type: "private" },
                    text: "test",
                  },
        });
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
});
after(async () => {
  await mf?.dispose();
});
let updateId = 1;
const telegramUser = (id = 91001) => ({
  id,
  is_bot: false,
  first_name: "Test",
  language_code: "ru",
});
const message = (text: string) => ({
  update_id: updateId++,
  message: {
    message_id: updateId,
    date: 1,
    from: telegramUser(),
    chat: { id: 91001, type: "private" },
    text,
    entities: [{ offset: 0, length: text.length, type: "bot_command" }],
  },
});
const callback = (data: string) => ({
  update_id: updateId++,
  callback_query: {
    id: String(updateId),
    chat_instance: "test",
    from: telegramUser(),
    data,
    message: { message_id: 1, date: 1, chat: { id: 91001, type: "private" } },
  },
});
const webhook = (update: unknown, secret = webhookSecret) =>
  mf.dispatchFetch("https://preview.invalid/telegram/webhook", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-telegram-bot-api-secret-token": secret,
    },
    body: JSON.stringify(update),
  });
async function login(id = 91001) {
  const params = new URLSearchParams({
    auth_date: String(Math.floor(Date.now() / 1000)),
    user: JSON.stringify(telegramUser(id)),
  });
  const data = [...params]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");
  const key = createHmac("sha256", "WebAppData").update(botToken).digest();
  params.set("hash", createHmac("sha256", key).update(data).digest("hex"));
  const response = await mf.dispatchFetch(
    "https://preview.invalid/api/auth/telegram",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ initData: params.toString() }),
    },
  );
  assert.equal(response.status, 200);
  return response.json() as Promise<{
    accessToken: string;
    user: { id: string; preferredLocale: string; languageCode: string };
  }>;
}
const me = (token?: string) =>
  mf.dispatchFetch("https://preview.invalid/api/me", {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
const patch = (locale: unknown, token?: string, extra = {}) =>
  mf.dispatchFetch("https://preview.invalid/api/me/preferences", {
    method: "PATCH",
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ locale, ...extra }),
  });

test("webhook authenticates before reading updates; wrong/missing/Unicode secrets are 403", async () => {
  for (const secret of ["", "incorrect", "é".repeat(64), "x".repeat(64)]) {
    assert.equal((await webhook(message("/start"), secret)).status, 403);
  }
  const db = await mf.getD1Database("DB");
  assert.equal(
    (await db.prepare("SELECT COUNT(*) AS n FROM User").first<{ n: number }>())!
      .n,
    0,
  );
  assert.equal(telegramCalls.length, 0);
});
test("bot-first /start runs at commerce=0, creates exactly one UZ User with RU metadata", async () => {
  assert.equal((await webhook(message("/start"))).status, 200);
  assert.equal((await webhook(message("/start"))).status, 200);
  const db = await mf.getD1Database("DB");
  assert.deepEqual(
    await db
      .prepare("SELECT COUNT(*) AS n, preferredLocale, languageCode FROM User")
      .first(),
    { n: 1, preferredLocale: "uz", languageCode: "ru" },
  );
  assert.match(String(telegramCalls.at(-1)!.payload.text), /xush kelibsiz/);
});
test("bot to Mini App: chosen RU survives Telegram login/upsert and /me exposes it", async () => {
  assert.equal((await webhook(callback("lang:ru"))).status, 200);
  const auth = await login();
  assert.equal(auth.user.preferredLocale, "ru");
  const response = await me(auth.accessToken);
  assert.equal(response.status, 200);
  assert.equal(
    ((await response.json()) as { user: { preferredLocale: string } }).user
      .preferredLocale,
    "ru",
  );
});
test("Mini App to bot: JWT PATCH saves UZ; subsequent /start and login preserve it", async () => {
  const auth = await login();
  assert.equal((await patch("uz", auth.accessToken)).status, 200);
  assert.equal((await webhook(message("/start"))).status, 200);
  assert.match(String(telegramCalls.at(-1)!.payload.text), /xush kelibsiz/);
  assert.equal((await login()).user.preferredLocale, "uz");
  const db = await mf.getD1Database("DB");
  assert.equal(
    (await db
      .prepare("SELECT COUNT(*) AS n FROM User WHERE telegramId='91001'")
      .first<{ n: number }>())!.n,
    1,
  );
});
test("preferences requires JWT, strict locale input and cannot target another User", async () => {
  assert.equal((await patch("ru")).status, 401);
  assert.equal((await patch("ru", "forged")).status, 401);
  const auth = await login();
  const other = await login(91002);
  for (const locale of ["en", "RU", null, {}, 1])
    assert.equal((await patch(locale, auth.accessToken)).status, 400);
  assert.equal(
    (await patch("ru", auth.accessToken, { userId: other.user.id })).status,
    400,
  );
  assert.equal((await patch("ru", auth.accessToken)).status, 200);
  assert.equal((await login(91002)).user.preferredLocale, "uz");
});
test("malformed authorized webhook input is 400 and cannot create users", async () => {
  assert.equal((await webhook({ update_id: "bad" })).status, 400);
  assert.equal(
    (
      await mf.dispatchFetch("https://preview.invalid/telegram/webhook", {
        method: "POST",
        headers: { "x-telegram-bot-api-secret-token": webhookSecret },
        body: "{",
      })
    ).status,
    400,
  );
});
