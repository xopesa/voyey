import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Miniflare, Log, LogLevel, convertV4MiniflareOptions } from "miniflare";
import { JwtTokenService } from "../../api/src/modules/auth/token.js";
import { png } from "../../api/tests/fixtures/images.js";
import { paymentReviewCallback } from "@stenzo/shared";

for (const type of ["PREPAYMENT", "FINAL"] as const)
  for (const decision of ["approve", "reject"] as const)
    test(`actual Worker wiring: private D1 proof -> photo -> Telegram ${type} ${decision} -> existing service/accounting/customer`, async () => {
      const secret = randomBytes(32).toString("hex"),
        jwtSecret = randomBytes(32).toString("hex");
      const photos: {
        message_id: number;
        date: number;
        chat: { id: number; type: "private" };
        caption: string;
        reply_markup: { inline_keyboard: unknown[][] };
        photo: unknown[];
      }[] = [];
      const texts: { chat: string; text: string }[] = [];
      let seq = 0,
        acks = 0;
      const mf = new Miniflare(
        convertV4MiniflareOptions({
          modules: true,
          scriptPath: fileURLToPath(
            new URL("../dist/index.js", import.meta.url),
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
            COMMERCE_ENABLED: "1",
            PUBLIC_ORIGIN: "https://preview.invalid",
            ADMIN_ORIGIN: "https://admin.preview.invalid",
            JWT_SECRET: jwtSecret,
            ADMIN_PROXY_SECRET: randomBytes(32).toString("hex"),
            TELEGRAM_BOT_TOKEN:
              "123456:" + randomBytes(32).toString("base64url"),
            TELEGRAM_WEBHOOK_SECRET: secret,
            MANUAL_PAYMENT_CARD_HOLDER: "FIXTURE ONLY",
            MANUAL_PAYMENT_CARD_NUMBER: "FIXTURE ONLY",
            MANUAL_PAYMENT_INSTRUCTIONS_RU: "Test",
            MANUAL_PAYMENT_INSTRUCTIONS_UZ: "Test",
          },
          outboundService: async (request) => {
            const url = new URL(request.url);
            assert.equal(
              url.hostname,
              "api.telegram.org",
              "All outbound requests are local Telegram mocks",
            );
            const method = url.pathname.split("/").at(-1);
            if (method === "getMe")
              return Response.json({
                ok: true,
                result: {
                  id: 123456,
                  is_bot: true,
                  first_name: "Fixture",
                  username: "fixture_bot",
                },
              });
            if (method === "sendPhoto") {
              const form = await request.formData(),
                file = form.get("photo") as unknown as Blob;
              assert.ok(file instanceof Blob);
              assert.deepEqual(Buffer.from(await file.arrayBuffer()), png);
              const photo = {
                message_id: photos.length + 1,
                date: 1,
                chat: {
                  id: Number(form.get("chat_id")),
                  type: "private" as const,
                },
                caption: String(form.get("caption")),
                reply_markup: JSON.parse(String(form.get("reply_markup"))),
                photo: [
                  {
                    file_id: "private-image",
                    file_unique_id: "fixture",
                    width: 1,
                    height: 1,
                  },
                ],
              };
              photos.push(photo);
              return Response.json({ ok: true, result: photo });
            }
            const body = (await request.json()) as Record<string, unknown>;
            if (method === "answerCallbackQuery") {
              acks++;
              return Response.json({ ok: true, result: true });
            }
            if (method === "editMessageCaption") {
              const photo = photos.find(
                (p) => p.message_id === body.message_id,
              )!;
              photo.caption = String(body.caption);
              photo.reply_markup =
                body.reply_markup as typeof photo.reply_markup;
              return Response.json({ ok: true, result: photo });
            }
            assert.equal(method, "sendMessage");
            texts.push({ chat: String(body.chat_id), text: String(body.text) });
            return Response.json({
              ok: true,
              result: {
                message_id: texts.length + 100,
                chat: { id: Number(body.chat_id) },
              },
            });
          },
        }),
      );
      try {
        const db = await mf.getD1Database("DB");
        for (const file of readdirSync(
          new URL("../migrations/", import.meta.url),
        ).sort())
          for (const sql of readFileSync(
            new URL("../migrations/" + file, import.meta.url),
            "utf8",
          )
            .split(/;\r?\n/)
            .map((x) => x.trim())
            .filter(Boolean))
            await db.prepare(sql).run();
        await db
          .prepare(
            "INSERT INTO User(id,telegramId,firstName,preferredLocale,languageCode,updatedAt) VALUES('buyer','100','Buyer','uz','ru',1),('admin','101','Admin','ru','uz',1)",
          )
          .run();
        await db
          .prepare(
            "INSERT INTO TelegramAdmin(id,telegramId,createdBy,createdAt,updatedAt) VALUES('role','101','fixture',1,1)",
          )
          .run();
        await db
          .prepare(
            `INSERT INTO "Order"(id,publicId,userId,idempotencyKey,status,fullName,phone,city,address,total,subtotal,requiredPrepayment,paidAmount,remainingAmount,cargoAmount,updatedAt) VALUES('order','STZ-RUNTIME','buyer','fixture-order',?,'Buyer','+998900000000','Test','Test',290001,290001,145001,?,145000,?,1)`,
          )
          .bind(
            type === "FINAL" ? "AWAITING_FINAL_PAYMENT" : "AWAITING_PREPAYMENT",
            type === "FINAL" ? 145001 : 0,
            type === "FINAL" ? 90000 : null,
          )
          .run();
        const token = await new JwtTokenService(jwtSecret).issue("buyer");
        const upload = async () => {
          const form = new FormData();
          form.set(
            "file",
            new Blob([new Uint8Array(png)], { type: "image/png" }),
            "fixture.png",
          );
          const encoded = new Request("https://fixture.invalid", {
            method: "POST",
            body: form,
          });
          return mf.dispatchFetch(
            "https://preview.invalid/api/orders/STZ-RUNTIME/payments",
            {
              method: "POST",
              headers: {
                authorization: "Bearer " + token,
                "idempotency-key": "b32-runtime-payment-key",
                "content-type": encoded.headers.get("content-type")!,
              },
              body: await encoded.arrayBuffer(),
            },
          );
        };
        const submitted = await upload();
        assert.equal(submitted.status, 201, await submitted.clone().text());
        const p = ((await submitted.json()) as { payment: { id: string } })
          .payment;
        assert.equal(photos.length, 1);
        assert.match(photos[0]!.caption, /Получено подтверждение оплаты/);
        if (type === "FINAL") {
          assert.match(photos[0]!.caption, /145 000/);
          assert.match(photos[0]!.caption, /90 000/);
          assert.match(photos[0]!.caption, /235 000/);
        }
        const stored = await db
          .prepare("SELECT key,private FROM MediaObject")
          .first<{ key: string; private: number }>();
        assert.equal(stored?.private, 1);
        assert.equal(
          (
            await mf.dispatchFetch(
              "https://preview.invalid/media/" + stored!.key,
            )
          ).status,
          404,
        );
        const callback = async (action: "a" | "r" | "ca" | "cr") => {
          const response = await mf.dispatchFetch(
            "https://preview.invalid/telegram/webhook",
            {
              method: "POST",
              headers: {
                "content-type": "application/json",
                "x-telegram-bot-api-secret-token": secret,
              },
              body: JSON.stringify({
                update_id: ++seq,
                callback_query: {
                  id: String(seq),
                  from: {
                    id: 101,
                    is_bot: false,
                    first_name: "Admin",
                    language_code: "uz",
                  },
                  chat_instance: "fixture",
                  data: paymentReviewCallback(action, p.id),
                  message: photos[0],
                },
              }),
            },
          );
          assert.equal(response.status, 200, await response.clone().text());
        };
        const first = decision === "approve" ? "a" : "r",
          confirm = decision === "approve" ? "ca" : "cr";
        await callback(first);
        assert.equal(
          (
            await db
              .prepare("SELECT status FROM Payment")
              .first<{ status: string }>()
          )?.status,
          "SUBMITTED",
        );
        await db.prepare("UPDATE TelegramAdmin SET isActive=0").run();
        await callback(confirm);
        assert.equal(
          (
            await db
              .prepare("SELECT status FROM Payment")
              .first<{ status: string }>()
          )?.status,
          "SUBMITTED",
        );
        await db.prepare("UPDATE TelegramAdmin SET isActive=1").run();
        await callback(confirm);
        const payment = await db
          .prepare(
            "SELECT status,reviewedByUserId,rejectionReason FROM Payment",
          )
          .first();
        assert.equal(
          payment?.status,
          decision === "approve" ? "APPROVED" : "REJECTED",
        );
        assert.equal(payment?.reviewedByUserId, "admin");
        assert.equal(payment?.rejectionReason, null);
        const order = await db
          .prepare('SELECT status,paidAmount,cargoPaidAmount FROM "Order"')
          .first();
        assert.equal(
          order?.status,
          decision === "approve"
            ? type === "FINAL"
              ? "PAID_FULL"
              : "AWAITING_PURCHASE"
            : type === "FINAL"
              ? "AWAITING_FINAL_PAYMENT"
              : "AWAITING_PREPAYMENT",
        );
        assert.equal(texts.filter((t) => t.chat === "100").length, 1);
        assert.match(texts.find((t) => t.chat === "100")!.text, /buyurtmasi/);
        assert.equal(photos[0]!.reply_markup.inline_keyboard.length, 1);
        assert.equal(acks, 3);
        assert.equal(
          (
            await db
              .prepare("SELECT actorId FROM AuditLog WHERE action=?")
              .bind(
                decision === "approve"
                  ? "payment.approved"
                  : "payment.rejected",
              )
              .first()
          )?.actorId,
          "admin",
        );
        const replay = await upload();
        assert.equal(replay.status, 201);
        assert.equal(photos.length, 1);
        assert.equal(
          (
            await db
              .prepare("SELECT status FROM TelegramNotificationDelivery")
              .first()
          )?.status,
          "SENT",
        );
        assert.equal(
          (await db.prepare("SELECT count(*) n FROM Payment").first())?.n,
          1,
        );
      } finally {
        await mf.dispose();
      }
    });
