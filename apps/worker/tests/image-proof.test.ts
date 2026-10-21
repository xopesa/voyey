import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Miniflare, Log, LogLevel, convertV4MiniflareOptions } from "miniflare";
import { JwtTokenService } from "../../api/src/modules/auth/token.js";
import { png, jpeg, webp } from "../../api/tests/fixtures/images.js";

// Disposable workerd/D1 only; fixture credentials cannot access any external service.
let mf: Miniflare;
let db: Awaited<ReturnType<Miniflare["getD1Database"]>>;
let token: string;
let outboundCalls = 0;
before(async () => {
  const jwtSecret = randomBytes(32).toString("hex");
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
        COMMERCE_ENABLED: "1",
        PUBLIC_ORIGIN: "https://preview.invalid",
        ADMIN_ORIGIN: "https://admin.preview.invalid",
        JWT_SECRET: jwtSecret,
        ADMIN_PROXY_SECRET: randomBytes(32).toString("hex"),
        TELEGRAM_BOT_TOKEN: "123456:" + randomBytes(32).toString("base64url"),
        MANUAL_PAYMENT_CARD_HOLDER: "LOCAL TEST ONLY",
        MANUAL_PAYMENT_CARD_NUMBER: "LOCAL TEST ONLY",
        MANUAL_PAYMENT_INSTRUCTIONS_RU: "Test",
        MANUAL_PAYMENT_INSTRUCTIONS_UZ: "Test",
      },
      outboundService: async () => {
        outboundCalls++;
        throw new Error("Image proof tests must not call external services");
      },
      log: new Log(LogLevel.NONE),
    }),
  );
  db = await mf.getD1Database("DB");
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
  await db
    .prepare(
      "INSERT INTO User(id,telegramId,updatedAt) VALUES('image-buyer','730001',1)",
    )
    .run();
  for (const id of ["corrupt", "png", "jpeg", "webp"])
    await db
      .prepare(
        `INSERT INTO "Order"(id,publicId,userId,idempotencyKey,fullName,phone,city,address,subtotal,total,requiredPrepayment,remainingAmount,updatedAt)
      VALUES(?,?,'image-buyer',?,'Fixture Buyer','+998900000000','Test city','Test address',100,100,50,50,1)`,
      )
      .bind(id, "STZ-IMAGE-" + id, "checkout-fixture-" + id)
      .run();
  token = await new JwtTokenService(jwtSecret).issue("image-buyer");
});
after(async () => {
  await mf?.dispose();
});

async function upload(id: string, data: Buffer, mime: string, key: string) {
  const boundary = "isolated-image-proof-boundary";
  const bytes = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="proof.bin"\r\nContent-Type: ${mime}\r\n\r\n`,
    ),
    data,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  return mf.dispatchFetch(
    "https://preview.invalid/api/orders/STZ-IMAGE-" + id + "/payments",
    {
      method: "POST",
      headers: {
        authorization: "Bearer " + token,
        "content-type": "multipart/form-data; boundary=" + boundary,
        "idempotency-key": key,
      },
      body: bytes,
    } as never,
  );
}
async function count(table: string) {
  return (await db
    .prepare(`SELECT count(*) AS n FROM "${table}"`)
    .first<{ n: number }>())!.n;
}

test("Worker rejects malformed proofs with 415 and creates no Payment/media/chunks or Order changes", async () => {
  const before = await db
    .prepare('SELECT * FROM "Order" WHERE id=?')
    .bind("corrupt")
    .first();
  for (const [data, mime] of [
    [png.subarray(0, 8), "image/png"],
    [png.subarray(0, 33), "image/png"],
    [jpeg.subarray(0, 3), "image/jpeg"],
    [jpeg.subarray(0, -2), "image/jpeg"],
    [webp.subarray(0, 12), "image/webp"],
    [webp.subarray(0, -1), "image/webp"],
    [png, "image/jpeg"],
    [Buffer.alloc(0), "image/png"],
    [Buffer.from("<svg/>"), "image/svg+xml"],
  ] as const) {
    const response = await upload(
      "corrupt",
      data,
      mime,
      "invalid-proof-key-0001",
    );
    assert.equal(response.status, 415, await response.clone().text());
    for (const table of ["Payment", "MediaObject", "MediaChunk", "AuditLog"])
      assert.equal(await count(table), 0, `${table} must remain unchanged`);
    assert.deepEqual(
      await db
        .prepare('SELECT * FROM "Order" WHERE id=?')
        .bind("corrupt")
        .first(),
      before,
    );
  }
});
for (const [format, data, mime] of [
  ["png", png, "image/png"],
  ["jpeg", jpeg, "image/jpeg"],
  ["webp", webp, "image/webp"],
] as const)
  test(`Worker accepts structurally valid ${format} proof through shared validator and D1 storage`, async () => {
    const response = await upload(
      format,
      data,
      mime,
      "valid-proof-key-" + format,
    );
    assert.equal(response.status, 201, await response.clone().text());
    assert.equal(
      (await db
        .prepare('SELECT status FROM "Order" WHERE id=?')
        .bind(format)
        .first<{ status: string }>())!.status,
      "PREPAYMENT_SUBMITTED",
    );
    const payment = await db
      .prepare("SELECT proofStorageKey FROM Payment WHERE orderId=?")
      .bind(format)
      .first<{ proofStorageKey: string }>();
    assert.ok(payment);
    const media = await db
      .prepare("SELECT size,private,contentType FROM MediaObject WHERE key=?")
      .bind(payment.proofStorageKey)
      .first();
    assert.deepEqual(media, {
      size: data.length,
      private: 1,
      contentType: mime,
    });
    assert.equal(
      (await db
        .prepare("SELECT count(*) AS n FROM MediaChunk WHERE objectKey=?")
        .bind(payment.proofStorageKey)
        .first<{ n: number }>())!.n,
      1,
    );
  });
test("isolated image tests make no external calls and live preview stays commerce=0", () => {
  assert.equal(outboundCalls, 0);
  assert.equal(
    JSON.parse(
      readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8"),
    ).vars.COMMERCE_ENABLED,
    "0",
  );
});
