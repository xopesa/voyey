export type PaymentReviewAction = "a" | "r" | "ca" | "cr" | "b";
export type PaymentReviewLocale = "uz" | "ru";
export type PaymentReviewButton =
  { text: string; callback_data: string } | { text: string; url: string };
export type PaymentReviewKeyboard = {
  inline_keyboard: PaymentReviewButton[][];
};

// D1 UUIDs and Prisma CUIDs fit; the longest encoded callback is 59 ASCII bytes.
const paymentIdPattern = /^[A-Za-z0-9][A-Za-z0-9_-]{0,47}$/;
export function paymentReviewCallback(action: PaymentReviewAction, id: string) {
  if (id.match(paymentIdPattern)?.[0] !== id)
    throw new Error("Invalid payment callback ID");
  return `adm:pay:${action}:${id}`;
}
export function parsePaymentReviewCallback(value: string) {
  const match = /^adm:pay:(a|r|ca|cr|b):([A-Za-z0-9][A-Za-z0-9_-]{0,47})$/.exec(
    value,
  );
  return match && match[0] === value
    ? { action: match[1] as PaymentReviewAction, paymentId: match[2]! }
    : null;
}
export function paymentOrderUrl(origin: string, publicId: string) {
  const url = new URL(origin);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  )
    throw new Error("Invalid Admin origin");
  return `${url.origin}/admin/orders/${encodeURIComponent(publicId)}`;
}
export function paymentReviewKeyboard(
  id: string,
  orderUrl: string,
  locale: PaymentReviewLocale,
  confirmation?: "a" | "r" | "done",
): PaymentReviewKeyboard {
  const ru = locale === "ru";
  const open: PaymentReviewButton = {
    text: ru ? "📦 Открыть заказ" : "📦 Buyurtmani ochish",
    url: orderUrl,
  };
  if (confirmation === "done") return { inline_keyboard: [[open]] };
  if (confirmation)
    return {
      inline_keyboard: [
        [
          {
            text:
              confirmation === "a"
                ? ru
                  ? "✅ Да, подтвердить"
                  : "✅ Ha, tasdiqlash"
                : ru
                  ? "❌ Да, отклонить"
                  : "❌ Ha, rad etish",
            callback_data: paymentReviewCallback(
              confirmation === "a" ? "ca" : "cr",
              id,
            ),
          },
        ],
        [
          {
            text: ru ? "↩️ Назад" : "↩️ Orqaga",
            callback_data: paymentReviewCallback("b", id),
          },
        ],
        [open],
      ],
    };
  return {
    inline_keyboard: [
      [
        {
          text: ru ? "✅ Подтвердить" : "✅ Tasdiqlash",
          callback_data: paymentReviewCallback("a", id),
        },
        {
          text: ru ? "❌ Отклонить" : "❌ Rad etish",
          callback_data: paymentReviewCallback("r", id),
        },
      ],
      [open],
    ],
  };
}

export interface TelegramPaymentReviewView {
  id: string;
  status: "SUBMITTED" | "APPROVED" | "REJECTED";
  type: "PREPAYMENT" | "FINAL";
  expectedAmount: number;
  order: {
    publicId: string;
    remainingAmount: number;
    cargoAmount: number | null;
    customer: {
      telegramId: string;
      firstName: string | null;
      lastName: string | null;
      username: string | null;
    };
  };
}
export interface TelegramPaymentReviewService {
  getForAdmin(id: string): Promise<TelegramPaymentReviewView>;
  approve(id: string, actorUserId: string): Promise<TelegramPaymentReviewView>;
  reject(
    id: string,
    actorUserId: string,
    reason: null,
  ): Promise<TelegramPaymentReviewView>;
}
export function paymentReviewCaption(
  input: {
    publicId: string;
    customer: string;
    type: "PREPAYMENT" | "FINAL";
    expectedAmount: number;
    remainingAmount: number;
    cargoAmount: number | null;
    isRetry?: boolean;
  },
  locale: PaymentReviewLocale,
) {
  const money = (amount: number) =>
    `${String(amount).replace(/\B(?=(\d{3})+(?!\d))/g, " ")} UZS`;
  const ru = locale === "ru";
  return [
    ru
      ? `💳 ${input.isRetry ? "Новая попытка оплаты" : "Получено подтверждение оплаты"}`
      : `💳 ${input.isRetry ? "Yangi to‘lov urinishi" : "To‘lov tasdig‘i olindi"}`,
    `${ru ? "Заказ" : "Buyurtma"}: ${input.publicId}`,
    `${ru ? "Клиент" : "Mijoz"}: ${input.customer}`,
    `${ru ? "Тип" : "Turi"}: ${input.type === "FINAL" ? (ru ? "Финальная оплата" : "Yakuniy to‘lov") : ru ? "Предоплата" : "Oldindan to‘lov"}`,
    ...(input.type === "FINAL"
      ? [
          `${ru ? "Остаток товара" : "Mahsulot qoldig‘i"}: ${money(input.remainingAmount)}`,
          `CARGO: ${money(input.cargoAmount ?? 0)}`,
          `${ru ? "Итого" : "Jami"}: ${money(input.expectedAmount)}`,
        ]
      : []),
    `${ru ? "Ожидаемая сумма" : "Kutilayotgan summa"}: ${money(input.expectedAmount)}`,
  ].join("\n");
}
