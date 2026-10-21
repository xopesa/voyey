import type { OrderRecord, OrderStatusValue } from "../orders/types.js";
import type { AdminPaymentRecord, PaymentRecord } from "../payments/types.js";
import { paymentReviewCaption, cancellationReasonText } from "@stenzo/shared";

type CustomerLanguage = "ru" | "uz";

export function customerLanguage(
  preferredLocale?: string | null,
): CustomerLanguage {
  return preferredLocale === "ru" ? "ru" : "uz";
}

export function formatUzs(amount: number): string {
  return `${String(amount).replace(/\B(?=(\d{3})+(?!\d))/g, " ")} UZS`;
}

function customerIdentity(order: OrderRecord): string {
  const name = [order.user.firstName, order.user.lastName]
    .filter(Boolean)
    .join(" ");
  const username = order.user.username ? ` (@${order.user.username})` : "";
  return `${name || `Telegram ${order.user.telegramId.toString()}`}${username}`;
}

export function adminNewOrderTemplate(
  order: OrderRecord,
  language: CustomerLanguage = "ru",
): string {
  if (language === "uz")
    return [
      `🛍 Yangi buyurtma ${order.publicId}`,
      `Mijoz: ${customerIdentity(order)}`,
      "Mahsulotlar:",
      ...order.items.map(
        (item) =>
          `• ${item.productNameUz} — razmer ${item.size} × ${item.quantity}`,
      ),
      `Summa: ${formatUzs(order.total)}`,
      `Oldindan to‘lov: ${formatUzs(order.requiredPrepayment)}`,
    ].join("\n");
  const items = order.items
    .map(
      (item) =>
        `• ${item.productNameRu} — размер ${item.size} × ${item.quantity}`,
    )
    .join("\n");
  return [
    `🛍 Новый заказ ${order.publicId}`,
    `Клиент: ${customerIdentity(order)}`,
    "Товары:",
    items,
    `Сумма: ${formatUzs(order.total)}`,
    `50% к оплате: ${formatUzs(order.requiredPrepayment)}`,
  ].join("\n");
}

export function adminPaymentSubmittedTemplate(
  order: OrderRecord,
  payment: PaymentRecord,
  isRetry: boolean,
  language: CustomerLanguage = "ru",
): string {
  return paymentReviewCaption(
    {
      publicId: order.publicId,
      customer: customerIdentity(order),
      type: payment.type,
      expectedAmount: payment.expectedAmount,
      remainingAmount: order.remainingAmount,
      cargoAmount: order.cargoAmount,
      isRetry,
    },
    language,
  );
}

export function customerPaymentReviewedTemplate(
  payment: AdminPaymentRecord,
  language: CustomerLanguage,
): string {
  const orderNumber = payment.order.publicId;
  if (payment.status === "REJECTED") {
    const reason = payment.rejectionReason
      ? language === "uz"
        ? `\nSabab: ${payment.rejectionReason}`
        : `\nПричина: ${payment.rejectionReason}`
      : "";
    return language === "uz"
      ? `❌ ${orderNumber} buyurtmasi uchun to'lov tasdig'i qabul qilinmadi.${reason}\nYangi tasdiq yuborishingiz mumkin.`
      : `❌ Подтверждение оплаты заказа ${orderNumber} не принято.${reason}\nМожно отправить новое подтверждение.`;
  }
  if (payment.type === "FINAL") {
    return language === "uz"
      ? `✅ ${orderNumber} buyurtmasi to'liq to'landi.`
      : `✅ Заказ ${orderNumber} полностью оплачен.`;
  }
  return language === "uz"
    ? `✅ ${orderNumber} buyurtmasi uchun oldindan to'lov tasdiqlandi. Buyurtma ishga qabul qilindi.`
    : `✅ Предоплата по заказу ${orderNumber} подтверждена. Заказ принят в работу.`;
}

const statusText: Partial<
  Record<OrderStatusValue, Record<CustomerLanguage, string>>
> = {
  PURCHASED: {
    ru: "Товар выкуплен.",
    uz: "Mahsulot xarid qilindi.",
  },
  IN_TRANSIT: {
    ru: "Заказ отправлен из Китая и находится в пути. Ориентировочный срок — 10–12 дней, без гарантии точной даты.",
    uz: "Buyurtma Xitoydan jo'natildi va yo'lda. Taxminiy muddat 10–12 kun, aniq sana kafolatlanmaydi.",
  },
  ARRIVED: {
    ru: "Заказ прибыл. Начинаем подготовку расчёта CARGO.",
    uz: "Buyurtma yetib keldi. CARGO hisob-kitobi tayyorlanmoqda.",
  },
  WEIGHING: {
    ru: "Заказ взвешивается для расчёта CARGO.",
    uz: "CARGO summasini hisoblash uchun buyurtma tortilmoqda.",
  },
  READY_TO_SHIP: {
    ru: "Заказ готов к отправке.",
    uz: "Buyurtma jo'natishga tayyor.",
  },
  SHIPPED: {
    ru: "Заказ отправлен клиенту.",
    uz: "Buyurtma mijozga jo'natildi.",
  },
  COMPLETED: {
    ru: "Заказ завершён. Спасибо, что выбрали STENZO Wear!",
    uz: "Buyurtma yakunlandi. STENZO Wear'ni tanlaganingiz uchun rahmat!",
  },
};

export function customerStatusTemplate(
  order: OrderRecord,
  status: OrderStatusValue,
  language: CustomerLanguage,
): string | null {
  if (status === "CANCELLED") {
    const reason =
      cancellationReasonText[order.cancellationReason ?? "OTHER"][language];
    const amount = order.refund?.status === "PENDING" ? order.refund.amount : 0;
    return language === "ru"
      ? `Заказ ${order.publicId} отменён.\nПричина: ${reason}${amount > 0 ? "\nК возврату: " + formatUzs(amount) : ""}`
      : `${order.publicId} buyurtmasi bekor qilindi.\nSabab: ${reason}${amount > 0 ? "\nQaytariladi: " + formatUzs(amount) : ""}`;
  }
  const text = statusText[status]?.[language];
  return text ? `📦 ${order.publicId}: ${text}` : null;
}

export function customerFinalPaymentTemplate(
  order: OrderRecord,
  language: CustomerLanguage,
): string {
  const cargo = order.cargoAmount ?? 0;
  const total = order.remainingAmount + cargo;
  return language === "uz"
    ? [
        `💳 ${order.publicId} buyurtmasi uchun yakuniy to'lov tayyor.`,
        `Mahsulot qoldig'i: ${formatUzs(order.remainingAmount)}`,
        `CARGO: ${formatUzs(cargo)}`,
        `Jami: ${formatUzs(total)}`,
        "Mini App orqali amaldagi to'lov rekvizitlarini oching.",
      ].join("\n")
    : [
        `💳 Для заказа ${order.publicId} рассчитан финальный платёж.`,
        `Остаток стоимости товара: ${formatUzs(order.remainingAmount)}`,
        `CARGO: ${formatUzs(cargo)}`,
        `Итого: ${formatUzs(total)}`,
        "Откройте актуальные реквизиты оплаты в Mini App.",
      ].join("\n");
}
