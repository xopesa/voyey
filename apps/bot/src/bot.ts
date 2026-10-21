import {
  Bot,
  GrammyError,
  InlineKeyboard,
  type BotConfig,
  type Context,
} from "grammy";
import { texts, type BotLocale } from "./texts.js";
import type { BotUsers, BotUser } from "./users.js";
import {
  parsePaymentReviewCallback,
  paymentOrderUrl,
  paymentReviewCaption,
  paymentReviewKeyboard,
  type TelegramPaymentReviewService,
  type TelegramPaymentReviewView,
} from "@stenzo/shared";
type BotContext = Context & { state: { user: BotUser; locale: BotLocale } };

export interface StenzoBotConfig {
  token: string;
  miniAppUrl: string;
  users: BotUsers;
  telegramAdmins?: {
    getByTelegramId(id: string): Promise<{
      isActive: boolean;
      notifyNewOrders: boolean;
      notifyPayments: boolean;
    } | null>;
  };
  adminPanelUrl?: string;
  paymentReviews?: TelegramPaymentReviewService;
}

export function createStenzoBot(
  config: StenzoBotConfig,
  botConfig?: BotConfig<BotContext>,
): Bot<BotContext> {
  const bot = new Bot<BotContext>(config.token, botConfig);

  const menu = (locale: BotLocale) =>
    new InlineKeyboard()
      .webApp(texts[locale].openShop, config.miniAppUrl)
      .row()
      .text(texts[locale].language, "lang:menu");

  // Web Apps and personal preferences belong in private chats only. Never take
  // a target User ID from callback data or message text.
  bot.use(async (context, next) => {
    if (
      context.chat?.type !== "private" ||
      !context.from ||
      context.from.is_bot
    )
      return;
    if (!Number.isSafeInteger(context.from.id) || context.from.id <= 0) return;
    let locale: BotLocale = "uz";
    try {
      const from = context.from;
      const user = await config.users.createOrUpdateFromTelegram({
        telegramId: BigInt(from.id),
        username: from.username,
        firstName: from.first_name,
        lastName: from.last_name,
        languageCode: from.language_code,
      });
      if (user.status !== "ACTIVE") {
        if (context.callbackQuery) await context.answerCallbackQuery();
        return;
      }
      locale = user.preferredLocale;
      context.state = { user, locale };
      await next();
    } catch {
      // Never log Telegram requests, API URLs or errors containing credentials.
      if (context.callbackQuery)
        await context.answerCallbackQuery().catch(() => {});
      await context.reply(texts[locale].error).catch(() => {});
      throw new Error("Bot update could not be processed");
    }
  });

  bot.command("start", async (context) => {
    const locale = context.state.locale;
    await context.reply(texts[locale].welcome, { reply_markup: menu(locale) });
  });

  const adminRole = async (context: BotContext) => {
    try {
      const row = await config.telegramAdmins?.getByTelegramId(
        String(context.from!.id),
      );
      return row?.isActive ? row : null;
    } catch {
      return null;
    } // Role reads fail closed, without revealing internal details.
  };
  bot.callbackQuery(/^adm:pay:/, async (context) => {
    // Acknowledge before storage/network work; an empty ACK never claims success.
    await context.answerCallbackQuery().catch(() => {});
    if (!(await adminRole(context))) return;
    const parsed = parsePaymentReviewCallback(context.callbackQuery.data);
    const message = context.callbackQuery.message;
    if (
      !parsed ||
      !message ||
      !("reply_markup" in message) ||
      !message.reply_markup?.inline_keyboard.some((row) =>
        row.some(
          (button) =>
            "callback_data" in button &&
            button.callback_data === context.callbackQuery.data,
        ),
      )
    )
      return;
    const ru = context.state.locale === "ru";
    const failure = ru
      ? "Не удалось выполнить действие. Откройте заказ в Admin."
      : "Amalni bajarib bo‘lmadi. Buyurtmani Admin panelda oching.";
    const service = config.paymentReviews;
    if (!service || !config.adminPanelUrl) {
      await context.reply(failure);
      return;
    }
    const { paymentId, action } = parsed;
    const locale = context.state.locale;
    const orderUrl = (payment: TelegramPaymentReviewView) =>
      paymentOrderUrl(
        new URL(config.adminPanelUrl!).origin,
        payment.order.publicId,
      );
    const card = (payment: TelegramPaymentReviewView) => {
      const customer = payment.order.customer;
      const name =
        [customer.firstName, customer.lastName].filter(Boolean).join(" ") ||
        `Telegram ${customer.telegramId}`;
      return paymentReviewCaption(
        {
          publicId: payment.order.publicId,
          customer:
            name + (customer.username ? ` (@${customer.username})` : ""),
          type: payment.type,
          expectedAmount: payment.expectedAmount,
          remainingAmount: payment.order.remainingAmount,
          cargoAmount: payment.order.cargoAmount,
        },
        locale,
      );
    };
    const clipped = (value: string) => {
      let result = value.slice(0, 1024);
      if (/[\uD800-\uDBFF]$/.test(result)) result = result.slice(0, -1);
      return result;
    };
    const edit = async (
      caption: string,
      reply_markup: ReturnType<typeof paymentReviewKeyboard>,
    ) => {
      try {
        await context.editMessageCaption({
          caption: clipped(caption),
          reply_markup,
        });
      } catch (error) {
        if (!(
          error instanceof GrammyError &&
          error.error_code === 400 &&
          /message is not modified/i.test(error.description)
        ))
          throw error;
      }
    };
    const processed = async (
      payment: TelegramPaymentReviewView,
      already = false,
    ) => {
      const approved = payment.status === "APPROVED";
      const status = ru
        ? approved
          ? "✅ Оплата подтверждена"
          : "❌ Оплата отклонена"
        : approved
          ? "✅ To‘lov tasdiqlandi"
          : "❌ To‘lov rad etildi";
      const prefix = already
        ? ru
          ? "Платёж уже обработан: "
          : "To‘lov allaqachon ko‘rib chiqilgan: "
        : "";
      await edit(
        prefix + status + "\n\n" + card(payment),
        paymentReviewKeyboard(paymentId, orderUrl(payment), locale, "done"),
      );
    };
    try {
      let payment = await service.getForAdmin(paymentId);
      if (payment.status !== "SUBMITTED") {
        // A same-decision safe replay may recover the existing durable customer
        // notification, but can never change the original accounting/reviewer.
        if (
          (action === "ca" && payment.status === "APPROVED") ||
          (action === "cr" && payment.status === "REJECTED")
        ) {
          if (!(await adminRole(context))) return;
          payment =
            action === "ca"
              ? await service.approve(paymentId, context.state.user.id)
              : await service.reject(paymentId, context.state.user.id, null);
        }
        await processed(payment, true);
        return;
      }
      if (action === "ca" || action === "cr") {
        if (!(await adminRole(context))) return;
        payment =
          action === "ca"
            ? await service.approve(paymentId, context.state.user.id)
            : await service.reject(paymentId, context.state.user.id, null);
        await processed(payment);
        return;
      }
      if (action === "b") {
        await edit(
          card(payment),
          paymentReviewKeyboard(paymentId, orderUrl(payment), locale),
        );
        return;
      }
      const amount = `${String(payment.expectedAmount).replace(/\B(?=(\d{3})+(?!\d))/g, " ")} UZS`;
      const question =
        action === "a"
          ? ru
            ? `Подтвердить оплату ${payment.order.publicId} на сумму ${amount}?`
            : `${payment.order.publicId} buyurtmasi uchun ${amount} to‘lovni tasdiqlaysizmi?`
          : ru
            ? `Отклонить подтверждение оплаты заказа ${payment.order.publicId}?`
            : `${payment.order.publicId} buyurtmasi uchun to‘lov tasdig‘ini rad etasizmi?`;
      await edit(
        question,
        paymentReviewKeyboard(paymentId, orderUrl(payment), locale, action),
      );
    } catch {
      // An opposite concurrent review may have won. Read its committed result;
      // never retry an opposite financial decision or report success speculatively.
      try {
        const current = await service.getForAdmin(paymentId);
        if (current.status !== "SUBMITTED") {
          await processed(current, true);
          return;
        }
      } catch {
        /* sanitized reply below */
      }
      await context.reply(failure).catch(() => {});
    }
  });
  bot.command("admin", async (context) => {
    if (!(await adminRole(context)) || !config.adminPanelUrl) return;
    const ru = context.state.locale === "ru";
    await context.reply("STENZO Admin", {
      reply_markup: new InlineKeyboard()
        .url(ru ? "Админ-панель" : "Admin panel", config.adminPanelUrl)
        .row()
        .text(
          ru ? "Статус уведомлений" : "Bildirishnomalar holati",
          "admin:notifications",
        ),
    });
  });
  bot.callbackQuery(/^admin:/, async (context) => {
    const row = await adminRole(context);
    await context.answerCallbackQuery();
    if (!row || context.callbackQuery.data !== "admin:notifications") return;
    const ru = context.state.locale === "ru";
    const flag = (value: boolean) =>
      ru
        ? value
          ? "включены"
          : "выключены"
        : value
          ? "yoqilgan"
          : "o‘chirilgan";
    await context.reply(
      ru
        ? `STENZO Admin\nНовые заказы: ${flag(row.notifyNewOrders)}\nПлатежи: ${flag(row.notifyPayments)}`
        : `STENZO Admin\nYangi buyurtmalar: ${flag(row.notifyNewOrders)}\nTo‘lovlar: ${flag(row.notifyPayments)}`,
    );
  });

  const chooseLanguage = async (context: BotContext) => {
    if (context.callbackQuery) await context.answerCallbackQuery();
    await context.reply(texts[context.state.locale].chooseLanguage, {
      reply_markup: new InlineKeyboard()
        .text("🇺🇿 O‘zbekcha", "lang:uz")
        .text("🇷🇺 Русский", "lang:ru"),
    });
  };
  bot.command(["language", "til"], chooseLanguage);
  bot.callbackQuery("lang:menu", chooseLanguage);
  bot.callbackQuery(/^lang:(uz|ru)$/, async (context) => {
    await context.answerCallbackQuery();
    const locale = context.match[1] as BotLocale;
    await config.users.setPreferredLocale(context.state.user.id, locale);
    // A fresh menu avoids "message is not modified" on repeated choices.
    await context.reply(texts[locale].languageChanged, {
      reply_markup: menu(locale),
    });
  });
  bot.on("callback_query:data", async (context) => {
    await context.answerCallbackQuery();
  });
  bot.on("message:text", async (context) => {
    const locale = context.state.locale;
    await context.reply(texts[locale].unknown, { reply_markup: menu(locale) });
  });
  return bot;
}
