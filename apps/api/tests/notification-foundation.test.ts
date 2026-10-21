import { describe, it, expect } from "vitest";
import { randomBytes } from "node:crypto";
import { NotificationService } from "../src/modules/notifications/service.js";
import {
  TelegramNotificationProvider,
  TelegramDeliveryError,
} from "../src/modules/notifications/telegram-provider.js";
import type { OrderRecord } from "../src/modules/orders/types.js";

describe("preferredLocale customer notifications", () => {
  it.each([
    ["uz", "ru", "Mahsulot xarid qilindi"],
    ["ru", "uz", "Товар выкуплен"],
    [undefined, "ru", "Mahsulot xarid qilindi"],
    [null, "ru", "Mahsulot xarid qilindi"],
  ])(
    "locale %s overrides Telegram metadata %s",
    async (preferredLocale, languageCode, expected) => {
      const messages: string[] = [];
      const service = new NotificationService(
        {
          async sendText(_id, text) {
            messages.push(text);
          },
        },
        new Set(),
      );
      const order = {
        publicId: "TEST",
        user: { telegramId: 101n, preferredLocale, languageCode },
      } as OrderRecord;
      await service.orderStatusChanged({ order, status: "PURCHASED" });
      expect(messages[0]).toContain(expected);
    },
  );
});

describe("safe Telegram notification provider", () => {
  it("returns messageId, optional URL keyboard, bound fetch and bounded UTF-16 text", async () => {
    let sent: Record<string, unknown> = {};
    const provider = new TelegramNotificationProvider(
      "123456:" + randomBytes(32).toString("base64url"),
      async function (this: unknown, _url, init) {
        expect(this).toBe(globalThis);
        sent = JSON.parse(String(init?.body));
        expect(init?.signal).toBeTruthy();
        return Response.json({
          ok: true,
          result: { message_id: 123, chat: { id: 101 } },
        });
      },
    );
    expect(
      await provider.sendText("101", "a".repeat(4095) + "😀", {
        button: {
          text: "Open",
          url: "https://admin.preview.invalid/admin/orders/TEST",
        },
      }),
    ).toEqual({ messageId: 123 });
    expect(String(sent.text)).toHaveLength(4095);
    expect(sent.reply_markup).toEqual({
      inline_keyboard: [
        [
          {
            text: "Open",
            url: "https://admin.preview.invalid/admin/orders/TEST",
          },
        ],
      ],
    });
  });
  it.each(["reject", "network", "wrong-chat", "bad-receipt", "server"])(
    "sanitizes %s errors and distinguishes uncertain outcomes",
    async (mode) => {
      const sensitive = randomBytes(32).toString("hex");
      const provider = new TelegramNotificationProvider(sensitive, async () => {
        if (mode === "network")
          throw new Error("https://provider.invalid/" + sensitive);
        if (mode === "reject")
          return Response.json(
            { ok: false, error_code: 403, description: sensitive },
            { status: 403 },
          );
        if (mode === "server")
          return Response.json(
            { ok: false, error_code: 500, description: sensitive },
            { status: 500 },
          );
        return Response.json({
          ok: true,
          result: {
            message_id: mode === "bad-receipt" ? null : 1,
            chat: { id: mode === "wrong-chat" ? 999 : 101 },
          },
        });
      });
      try {
        await provider.sendText("101", "test");
        throw new Error("expected rejection");
      } catch (e) {
        expect(e).toBeInstanceOf(TelegramDeliveryError);
        expect(String(e)).not.toContain(sensitive);
        expect((e as TelegramDeliveryError).code).toBe(
          mode === "reject" ? "TELEGRAM_REJECTED" : "DELIVERY_UNCONFIRMED",
        );
      }
    },
  );
});
