import { describe, it, expect } from "vitest";
import { randomBytes } from "node:crypto";
import {
  TelegramNotificationProvider,
  TelegramDeliveryError,
} from "../src/modules/notifications/telegram-provider.js";
import { png } from "./fixtures/images.js";
import { paymentReviewKeyboard } from "@stenzo/shared";

describe("private Telegram photo upload", () => {
  it("uploads exact bytes with multipart, safe filename, localized caption/keyboard and timeout", async () => {
    const keyboard = paymentReviewKeyboard(
      "fixture-payment",
      "https://admin.preview.invalid/admin/orders/TEST",
      "uz",
    );
    const provider = new TelegramNotificationProvider(
      randomBytes(32).toString("hex"),
      async function (this: unknown, _url, init) {
        expect(this).toBe(globalThis);
        expect(init?.signal).toBeTruthy();
        expect(init?.headers).toBeUndefined();
        const body = init?.body as FormData;
        expect(body).toBeInstanceOf(FormData);
        expect(body.get("chat_id")).toBe("101");
        const file = body.get("photo") as File;
        expect(file.name).toBe("proof.png");
        expect(file.type).toBe("image/png");
        expect(Buffer.from(await file.arrayBuffer())).toEqual(png);
        expect(String(body.get("caption"))).toHaveLength(1023);
        expect(JSON.parse(String(body.get("reply_markup")))).toEqual(keyboard);
        return Response.json({
          ok: true,
          result: { message_id: 21, chat: { id: 101 } },
        });
      },
    );
    expect(
      await provider.sendPhoto(
        "101",
        png,
        "image/png",
        "a".repeat(1023) + "😀",
        keyboard,
      ),
    ).toEqual({ messageId: 21 });
  });
  it.each([
    "rejected",
    "timeout",
    "wrong-chat",
    "missing-receipt",
    "server-error",
  ])(
    "photo %s preserves safe error classification without token/URL leaks",
    async (mode) => {
      const sensitive = randomBytes(32).toString("hex");
      const provider = new TelegramNotificationProvider(sensitive, async () => {
        if (mode === "timeout")
          throw new Error("https://api.telegram.org/bot" + sensitive);
        if (mode === "rejected")
          return Response.json(
            { ok: false, error_code: 403, description: sensitive },
            { status: 403 },
          );
        if (mode === "server-error")
          return Response.json(
            { ok: false, error_code: 500, description: sensitive },
            { status: 500 },
          );
        return Response.json({
          ok: true,
          result: {
            message_id: mode === "missing-receipt" ? null : 1,
            chat: { id: mode === "wrong-chat" ? 102 : 101 },
          },
        });
      });
      try {
        await provider.sendPhoto("101", png, "image/png", "Fixture", {
          inline_keyboard: [],
        });
        throw new Error("Expected failure");
      } catch (error) {
        expect(error).toBeInstanceOf(TelegramDeliveryError);
        expect((error as TelegramDeliveryError).code).toBe(
          mode === "rejected" ? "TELEGRAM_REJECTED" : "DELIVERY_UNCONFIRMED",
        );
        expect(String(error)).not.toContain(sensitive);
        expect(String(error)).not.toContain("https:");
      }
    },
  );
});
