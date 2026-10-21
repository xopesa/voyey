import type { NotificationProvider, NotificationOptions } from "./types.js";
import type { PaymentReviewKeyboard } from "@stenzo/shared";

export class TelegramDeliveryError extends Error {
  constructor(
    public readonly code: "TELEGRAM_REJECTED" | "DELIVERY_UNCONFIRMED",
  ) {
    super(code);
  }
}

type FetchImplementation = typeof fetch;

export class TelegramNotificationProvider implements NotificationProvider {
  public constructor(
    private readonly botToken: string,
    private readonly fetchImplementation: FetchImplementation = fetch,
    private readonly timeoutMs = 5_000,
  ) {}

  public async sendText(
    chatId: string,
    text: string,
    options?: NotificationOptions,
  ): Promise<{ messageId: number }> {
    let clipped = text.slice(0, 4096);
    if (/[\uD800-\uDBFF]$/.test(clipped)) clipped = clipped.slice(0, -1);
    return this.deliver(
      "sendMessage",
      JSON.stringify({
        chat_id: chatId,
        text: clipped,
        ...(options?.button
          ? { reply_markup: { inline_keyboard: [[options.button]] } }
          : {}),
      }),
      chatId,
      { "content-type": "application/json" },
    );
  }

  public async sendPhoto(
    chatId: string,
    bytes: Buffer,
    mimeType: string,
    caption: string,
    keyboard: PaymentReviewKeyboard,
  ): Promise<{ messageId: number }> {
    const extensions: Record<string, string> = {
      "image/png": "png",
      "image/jpeg": "jpg",
      "image/webp": "webp",
    };
    if (!bytes.length || !extensions[mimeType])
      throw new TelegramDeliveryError("TELEGRAM_REJECTED");
    let clipped = caption.slice(0, 1024);
    if (/[\uD800-\uDBFF]$/.test(clipped)) clipped = clipped.slice(0, -1);
    const form = new FormData();
    form.set("chat_id", chatId);
    form.set(
      "photo",
      new Blob([new Uint8Array(bytes)], { type: mimeType }),
      `proof.${extensions[mimeType]}`,
    );
    form.set("caption", clipped);
    form.set("reply_markup", JSON.stringify(keyboard));
    return this.deliver("sendPhoto", form, chatId);
  }

  private async deliver(
    method: "sendMessage" | "sendPhoto",
    payload: string | FormData,
    chatId: string,
    headers?: Record<string, string>,
  ): Promise<{ messageId: number }> {
    try {
      const response = await this.fetchImplementation.call(
        globalThis,
        `https://api.telegram.org/bot${this.botToken}/${method}`,
        {
          method: "POST",
          headers,
          body: payload,
          signal: AbortSignal.timeout(this.timeoutMs),
        },
      );
      const body = (await response.json()) as {
        ok?: boolean;
        error_code?: number;
        result?: { message_id?: number; chat?: { id?: number } };
      };
      if (
        body.ok === false &&
        [400, 401, 403, 404, 409, 429].includes(body.error_code ?? 0) &&
        response.status < 500
      )
        throw new TelegramDeliveryError("TELEGRAM_REJECTED");
      const id = body.result?.message_id;
      if (
        !response.ok ||
        body.ok !== true ||
        !Number.isSafeInteger(id) ||
        id! <= 0 ||
        String(body.result?.chat?.id) !== chatId
      )
        throw new TelegramDeliveryError("DELIVERY_UNCONFIRMED");
      return { messageId: id! };
    } catch (error) {
      // Never propagate fetch errors/URLs/provider text containing credentials.
      throw error instanceof TelegramDeliveryError
        ? error
        : new TelegramDeliveryError("DELIVERY_UNCONFIRMED");
    }
  }
}
