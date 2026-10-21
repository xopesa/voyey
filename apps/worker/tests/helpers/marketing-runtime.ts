import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Miniflare, Log, LogLevel, convertV4MiniflareOptions } from "miniflare";

export async function marketingRuntime(commerce = "1") {
  const salt = randomBytes(32).toString("hex"),
    proof = randomBytes(32).toString("hex");
  const botToken = "123456:" + randomBytes(32).toString("base64url");
  let outboundCalls = 0;
  const mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      scriptPath: fileURLToPath(
        new URL("../../dist/index.js", import.meta.url),
      ),
      compatibilityDate: "2026-10-15",
      compatibilityFlags: ["nodejs_compat"],
      d1Databases: ["DB"],
      log: new Log(LogLevel.NONE),
      serviceBindings: {
        ASSETS: async () => new Response("missing", { status: 404 }),
      },
      bindings: {
        PREVIEW_ONLY: "1",
        COMMERCE_ENABLED: commerce,
        ADMIN_AUTH_MODE: "password",
        PUBLIC_ORIGIN: "https://preview.invalid",
        ADMIN_ORIGIN: "https://admin.preview.invalid",
        JWT_SECRET: randomBytes(32).toString("hex"),
        ADMIN_PROXY_SECRET: randomBytes(32).toString("hex"),
        ADMIN_PANEL_LOGIN: "marketing-fixture",
        ADMIN_PANEL_PASSWORD_HASH: `pbkdf2-sha256$600000$${salt}$${createHash("sha256").update(Buffer.from(proof, "hex")).digest("hex")}`,
        TELEGRAM_BOT_TOKEN: botToken,
        MANUAL_PAYMENT_CARD_HOLDER: "ISOLATED",
        MANUAL_PAYMENT_CARD_NUMBER: "ISOLATED",
        MANUAL_PAYMENT_INSTRUCTIONS_RU: "ISOLATED",
        MANUAL_PAYMENT_INSTRUCTIONS_UZ: "ISOLATED",
      },
      outboundService: async () => {
        outboundCalls++;
        throw new Error(
          "Isolated marketing tests must never reach external services",
        );
      },
    }),
  );
  const db = await mf.getD1Database("DB");
  for (const file of readdirSync(
    new URL("../../migrations/", import.meta.url),
  ).sort())
    for (const sql of readFileSync(
      new URL("../../migrations/" + file, import.meta.url),
      "utf8",
    )
      .split(/;\r?\n/)
      .map((v) => v.trim())
      .filter(Boolean))
      await db.prepare(sql).run();
  const base: Record<string, string> = {
    origin: "https://admin.preview.invalid",
    "x-stenzo-admin": "1",
  };
  const call = async (
    path: string,
    method = "GET",
    body?: unknown,
    headers: Record<string, string> = base,
    origin = "https://admin.preview.invalid",
  ) => {
    const encoded = body instanceof FormData ? new Response(body) : null;
    return mf.dispatchFetch(origin + "/api" + path, {
      method,
      headers: {
        ...headers,
        ...(encoded
          ? { "content-type": encoded.headers.get("content-type")! }
          : body !== undefined
            ? { "content-type": "application/json" }
            : {}),
      },
      ...(body !== undefined
        ? {
            body: encoded
              ? new Uint8Array(await encoded.arrayBuffer())
              : JSON.stringify(body),
          }
        : {}),
    } as never);
  };
  const response = await call("/admin/auth/login", "POST", {
    login: "marketing-fixture",
    passwordProof: proof,
  });
  assert.equal(response.status, 200);
  const issued = (await response.json()) as { csrfToken: string };
  const signed = {
    ...base,
    cookie: response.headers.get("set-cookie")!.split(";")[0]!,
    "x-csrf-token": issued.csrfToken,
  };
  return {
    mf,
    db,
    outboundCalls: () => outboundCalls,
    signed,
    base,
    botToken,
    call,
    admin: (path: string, method = "GET", body?: unknown) =>
      call("/admin" + path, method, body, signed),
  };
}
