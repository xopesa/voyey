import { describe, expect, it } from "vitest";
import {
  nextAdminStatus,
  assertAdminStatusTransition,
} from "../src/modules/orders/status-policy.js";
import { toAdminOrderDto, toOrderDto } from "../src/modules/orders/service.js";
import type {
  OrderRecord,
  OrderStatusValue,
} from "../src/modules/orders/types.js";
const date = new Date("2026-09-30T00:00:00Z");
function record(): OrderRecord {
  return {
    id: "order",
    publicId: "STZ-TEST",
    userId: "user",
    idempotencyKey: "test",
    status: "AWAITING_FINAL_PAYMENT",
    currency: "UZS",
    subtotal: 101,
    total: 101,
    requiredPrepayment: 51,
    paidAmount: 51,
    remainingAmount: 50,
    cargoAmount: 5,
    cargoPaidAmount: 0,
    fullName: "Test",
    phone: "1234567",
    city: "Test",
    address: "Test",
    apartment: null,
    comment: null,
    createdAt: date,
    updatedAt: date,
    user: {
      id: "user",
      telegramId: 101n,
      username: "test",
      firstName: "Test",
      lastName: null,
      languageCode: "ru",
    },
    items: [
      {
        id: "item",
        orderId: "order",
        productId: "product",
        variantId: null,
        productNameRu: "Снимок",
        productNameUz: "Nusxa",
        productSlug: "snapshot",
        imageUrl: null,
        sku: "SNAP",
        size: "XL",
        color: null,
        unitPrice: 101,
        quantity: 1,
        lineTotal: 101,
        heightCm: 182,
        weightKg: 79,
        createdAt: date,
        product: { sourceUrl: "https://example.com/private" },
      },
    ],
    payments: [
      {
        id: "prepayment",
        type: "PREPAYMENT",
        status: "APPROVED",
        expectedAmount: 51,
        submittedAt: date,
        reviewedAt: date,
        rejectionReason: null,
      },
    ],
  };
}
describe("admin order presentation contract", () => {
  it("keeps procurement/private proof metadata out of customer DTOs and returns snapshot measurements", () => {
    const order = record();
    Object.assign(order.payments[0]!, {
      proofStorageKey: "private/key.png",
      proofMimeType: "image/png",
    });
    const admin = toAdminOrderDto(order);
    const customer = toOrderDto(order);
    expect(admin.items[0]).toMatchObject({
      sourceUrl: "https://example.com/private",
      heightCm: 182,
      weightKg: 79,
      unitPrice: 101,
    });
    expect(customer.items[0]).not.toHaveProperty("sourceUrl");
    expect(customer.items[0]).not.toHaveProperty("product");
    expect(customer).not.toHaveProperty("customer");
    expect(customer).not.toHaveProperty("finance");
    expect(admin.paymentAttempts[0]).not.toHaveProperty("proofStorageKey");
  });
  it("preserves final-payment total after settlement and clears current amount due", () => {
    const order = record();
    expect(toAdminOrderDto(order).payment.latestStatus).toBeNull();
    expect(toOrderDto(order).payment.latestStatus).toBe("APPROVED");
    expect(toAdminOrderDto(order).finance).toEqual({
      confirmedPrepayment: 51,
      remainingProducts: 50,
      finalPaymentTotal: 55,
    });
    order.status = "PAID_FULL";
    order.paidAmount = 101;
    order.remainingAmount = 0;
    order.cargoPaidAmount = 5;
    order.payments.unshift({
      ...order.payments[0]!,
      id: "final",
      type: "FINAL",
      expectedAmount: 55,
    });
    const settled = toAdminOrderDto(order);
    expect(settled.finance).toEqual({
      confirmedPrepayment: 51,
      remainingProducts: 0,
      finalPaymentTotal: 55,
    });
    expect(settled.payment.amountDue).toBe(0);
    expect(settled.nextStatus).toBe("READY_TO_SHIP");
  });
  it("exposes exactly the existing permitted transition and no action for customer/payment states", () => {
    const pairs: [OrderStatusValue, OrderStatusValue][] = [
      ["AWAITING_PURCHASE", "PURCHASED"],
      ["PURCHASED", "IN_TRANSIT"],
      ["IN_TRANSIT", "ARRIVED"],
      ["ARRIVED", "WEIGHING"],
      ["PAID_FULL", "READY_TO_SHIP"],
      ["READY_TO_SHIP", "SHIPPED"],
      ["SHIPPED", "COMPLETED"],
    ];
    for (const [from, to] of pairs) {
      expect(nextAdminStatus(from)).toBe(to);
      expect(() => assertAdminStatusTransition(from, to)).not.toThrow();
      expect(() => assertAdminStatusTransition(from, "CANCELLED")).toThrow();
    }
    for (const status of [
      "AWAITING_PREPAYMENT",
      "PREPAYMENT_SUBMITTED",
      "WEIGHING",
      "AWAITING_FINAL_PAYMENT",
      "FINAL_PAYMENT_SUBMITTED",
      "COMPLETED",
      "CANCELLED",
    ] as const)
      expect(nextAdminStatus(status)).toBeNull();
    const order = record();
    order.status = "WEIGHING";
    expect(toAdminOrderDto(order)).toMatchObject({
      canRequestFinalPayment: true,
      requiresAction: true,
      nextStatus: null,
    });
  });
});
