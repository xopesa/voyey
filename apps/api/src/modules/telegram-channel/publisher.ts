import { effectiveProductPrice } from "@stenzo/shared";
import {
  productStartParam,
  type ChannelErrorCode,
  type ChannelPublication,
} from "@stenzo/shared";
import type { AdminProductRecord } from "../admin/catalog/types.js";
import type { PublicationStore, PostRecord } from "./store.js";

export interface ChannelConfig {
  token?: string;
  channel?: string;
  salesUsername?: string;
  origin?: string;
}
export class ChannelFailure extends Error {
  constructor(
    public readonly code: ChannelErrorCode,
    public readonly uncertain = false,
  ) {
    super(code);
  }
}
const fail = (code: ChannelErrorCode): never => {
  throw new ChannelFailure(code);
};
const usernamePattern = /^[A-Za-z][A-Za-z0-9_]{4,31}$/;
function configuration(config: ChannelConfig) {
  if (
    !config.channel ||
    !/^(?:-?[0-9]{1,20}|@[A-Za-z][A-Za-z0-9_]{4,31})$/.test(config.channel)
  )
    fail("CHANNEL_NOT_CONFIGURED");
  if (!config.salesUsername || !usernamePattern.test(config.salesUsername))
    fail("SALES_USERNAME_NOT_CONFIGURED");
  if (!config.token || !/^[0-9]+:[A-Za-z0-9_-]+$/.test(config.token))
    fail("BOT_NOT_CONFIGURED");
  try {
    const u = new URL(config.origin!);
    if (u.protocol !== "https:" || u.origin !== config.origin)
      fail("PREVIEW_BOT_MISMATCH");
  } catch {
    fail("PREVIEW_BOT_MISMATCH");
  }
}
function clean(text: string) {
  return text
    .replace(/\p{Cc}/gu, (c) =>
      c === "\n" || c === "\r" || c === "\t" ? c : "",
    )
    .trim();
}
function latin(text: string) {
  return !Array.from(text).some(
    (c) => /\p{L}/u.test(c) && !/\p{Script=Latin}/u.test(c),
  );
}
export function clip(text: string, max: number) {
  if (text.length <= max) return text;
  let result = "";
  for (const { segment } of new Intl.Segmenter("uz", {
    granularity: "grapheme",
  }).segment(text)) {
    if (result.length + segment.length > max - 1) break;
    result += segment;
  }
  return result.trimEnd() + "…";
}
export function productPhotoPost(
  product: AdminProductRecord,
  origin: string,
  botUsername: string,
  salesUsername: string,
) {
  if (
    product.archivedAt ||
    product.category.archivedAt ||
    product.status !== "ACTIVE"
  )
    fail("PRODUCT_INACTIVE");
  if (
    !clean(product.nameUz) ||
    !latin(product.nameUz) ||
    (product.descriptionUz && !latin(product.descriptionUz))
  )
    fail("UZ_CONTENT_REQUIRED");
  if (
    !Number.isSafeInteger(product.price) ||
    product.price <= 0 ||
    product.currency !== "UZS"
  )
    fail("PRICE_INVALID");
  const start = productStartParam(product.slug);
  if (!start) fail("INVALID_SLUG");
  const images = [...product.images].sort(
    (a, b) =>
      Number(b.isPrimary) - Number(a.isPrimary) ||
      a.sortOrder - b.sortOrder ||
      a.id.localeCompare(b.id),
  );
  if (!images.length) fail("PHOTO_MISSING");
  const photo = images[0]!.url;
  try {
    const url = new URL(photo);
    if (
      url.origin !== origin ||
      !/^\/media\/products\/[a-f0-9-]+\.(?:png|jpe?g|webp)$/.test(
        url.pathname,
      ) ||
      url.search ||
      url.hash ||
      url.username ||
      url.password
    )
      fail("PHOTO_NOT_PUBLIC");
  } catch {
    fail("PHOTO_NOT_PUBLIC");
  }
  const variants = product.variants.filter((v) => v.isActive);
  if (!variants.length) fail("VARIANTS_MISSING");
  if (
    variants.some(
      (v) => !clean(v.size) || !latin(v.size) || (v.color && !latin(v.color)),
    )
  )
    fail("UZ_CONTENT_REQUIRED");
  const orderedSizes = [
    "XXS",
    "XS",
    "S",
    "M",
    "L",
    "XL",
    "XXL",
    "2XL",
    "3XL",
    "4XL",
    "5XL",
  ];
  const sizes = [
    ...new Set(variants.map((v) => clean(v.size).toUpperCase())),
  ].sort((a, b) => {
    const ai = orderedSizes.indexOf(a),
      bi = orderedSizes.indexOf(b);
    return (
      (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi) ||
      a.localeCompare(b, "en", { numeric: true })
    );
  });
  const colors = [
    ...new Map(
      variants
        .filter((v) => v.color?.trim())
        .map(
          (v) =>
            [clean(v.color!).toLocaleLowerCase("uz"), clean(v.color!)] as const,
        ),
    ).values(),
  ].sort((a, b) => a.localeCompare(b, "uz"));
  const price = String(effectiveProductPrice(product).effectivePrice).replace(
    /\B(?=(\d{3})+(?!\d))/g,
    " ",
  );
  const header = `🆕 ${clip(clean(product.nameUz), 140)}\n\n💰 Narxi: ${price} so‘m + kargo\n\n📏 Razmerlar: ${clip(sizes.join(" / "), 170)}${colors.length ? `\n🎨 Ranglar: ${clip(colors.join(", "), 170)}` : ""}`;
  const description = clean(product.descriptionUz ?? "");
  // Delivery and payment claims come from the product's authored UZ description.
  const budget = 1024 - header.length - 2;
  const caption =
    header +
    (description && budget > 1 ? `\n\n${clip(description, budget)}` : "");
  return {
    photo,
    caption,
    reply_markup: {
      inline_keyboard: [
        [
          {
            text: "Sotib olish",
            url: `https://t.me/${botUsername}?startapp=${start}`,
          },
          {
            text: "Administratorga yozish",
            url: `https://t.me/${salesUsername}`,
          },
        ],
      ],
    },
  };
}
function view(row: PostRecord, alreadyPublished = false): ChannelPublication {
  return {
    status: row.status,
    retryAllowed: row.status === "FAILED",
    alreadyPublished,
    ...(row.messageId ? { messageId: row.messageId } : {}),
    ...(row.publishedAt ? { publishedAt: row.publishedAt.toISOString() } : {}),
    ...(row.lastErrorCode
      ? { errorCode: row.lastErrorCode as ChannelErrorCode }
      : row.status === "PENDING" &&
          Date.now() - row.lastAttemptAt.getTime() > 60000
        ? { errorCode: "DELIVERY_UNCONFIRMED" as const }
        : {}),
  };
}
function rejected(error: unknown): ChannelPublication {
  const code =
    error instanceof ChannelFailure ? error.code : "PERSISTENCE_UNAVAILABLE";
  return {
    status: code.endsWith("NOT_CONFIGURED") ? "NOT_CONFIGURED" : "FAILED",
    errorCode: code,
    retryAllowed: error instanceof ChannelFailure && !error.uncertain,
  };
}
export class TelegramChannelPublisher {
  constructor(
    private readonly store: PublicationStore,
    private readonly products: {
      getProduct(id: string): Promise<AdminProductRecord | null>;
    },
    private readonly config: ChannelConfig,
    private readonly fetcher: typeof fetch = fetch.bind(globalThis),
  ) {}
  private async call<T>(
    method: string,
    body: object = {},
    sending = false,
  ): Promise<T> {
    let response: Response;
    try {
      response = await this.fetcher(
        `https://api.telegram.org/bot${this.config.token}/${method}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(sending ? 10000 : 4000),
        },
      );
    } catch {
      throw new ChannelFailure(
        sending ? "DELIVERY_UNCONFIRMED" : "TELEGRAM_UNAVAILABLE",
        sending,
      );
    }
    let data: {
      ok: boolean;
      result: T;
      error_code?: number;
      description?: string;
    };
    try {
      data = (await response.json()) as typeof data;
    } catch {
      throw new ChannelFailure(
        sending ? "DELIVERY_UNCONFIRMED" : "TELEGRAM_UNAVAILABLE",
        sending,
      );
    }
    if (
      response.status >= 500 ||
      (response.ok && data.ok !== true && data.ok !== false)
    )
      throw new ChannelFailure(
        sending ? "DELIVERY_UNCONFIRMED" : "TELEGRAM_UNAVAILABLE",
        sending,
      );
    if (!response.ok || !data.ok) {
      const status = data.error_code ?? response.status;
      throw new ChannelFailure(
        status === 403
          ? "BOT_NOT_ALLOWED"
          : status === 429
            ? "TELEGRAM_UNAVAILABLE"
            : method === "sendPhoto" && status === 400
              ? "PHOTO_UNAVAILABLE"
              : "TELEGRAM_REJECTED",
      );
    }
    return data.result;
  }
  private async target() {
    configuration(this.config);
    const me = await this.call<{
      id: number;
      username: string;
      is_bot: boolean;
      has_main_web_app?: boolean;
    }>("getMe");
    if (
      !me.is_bot ||
      String(me.id) !== this.config.token!.split(":")[0] ||
      !usernamePattern.test(me.username ?? "")
    )
      fail("PREVIEW_BOT_MISMATCH");
    if (!me.has_main_web_app) fail("MAIN_MINIAPP_NOT_CONFIGURED");
    const menu = await this.call<{ type: string; web_app?: { url: string } }>(
      "getChatMenuButton",
    );
    if (menu.type === "web_app") {
      try {
        if (new URL(menu.web_app!.url).origin !== this.config.origin)
          fail("PREVIEW_BOT_MISMATCH");
      } catch {
        fail("PREVIEW_BOT_MISMATCH");
      }
    }
    const channel = await this.call<{ id: number; type: string }>("getChat", {
      chat_id: this.config.channel,
    });
    if (channel.type !== "channel" || !Number.isSafeInteger(channel.id))
      fail("CHANNEL_NOT_ALLOWED");
    const member = await this.call<{
      status: string;
      can_post_messages?: boolean;
    }>("getChatMember", { chat_id: channel.id, user_id: me.id });
    if (
      member.status !== "creator" &&
      !(member.status === "administrator" && member.can_post_messages === true)
    )
      fail("BOT_NOT_ALLOWED");
    return { id: String(channel.id), username: me.username };
  }
  async getPublication(id: string): Promise<ChannelPublication> {
    try {
      const target = await this.target();
      const row = await this.store.get(id, target.id);
      return row ? view(row) : { status: "NOT_PUBLISHED", retryAllowed: true };
    } catch (error) {
      return rejected(error);
    }
  }
  async publishProduct(actor: string, id: string): Promise<ChannelPublication> {
    let claimed: PostRecord | undefined;
    let slug = "";
    let deliveryStarted = false;
    try {
      const product = await this.products.getProduct(id);
      if (!product) fail("PRODUCT_INACTIVE");
      if (product!.archivedAt || product!.category.archivedAt)
        fail("PRODUCT_INACTIVE");
      slug = product!.slug;
      configuration(this.config);
      const target = await this.target();
      const receipt = await this.store.get(id, target.id);
      // A durable receipt wins even if product metadata changed after publication.
      if (receipt && receipt.status !== "FAILED")
        return view(receipt, receipt.status === "PUBLISHED");
      // Validate content before acquiring a send claim or sending any photo.
      productPhotoPost(
        product!,
        this.config.origin!,
        "validation_bot",
        this.config.salesUsername!,
      );
      const claim = await this.store.claim(actor, id, slug, target.id);
      if (!claim.owned)
        return view(claim.row, claim.row.status === "PUBLISHED");
      claimed = claim.row;
      const currentProduct = await this.products.getProduct(id);
      if (!currentProduct) fail("PRODUCT_INACTIVE");
      const payload = productPhotoPost(
        currentProduct!,
        this.config.origin!,
        target.username,
        this.config.salesUsername!,
      );
      deliveryStarted = true;
      const sent = await this.call<{
        message_id: number;
        chat: { id: number };
      }>("sendPhoto", { chat_id: target.id, ...payload }, true);
      if (
        !Number.isSafeInteger(sent?.message_id) ||
        sent.message_id <= 0 ||
        String(sent.chat?.id) !== target.id
      )
        throw new ChannelFailure("DELIVERY_UNCONFIRMED", true);
      await this.store.finish(actor, claimed, slug, {
        messageId: sent.message_id,
      });
      const row = await this.store.get(id, target.id);
      if (!row) throw new Error("Publication persistence unavailable");
      return view(row);
    } catch (error) {
      const uncertain =
        deliveryStarted &&
        (!(error instanceof ChannelFailure) || error.uncertain);
      const code: ChannelErrorCode = uncertain
        ? "DELIVERY_UNCONFIRMED"
        : error instanceof ChannelFailure
          ? error.code
          : "PERSISTENCE_UNAVAILABLE";
      if (claimed) {
        try {
          await this.store.finish(actor, claimed, slug, { code, uncertain });
        } catch {
          return {
            status: "PENDING",
            errorCode: "DELIVERY_UNCONFIRMED",
            retryAllowed: false,
          };
        }
        return {
          status: uncertain ? "PENDING" : "FAILED",
          errorCode: code,
          retryAllowed: !uncertain,
        };
      }
      try {
        await this.store.recordFailure(
          actor,
          id,
          slug,
          this.config.channel ?? "unconfigured",
          code,
        );
      } catch {
        /* Preserve activation and never expose a database exception. */
      }
      return rejected(error);
    }
  }
}
