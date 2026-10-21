import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { createHmac, randomBytes } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Miniflare, Log, LogLevel, convertV4MiniflareOptions } from "miniflare";

const botToken = "123456:" + randomBytes(32).toString("base64url");
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
      },
      outboundService: async () => {
        throw new Error("Auth-only preview must not contact external services");
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
      .map((x) => x.trim())
      .filter(Boolean))
      await db.prepare(sql).run();
});
after(async () => {
  await mf?.dispose();
});
function signed(
  user: Record<string, unknown>,
  authDate = Math.floor(Date.now() / 1000),
) {
  const params = new URLSearchParams({
    auth_date: String(authDate),
    user: JSON.stringify(user),
  });
  const text = [...params]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");
  const key = createHmac("sha256", "WebAppData").update(botToken).digest();
  params.set("hash", createHmac("sha256", key).update(text).digest("hex"));
  return params.toString();
}
const call = (path: string, init: RequestInit = {}) =>
  mf.dispatchFetch("https://preview.invalid/api" + path, init as never);
const login = (initData: string) =>
  call("/auth/telegram", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ initData }),
  });
test("commerce disabled: signed Telegram authentication is allowed without payment/Admin secrets", async () => {
  const r = await login(
    signed({
      id: "9007199254740993",
      first_name: "Synthetic local auth test",
      language_code: "uz",
    }),
  );
  assert.equal(r.status, 200);
  const result = (await r.json()) as {
    accessToken: string;
    user: { telegramId: string; languageCode: string };
  };
  assert.ok(result.accessToken);
  assert.equal(result.user.telegramId, "9007199254740993");
  assert.equal(result.user.languageCode, "uz");
});

test("commerce disabled: /me requires a valid JWT and returns the signed-in user", async () => {
  assert.equal((await call("/me")).status, 401);
  assert.equal(
    (await call("/me", { headers: { authorization: "Bearer forged" } })).status,
    401,
  );
  const auth = await login(signed({ id: "700001", language_code: "uz" }));
  assert.equal(auth.status, 200);
  const session = (await auth.json()) as {
    accessToken: string;
    user: { id: string };
  };
  const me = await call("/me", {
    headers: { authorization: "Bearer " + session.accessToken },
  });
  assert.equal(me.status, 200);
  assert.equal(
    ((await me.json()) as { user: { id: string } }).user.id,
    session.user.id,
  );
});
test("commerce disabled: cart mutation requires authentication", async () => {
  assert.equal((await call("/cart/items", { method: "POST" })).status, 401);
});
for (const [name, path] of [
  ["checkout", "/checkout"],
  ["orders", "/orders"],
  ["payments", "/orders/example/payments"],
  ["payment proofs", "/payments/example/proof"],
] as const) {
  test("commerce disabled: " + name + " stays closed", async () => {
    const r = await call(path, {
      method: path.includes("proof") || path === "/orders" ? "GET" : "POST",
    });
    assert.equal(r.status, 503);
  });
}
test("commerce disabled: webhook stays closed and catalog/readiness stay public", async () => {
  assert.equal(
    (
      await mf.dispatchFetch("https://preview.invalid/telegram/webhook", {
        method: "POST",
      })
    ).status,
    503,
  );
  assert.equal((await call("/catalog/products")).status, 200);
  assert.equal((await call("/ready")).status, 200);
});
test("forged Telegram initData is rejected and creates no User", async () => {
  const db = await mf.getD1Database("DB");
  const before = await db
    .prepare("SELECT count(*) AS n FROM User")
    .first<{ n: number }>();
  const data = signed({ id: "700002" }).replace(
    /hash=[^&]+/,
    "hash=" + "0".repeat(64),
  );
  assert.equal((await login(data)).status, 401);
  assert.equal(
    (await db.prepare("SELECT count(*) AS n FROM User").first<{ n: number }>())
      ?.n,
    before?.n,
  );
});
test("expired Telegram initData is rejected at the unchanged 600-second TTL", async () => {
  assert.equal(
    (await login(signed({ id: "700003" }, Math.floor(Date.now() / 1000) - 601)))
      .status,
    401,
  );
});
test("malformed initData and invalid user profile are rejected", async () => {
  assert.equal((await login("auth_date=1")).status, 401);
  assert.equal((await login(signed({ id: "not-a-number" }))).status, 401);
  assert.equal((await login("")).status, 400);
});
test("repeated Telegram login updates language/profile without duplicate User or lost BigInt precision", async () => {
  const telegramId = "9007199254740989";
  const first = await login(
    signed({ id: telegramId, first_name: "First", language_code: "uz" }),
  );
  assert.equal(first.status, 200);
  const one = (await first.json()) as { user: { id: string } };
  const second = await login(
    signed({ id: telegramId, first_name: "Updated", language_code: "ru" }),
  );
  assert.equal(second.status, 200);
  const two = (await second.json()) as {
    user: { id: string; languageCode: string; telegramId: string };
  };
  assert.equal(two.user.id, one.user.id);
  assert.equal(two.user.languageCode, "ru");
  assert.equal(two.user.telegramId, telegramId);
  const db = await mf.getD1Database("DB");
  assert.deepEqual(
    await db
      .prepare(
        "SELECT count(*) AS n, telegramId, languageCode, firstName FROM User WHERE telegramId=?",
      )
      .bind(telegramId)
      .first(),
    { n: 1, telegramId, languageCode: "ru", firstName: "Updated" },
  );
});

for (const missing of ["TELEGRAM_BOT_TOKEN", "JWT_SECRET"]) {
  test(
    "missing preview " +
      missing +
      ": authentication fails closed without exposing configuration values",
    async () => {
      const bindings: Record<string, string> = {
        PREVIEW_ONLY: "1",
        COMMERCE_ENABLED: "0",
        PUBLIC_ORIGIN: "https://preview.invalid",
        JWT_SECRET: randomBytes(32).toString("hex"),
        TELEGRAM_BOT_TOKEN: botToken,
      };
      delete bindings[missing];
      const isolated = new Miniflare(
        convertV4MiniflareOptions({
          modules: true,
          scriptPath: fileURLToPath(
            new URL("../dist/index.js", import.meta.url),
          ),
          compatibilityDate: "2026-10-15",
          compatibilityFlags: ["nodejs_compat"],
          d1Databases: ["DB"],
          bindings,
          serviceBindings: {
            ASSETS: async () => new Response("not found", { status: 404 }),
          },
          log: new Log(LogLevel.NONE),
        }),
      );
      try {
        const auth = await isolated.dispatchFetch(
          "https://preview.invalid/api/auth/telegram",
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ initData: signed({ id: "700009" }) }),
          },
        );
        assert.equal(auth.status, 503);
        assert.deepEqual(await auth.json(), {
          error: "Preview authentication is temporarily unavailable",
        });
        if (missing === "TELEGRAM_BOT_TOKEN")
          assert.equal(
            (await isolated.dispatchFetch("https://preview.invalid/api/me"))
              .status,
            401,
          );
      } finally {
        await isolated.dispose();
      }
    },
  );
}
