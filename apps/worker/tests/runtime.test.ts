import test from "node:test";
import assert from "node:assert/strict";
import { createHmac, randomBytes } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Miniflare, Log, LogLevel, convertV4MiniflareOptions } from "miniflare";
import { withDatabase, type Database } from "@stenzo/database";
import { D1AdminCatalogRepository } from "../../api/src/d1/repositories.js";
import { WEB_ADMIN_ACTOR } from "../../api/src/modules/admin/web-session.js";
import { generateKeyPair, exportJWK, SignJWT } from "jose";
import { png } from "../../api/tests/fixtures/images.js";
test("actual Workers runtime: D1 auth, catalog, checkout, multipart proof and private-file isolation", async () => {
  const token = "123456:" + randomBytes(32).toString("base64url");
  const { privateKey, publicKey } = await generateKeyPair("RS256");
  const publicJwk = {
    ...(await exportJWK(publicKey)),
    kid: "access-test",
    alg: "RS256",
    use: "sig",
  };
  const issuer = "https://stenzo-test.cloudflareaccess.com",
    audience = "a".repeat(64),
    email = "admin@example.test";
  const assertion = (
    override: {
      email?: string;
      subject?: string;
      audience?: string;
      expires?: number;
      issuer?: string;
    } = {},
  ) =>
    new SignJWT({ email: override.email ?? email, type: "app" })
      .setProtectedHeader({ alg: "RS256", kid: "access-test" })
      .setIssuer(override.issuer ?? issuer)
      .setAudience(override.audience ?? audience)
      .setSubject(override.subject ?? "admin-subject")
      .setIssuedAt()
      .setExpirationTime(
        override.expires ?? Math.floor(Date.now() / 1000) + 300,
      )
      .sign(privateKey);
  const mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      scriptPath: fileURLToPath(new URL("../dist/index.js", import.meta.url)),
      compatibilityDate: "2026-10-15",
      compatibilityFlags: ["nodejs_compat"],
      d1Databases: ["DB"],
      serviceBindings: {
        ASSETS: async (request) =>
          new Response(
            new URL(request.url).pathname.endsWith("index.html")
              ? "<html>Static test shell</html>"
              : "Not found",
            {
              status: new URL(request.url).pathname.endsWith("index.html")
                ? 200
                : 404,
            },
          ),
      },
      bindings: {
        PREVIEW_ONLY: "1",
        COMMERCE_ENABLED: "1",
        PUBLIC_ORIGIN: "https://preview.invalid",
        ADMIN_ORIGIN: "https://admin.preview.invalid",
        ACCESS_TEAM_DOMAIN: issuer,
        ACCESS_AUD: audience,
        ADMIN_ACCESS_EMAILS: email,
        JWT_SECRET: randomBytes(32).toString("hex"),
        ADMIN_PROXY_SECRET: randomBytes(32).toString("hex"),
        TELEGRAM_BOT_TOKEN: token,
        MANUAL_PAYMENT_CARD_HOLDER: "LOCAL TEST ONLY",
        MANUAL_PAYMENT_CARD_NUMBER: "LOCAL TEST ONLY",
        MANUAL_PAYMENT_INSTRUCTIONS_RU: "Test",
        MANUAL_PAYMENT_INSTRUCTIONS_UZ: "Test",
      },
      outboundService: async (request) =>
        new URL(request.url).hostname === "stenzo-test.cloudflareaccess.com"
          ? Response.json({ keys: [publicJwk] })
          : Response.json({ ok: true, result: true }),
      log: new Log(LogLevel.NONE),
    }),
  );
  try {
    const db = await mf.getD1Database("DB");
    for (const name of readdirSync(
      new URL("../migrations/", import.meta.url),
    ).sort())
      for (const statement of readFileSync(
        new URL("../migrations/" + name, import.meta.url),
        "utf8",
      )
        .split(/;\r?\n/)
        .map((x) => x.trim())
        .filter(Boolean))
        await db.prepare(statement).run();
    let productId = "",
      variantId = "";
    await withDatabase(db as unknown as Database, async () => {
      const repo = new D1AdminCatalogRepository();
      const cat = await repo.createCategory(WEB_ADMIN_ACTOR, {
        nameRu: "Одежда",
        nameUz: "Kiyim",
        slug: "clothing",
        sortOrder: 0,
        isActive: true,
      });
      const product = await repo.createProduct(WEB_ADMIN_ACTOR, {
        categoryId: cat.id,
        nameRu: "Свитер",
        nameUz: "Sviter",
        slug: "sweater",
        descriptionRu: null,
        descriptionUz: null,
        sourceUrl: null,
        price: 210000,
        currency: "UZS",
        status: "ACTIVE",
        isFeatured: true,
      });
      const variant = await repo.createVariant(WEB_ADMIN_ACTOR, product.id, {
        sku: "E2E-S",
        size: "S",
        color: null,
        stock: null,
        isActive: true,
      });
      productId = product.id;
      variantId = variant.id;
    });
    const call = (path: string, init: RequestInit = {}) =>
      mf.dispatchFetch("https://preview.invalid" + path, init as never);
    const ready = await call("/api/ready");
    assert.equal(ready.status, 200, await ready.text());
    const list = await call("/api/catalog/products");
    assert.equal(list.status, 200);
    assert.equal(
      ((await list.json()) as { products: unknown[] }).products.length,
      1,
    );
    assert.equal((await call("/api/cart")).status, 401);
    const params = new URLSearchParams({
      auth_date: String(Math.floor(Date.now() / 1000)),
      user: JSON.stringify({
        id: "9007199254740993",
        first_name: "Local test",
      }),
    });
    const check = [...params]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${v}`)
      .join("\n");
    const key = createHmac("sha256", "WebAppData").update(token).digest();
    params.set("hash", createHmac("sha256", key).update(check).digest("hex"));
    const auth = await call("/api/auth/telegram", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ initData: params.toString() }),
    });
    assert.equal(auth.status, 200);
    const session = (await auth.json()) as {
      accessToken: string;
      user: { telegramId: string };
    };
    assert.equal(session.user.telegramId, "9007199254740993");
    const headers = {
      authorization: "Bearer " + session.accessToken,
      "content-type": "application/json",
    };
    const add = await call("/api/cart/items", {
      method: "POST",
      headers,
      body: JSON.stringify({
        productId,
        variantId,
        quantity: 1,
        heightCm: 180,
        weightKg: 75,
      }),
    });
    assert.equal(add.status, 201);
    const order = await call("/api/checkout", {
      method: "POST",
      headers: { ...headers, "idempotency-key": "runtime-checkout-key-0001" },
      body: JSON.stringify({
        fullName: "Local Test",
        phone: "+998901234567",
        city: "Tashkent",
        address: "Local test street",
      }),
    });
    assert.equal(order.status, 201);
    const created = (await order.json()) as {
      order: { publicId: string; total: number };
    };
    assert.equal(created.order.total, 210000);
    const file = png;
    const form = new FormData();
    form.set("file", new Blob([file], { type: "image/png" }), "proof.png");
    const encoded = new Request("https://preview.invalid/upload", {
      method: "POST",
      body: form,
    });
    const bytes = await encoded.arrayBuffer();
    const proof = await call(
      "/api/orders/" + created.order.publicId + "/payments",
      {
        method: "POST",
        headers: {
          authorization: headers.authorization,
          "idempotency-key": "runtime-payment-key-0001",
          "content-type": encoded.headers.get("content-type")!,
        },
        body: bytes,
      },
    );
    assert.equal(proof.status, 201);
    const proofResult = (await proof.json()) as { payment: { id: string } };
    const stored = await db
      .prepare("SELECT key FROM MediaObject WHERE private=1")
      .first<{ key: string }>();
    assert.ok(stored);
    assert.equal((await call("/media/" + stored!.key)).status, 404);
    assert.equal(
      (
        await call("/api/admin/auth/session", {
          headers: { "x-real-ip": "1.2.3.4", "x-stenzo-admin": "1" },
        })
      ).status,
      403,
    );
    assert.equal((await call("/catalog/sweater")).status, 200);
    assert.equal(
      (await call("/admin/orders/example", { redirect: "manual" })).status,
      302,
    );
    const admin = (path: string, init: RequestInit = {}) =>
      mf.dispatchFetch(
        "https://admin.preview.invalid/api/admin/" + path,
        init as never,
      );
    assert.equal((await admin("auth/session")).status, 403);
    assert.equal(
      (
        await admin("auth/session", {
          headers: { "cf-access-jwt-assertion": "forged" },
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await admin("auth/session", {
          headers: {
            "cf-access-jwt-assertion": await assertion({
              email: "outsider@example.test",
            }),
          },
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await admin("auth/session", {
          headers: {
            "cf-access-jwt-assertion": await assertion({
              audience: "b".repeat(64),
            }),
          },
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await admin("auth/session", {
          headers: {
            "cf-access-jwt-assertion": await assertion({
              issuer: "https://wrong.cloudflareaccess.com",
            }),
          },
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await admin("auth/session", {
          headers: {
            "cf-access-jwt-assertion": await assertion({
              expires: Math.floor(Date.now() / 1000) - 60,
            }),
          },
        })
      ).status,
      403,
    );
    const access = {
      "cf-access-jwt-assertion": await assertion(),
      origin: "https://admin.preview.invalid",
      "x-stenzo-admin": "1",
    };
    assert.equal(
      (await admin("catalog/categories", { headers: access })).status,
      401,
    );
    assert.equal(
      (
        await admin("auth/access", {
          method: "POST",
          headers: { ...access, origin: "https://evil.invalid" },
        })
      ).status,
      403,
    );
    const login = await admin("auth/access", {
      method: "POST",
      headers: access,
    });
    assert.equal(login.status, 200);
    const setCookie = login.headers.get("set-cookie")!;
    assert.match(setCookie, /Secure/);
    assert.match(setCookie, /HttpOnly/);
    assert.match(setCookie, /SameSite=Strict/);
    const cookie = setCookie.split(";")[0]!;
    const issued = (await login.json()) as { csrfToken: string };
    const signed = { ...access, cookie, "x-csrf-token": issued.csrfToken };
    assert.equal(
      (await admin("auth/session", { headers: signed })).status,
      200,
    );
    assert.equal(
      (
        await admin("auth/session", {
          headers: {
            ...signed,
            "cf-access-jwt-assertion": await assertion({
              subject: "another-subject",
            }),
          },
        })
      ).status,
      401,
    );
    assert.equal(
      (
        await admin("catalog/categories", {
          headers: { ...access, authorization: headers.authorization },
        })
      ).status,
      401,
    );
    assert.equal(
      (
        await admin("catalog/categories", {
          method: "POST",
          headers: { ...access, cookie, "content-type": "application/json" },
          body: JSON.stringify({
            nameRu: "Test",
            nameUz: "Test",
            slug: "csrf-must-fail",
            sortOrder: 0,
          }),
        })
      ).status,
      403,
    );
    const proofRead = await admin(
      "payments/" + proofResult.payment.id + "/proof",
      { headers: signed },
    );
    assert.equal(proofRead.status, 200);
    assert.match(proofRead.headers.get("cache-control") ?? "", /no-store/);
    assert.deepEqual(Buffer.from(await proofRead.arrayBuffer()), file);
    const approval = await admin(
      "payments/" + proofResult.payment.id + "/approve",
      { method: "POST", headers: signed },
    );
    assert.equal(approval.status, 200);
    const sessionCount = await db
      .prepare("SELECT count(*) AS n FROM AdminWebSession")
      .first<{ n: number }>();
    assert.equal(sessionCount?.n, 1);
    const repeated = await admin("auth/access", {
      method: "POST",
      headers: signed,
    });
    assert.equal(repeated.status, 200);
    assert.equal(repeated.headers.get("set-cookie"), null);
    assert.equal(
      (await admin("auth/logout", { method: "POST", headers: signed })).status,
      200,
    );
    assert.equal(
      (await admin("auth/session", { headers: signed })).status,
      401,
    );
  } finally {
    await mf.dispose();
  }
});
