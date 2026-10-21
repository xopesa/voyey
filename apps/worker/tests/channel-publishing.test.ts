import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomInt, randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Miniflare, Log, LogLevel, convertV4MiniflareOptions } from "miniflare";
import { generateKeyPair, exportJWK, SignJWT } from "jose";
import type { ChannelPublication } from "@stenzo/shared";

let mf: Miniflare;
let headers: Record<string, string>;
const token = "123456:" + randomBytes(32).toString("base64url");
const channel = -(1_000_000_000_000 + randomInt(1_000_000_000));
const calls: { method: string; body: Record<string, unknown> }[] = [];
let allowed = true,
  mainApp = true,
  failSend = false,
  uncertain = false;
let posted = 0;
before(async () => {
  const { privateKey, publicKey } = await generateKeyPair("RS256");
  const issuer = "https://channel-test.cloudflareaccess.com",
    aud = "d".repeat(64),
    email = "owner@example.test";
  const assertion = await new SignJWT({ email, type: "app" })
    .setProtectedHeader({ alg: "RS256", kid: "b2" })
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
        TELEGRAM_BOT_TOKEN: token,
        TELEGRAM_CHANNEL_ID: String(channel),
        TELEGRAM_SALES_USERNAME: "synthetic_sales",
      },
      outboundService: async (request: Request) => {
        const url = new URL(request.url);
        if (url.origin === issuer)
          return Response.json({
            keys: [
              {
                ...(await exportJWK(publicKey)),
                kid: "b2",
                alg: "RS256",
                use: "sig",
              },
            ],
          });
        assert.equal(url.hostname, "api.telegram.org");
        const method = url.pathname.split("/").at(-1)!;
        const body = (await request.json()) as Record<string, unknown>;
        calls.push({ method, body });
        let result: unknown;
        if (method === "getMe")
          result = {
            id: 123456,
            is_bot: true,
            username: "synthetic_preview_bot",
            has_main_web_app: mainApp,
          };
        else if (method === "getChatMenuButton")
          result = {
            type: "web_app",
            web_app: { url: "https://preview.invalid" },
          };
        else if (method === "getChat")
          result = { id: channel, type: "channel" };
        else if (method === "getChatMember")
          result = {
            status: allowed ? "administrator" : "member",
            can_post_messages: allowed,
          };
        else if (method === "sendPhoto") {
          if (uncertain)
            throw new Error("simulated network response loss " + token);
          if (failSend)
            return Response.json(
              {
                ok: false,
                error_code: 400,
                description: "provider text " + token,
              },
              { status: 400 },
            );
          result = { message_id: ++posted, chat: { id: channel } };
        } else throw new Error("Unexpected Telegram method");
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
      .map((x) => x.trim())
      .filter(Boolean))
      await db.prepare(sql).run();
  await db
    .prepare(
      "INSERT INTO Category(id,nameRu,nameUz,slug,sortOrder,isActive,createdAt,updatedAt) VALUES('b2-category','Test','Kiyim','b2-kiyim',0,1,1,1)",
    )
    .run();
  headers = {
    "cf-access-jwt-assertion": assertion,
    origin: "https://admin.preview.invalid",
    "x-stenzo-admin": "1",
    "content-type": "application/json",
  };
  const login = await admin("auth/access", { method: "POST" });
  assert.equal(login.status, 200);
  const session = (await login.json()) as { csrfToken: string };
  headers.cookie = login.headers.get("set-cookie")!.split(";")[0]!;
  headers["x-csrf-token"] = session.csrfToken;
});
beforeEach(() => {
  calls.length = 0;
  allowed = true;
  mainApp = true;
  failSend = false;
  uncertain = false;
});
after(async () => {
  await mf?.dispose();
});
function admin(path: string, init: RequestInit = {}) {
  const combined = {
    ...headers,
    ...Object.fromEntries(new Headers(init.headers)),
  };
  if (!init.body) delete combined["content-type"];
  return mf.dispatchFetch("https://admin.preview.invalid/api/admin/" + path, {
    ...init,
    headers: combined,
  } as never);
}
async function seed(status = "ACTIVE") {
  const id = randomUUID(),
    slug = "b2-" + id;
  const db = await mf.getD1Database("DB");
  await db
    .prepare(
      "INSERT INTO Product(id,categoryId,nameRu,nameUz,slug,descriptionUz,price,currency,status,isFeatured,createdAt,updatedAt) VALUES(?,'b2-category','RU only','Sinov hudi',?,'Qulay kiyim',210000,'UZS',?,0,1,1)",
    )
    .bind(id, slug, status)
    .run();
  await db
    .prepare(
      "INSERT INTO ProductImage(id,productId,url,sortOrder,isPrimary,createdAt) VALUES(?,?,?,0,1,1)",
    )
    .bind(randomUUID(), id, "https://preview.invalid/media/products/aaaa.png")
    .run();
  await db
    .prepare(
      "INSERT INTO ProductVariant(id,productId,sku,size,color,isActive,createdAt,updatedAt) VALUES(?,?,?,'M','Qora',1,1,1)",
    )
    .bind(randomUUID(), id, "synthetic-" + id)
    .run();
  return { id, slug };
}
async function publish(id: string) {
  const response = await admin(`catalog/products/${id}/telegram/publish`, {
    method: "POST",
  });
  assert.equal(response.status, 200);
  return ((await response.json()) as { publication: ChannelPublication })
    .publication;
}
async function stored(id: string) {
  const db = await mf.getD1Database("DB");
  return db
    .prepare("SELECT * FROM TelegramProductPost WHERE productId=?")
    .bind(id)
    .first<Record<string, unknown>>();
}

test("ACTIVE photo publish works at commerce=0, persists receipt/time and safe success audit", async () => {
  const p = await seed();
  const result = await publish(p.id);
  assert.equal(result.status, "PUBLISHED");
  const row = await stored(p.id);
  assert.equal(row!.messageId, result.messageId);
  assert.ok(row!.publishedAt);
  assert.ok(result.publishedAt);
  const send = calls.find((c) => c.method === "sendPhoto")!.body;
  assert.equal(send.photo, "https://preview.invalid/media/products/aaaa.png");
  assert.match(String(send.caption), /210 000 so‘m \+ kargo/);
  assert.doesNotMatch(String(send.caption), /10–12|50%/);
  assert.doesNotMatch(String(send.caption), /RU only|synthetic-/);
  const db = await mf.getD1Database("DB");
  const logs = await db
    .prepare(
      "SELECT action,metadata FROM AuditLog WHERE entityId=? ORDER BY createdAt,id",
    )
    .bind(p.id)
    .all();
  assert.ok(
    logs.results.some((r) => r.action === "telegram.product_publish_started"),
  );
  assert.ok(
    logs.results.some((r) => r.action === "telegram.product_published"),
  );
  assert.ok(!JSON.stringify(logs).includes(token));
  assert.ok(!JSON.stringify(logs).includes(String(channel)));
});
test("repeated publish/repeated activation/HTTP retries do not send another photo", async () => {
  const p = await seed("DRAFT");
  const active = await admin(`catalog/products/${p.id}/activate`, {
    method: "POST",
    body: JSON.stringify({ publishToChannel: true }),
  });
  assert.equal(active.status, 200);
  const activated = (await active.json()) as {
    product: { status: string; telegramPublication: ChannelPublication };
  };
  assert.equal(activated.product.status, "ACTIVE");
  assert.equal(activated.product.telegramPublication.status, "PUBLISHED");
  assert.equal((await publish(p.id)).alreadyPublished, true);
  await admin(`catalog/products/${p.id}/activate`, {
    method: "POST",
    body: JSON.stringify({ publishToChannel: true }),
  });
  await admin(`catalog/products/${p.id}`, {
    method: "PATCH",
    body: JSON.stringify({ nameUz: "Yangi hudi" }),
  });
  assert.equal(calls.filter((c) => c.method === "sendPhoto").length, 1);
});
test("concurrent publishers across requests claim one durable send", async () => {
  const p = await seed();
  const results = await Promise.all([
    publish(p.id),
    publish(p.id),
    publish(p.id),
    publish(p.id),
  ]);
  assert.ok(results.some((r) => r.status === "PUBLISHED"));
  assert.equal(calls.filter((c) => c.method === "sendPhoto").length, 1);
  assert.equal((await stored(p.id))!.status, "PUBLISHED");
});

test("durable PUBLISHED receipt survives later invalid product metadata without repost", async () => {
  const p = await seed();
  assert.equal((await publish(p.id)).status, "PUBLISHED");
  const db = await mf.getD1Database("DB");
  await db.prepare("UPDATE Product SET price=0 WHERE id=?").bind(p.id).run();
  const repeated = await publish(p.id);
  assert.equal(repeated.alreadyPublished, true);
  assert.equal(repeated.status, "PUBLISHED");
  assert.equal(calls.filter((c) => c.method === "sendPhoto").length, 1);
});

test("Telegram acceptance followed by receipt persistence failure blocks duplicate retry", async () => {
  const p = await seed();
  const db = await mf.getD1Database("DB");
  await db
    .prepare(
      `CREATE TRIGGER b2_receipt_failure BEFORE UPDATE ON TelegramProductPost WHEN NEW.productId='${p.id}' AND NEW.status='PUBLISHED' BEGIN SELECT RAISE(ABORT,'synthetic persistence failure'); END`,
    )
    .run();
  try {
    const result = await publish(p.id);
    assert.equal(result.status, "PENDING");
    assert.equal(result.retryAllowed, false);
    assert.equal(result.errorCode, "DELIVERY_UNCONFIRMED");
  } finally {
    await db.prepare("DROP TRIGGER b2_receipt_failure").run();
  }
  assert.equal((await publish(p.id)).status, "PENDING");
  assert.equal(calls.filter((c) => c.method === "sendPhoto").length, 1);
});
test("known Telegram rejection keeps activation ACTIVE, records FAILED and permits safe retry", async () => {
  const p = await seed("INACTIVE");
  failSend = true;
  const response = await admin(`catalog/products/${p.id}/activate`, {
    method: "POST",
    body: JSON.stringify({ publishToChannel: true }),
  });
  assert.equal(response.status, 200);
  const result = (await response.json()) as {
    product: { status: string; telegramPublication: ChannelPublication };
  };
  assert.equal(result.product.status, "ACTIVE");
  assert.equal(
    result.product.telegramPublication.errorCode,
    "PHOTO_UNAVAILABLE",
  );
  assert.equal((await stored(p.id))!.status, "FAILED");
  failSend = false;
  assert.equal((await publish(p.id)).status, "PUBLISHED");
  const db = await mf.getD1Database("DB");
  const failed = await db
    .prepare(
      "SELECT metadata FROM AuditLog WHERE entityId=? AND action='telegram.product_publish_failed'",
    )
    .bind(p.id)
    .all();
  assert.ok(failed.results.length);
  assert.ok(!JSON.stringify(failed).includes(token));
});
test("uncertain delivery never retries automatically or on repeated HTTP publish", async () => {
  const p = await seed();
  uncertain = true;
  const result = await publish(p.id);
  assert.equal(result.status, "PENDING");
  assert.equal(result.retryAllowed, false);
  assert.equal(result.errorCode, "DELIVERY_UNCONFIRMED");
  uncertain = false;
  assert.equal((await publish(p.id)).status, "PENDING");
  assert.equal(calls.filter((c) => c.method === "sendPhoto").length, 1);
});
test("bot must be channel administrator with post_messages; no permission changes are attempted", async () => {
  const p = await seed();
  allowed = false;
  assert.equal((await publish(p.id)).errorCode, "BOT_NOT_ALLOWED");
  assert.equal(
    calls.some((c) => c.method === "sendPhoto"),
    false,
  );
  assert.equal(await stored(p.id), null);
});
test("missing Main Mini App blocks publication instead of sending a broken purchase button", async () => {
  const p = await seed();
  mainApp = false;
  assert.equal((await publish(p.id)).errorCode, "MAIN_MINIAPP_NOT_CONFIGURED");
  assert.equal(
    calls.some((c) => c.method === "sendPhoto"),
    false,
  );
});
test("Admin Access/session/CSRF guard protects the new publish endpoint and public host cannot bypass it", async () => {
  const p = await seed();
  const noCsrf = { ...headers };
  delete noCsrf["x-csrf-token"];
  const denied = await mf.dispatchFetch(
    `https://admin.preview.invalid/api/admin/catalog/products/${p.id}/telegram/publish`,
    { method: "POST", headers: noCsrf },
  );
  assert.equal(denied.status, 403);
  const publicHost = await mf.dispatchFetch(
    `https://preview.invalid/api/admin/catalog/products/${p.id}/telegram/publish`,
    { method: "POST", headers },
  );
  assert.equal(publicHost.status, 403);
  const status = await admin(`catalog/products/${p.id}/telegram`);
  assert.equal(status.status, 200);
  for (const path of ["checkout", "orders", "payments"]) {
    assert.equal(
      (
        await mf.dispatchFetch("https://preview.invalid/api/" + path, {
          method: "POST",
        })
      ).status,
      503,
    );
  }
});

for (const method of ["POST", "PATCH"]) {
  for (const choice of [undefined, false, true]) {
    test(`${method} activation with channel option ${String(choice)} publishes only when explicitly enabled`, async () => {
      const p = await seed("DRAFT");
      const body = {
        ...(method === "PATCH" ? { status: "ACTIVE" } : {}),
        ...(choice === undefined ? {} : { publishToChannel: choice }),
      };
      const response = await admin(
        `catalog/products/${p.id}${method === "POST" ? "/activate" : ""}`,
        { method, body: JSON.stringify(body) },
      );
      assert.equal(response.status, 200);
      const result = (await response.json()) as {
        product: { status: string; telegramPublication?: ChannelPublication };
      };
      assert.equal(result.product.status, "ACTIVE");
      const publicProduct = await mf.dispatchFetch(
        `https://preview.invalid/api/catalog/products/${p.slug}`,
      );
      assert.equal(
        publicProduct.status,
        200,
        "site publication succeeds independently of channel choice",
      );
      if (choice === true) {
        assert.equal(result.product.telegramPublication?.status, "PUBLISHED");
        assert.equal(calls.filter((c) => c.method === "sendPhoto").length, 1);
      } else {
        assert.equal(
          calls.length,
          0,
          "disabled option must not call any Telegram endpoint",
        );
        assert.equal(
          await stored(p.id),
          null,
          "no channel publication row created",
        );
      }
    });
  }
}
test("channel publication option rejects non-booleans before changing catalog status", async () => {
  const p = await seed("DRAFT");
  for (const value of ["false", "true", 1, null]) {
    const response = await admin(`catalog/products/${p.id}/activate`, {
      method: "POST",
      body: JSON.stringify({ publishToChannel: value }),
    });
    assert.equal(response.status, 400);
  }
  const db = await mf.getD1Database("DB");
  assert.equal(
    (await db
      .prepare("SELECT status FROM Product WHERE id=?")
      .bind(p.id)
      .first())!.status,
    "DRAFT",
  );
  assert.equal(calls.length, 0);
});
for (const publishToChannel of [false, true])
  test(`create ACTIVE product strips transport-only channel option ${publishToChannel}`, async () => {
    const response = await admin("catalog/products", {
      method: "POST",
      body: JSON.stringify({
        categoryId: "b2-category",
        nameRu: "Fixture",
        nameUz: "Sinov",
        descriptionUz: "Sinov",
        slug: "create-" + randomUUID(),
        price: 210000,
        status: "ACTIVE",
        publishToChannel,
      }),
    });
    assert.equal(response.status, 201);
    const result = (await response.json()) as {
      product: { status: string; telegramPublication?: ChannelPublication };
    };
    assert.equal(result.product.status, "ACTIVE");
    assert.equal(!!result.product.telegramPublication, publishToChannel);
    assert.equal(
      calls.filter((call) => call.method === "sendPhoto").length,
      0,
      "new product without an image never sends a photo",
    );
    if (!publishToChannel)
      assert.equal(calls.length, 0, "opt-out must not contact Telegram");
  });
