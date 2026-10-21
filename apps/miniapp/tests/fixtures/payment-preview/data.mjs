// Isolated UI/test data. Never imported by production components or the API.
export function paymentFixture(scenario = "waiting") {
  const final = scenario.startsWith("final");
  const pending = scenario.endsWith("pending"),
    rejected = scenario.endsWith("rejected"),
    approved = scenario.endsWith("approved");
  const phase = final ? "FINAL" : "PREPAYMENT";
  const payment =
    pending || rejected || approved
      ? {
          id: "fixture-attempt",
          orderPublicId: "STZ-FIXTURE-001",
          type: phase,
          status: pending ? "SUBMITTED" : rejected ? "REJECTED" : "APPROVED",
          expectedAmount: final ? 490000 : 425000,
          rejectionReason: rejected
            ? "TEST FIXTURE: сумма перевода не совпадает / o‘tkazma summasi mos emas"
            : null,
          submittedAt: "2026-10-01T09:00:00Z",
          reviewedAt: pending ? null : "2026-10-01T10:00:00Z",
        }
      : null;
  const order = {
    publicId: "STZ-FIXTURE-001",
    currency: "UZS",
    createdAt: "2026-10-01T08:30:00Z",
    status:
      scenario === "cancelled"
        ? "CANCELLED"
        : approved
          ? final
            ? "PAID_FULL"
            : "AWAITING_PURCHASE"
          : pending
            ? final
              ? "FINAL_PAYMENT_SUBMITTED"
              : "PREPAYMENT_SUBMITTED"
            : final
              ? "AWAITING_FINAL_PAYMENT"
              : "AWAITING_PREPAYMENT",
    total: 850000,
    requiredPrepayment: 425000,
    remainingAmount: final && approved ? 0 : 425000,
    paidAmount: approved && final ? 850000 : final || approved ? 425000 : 0,
    cargoAmount: final ? 65000 : null,
    cargoPaidAmount: final && approved ? 65000 : 0,
    items: [
      {
        productNameRu: "Тестовое худи",
        productNameUz: "Test hudi",
        imageUrl: "/fixture-photo.svg",
        quantity: 1,
        size: "L",
        color: "Black",
        unitPrice: 850000,
        lineTotal: 850000,
        heightCm: 180,
        weightKg: 75,
      },
    ],
    payment: {
      phase: approved || scenario === "cancelled" ? null : phase,
      amountDue:
        approved || scenario === "cancelled" ? 0 : final ? 490000 : 425000,
      latestStatus: payment?.status ?? null,
    },
  };
  const instructions = {
    orderPublicId: order.publicId,
    phase: order.payment.phase,
    amount: order.payment.amountDue,
    currency: "UZS",
    canSubmit: !pending && !approved && scenario !== "cancelled",
    latestPaymentStatus: payment?.status ?? null,
    latestPayment: payment,
    maxProofUploadSize: 5 * 1024 * 1024,
    cardNumber: "0000 0000 0000 0000",
    cardHolder: "TEST FIXTURE ONLY",
    instructionsRu:
      "Тестовые реквизиты. Не совершайте перевод. Приложите тестовое изображение для проверки интерфейса.",
    instructionsUz:
      "Test rekvizitlari. Pul o‘tkazmang. Interfeysni tekshirish uchun test rasmini yuklang.",
  };
  return { order, instructions };
}
