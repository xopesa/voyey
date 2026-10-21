// Read-only, isolated test snapshots. No production endpoint imports or database writes.
import { paymentFixture } from "../payment-preview/data.mjs";
export const statuses = [
  "AWAITING_PREPAYMENT",
  "PREPAYMENT_SUBMITTED",
  "AWAITING_PURCHASE",
  "PURCHASED",
  "IN_TRANSIT",
  "ARRIVED",
  "WEIGHING",
  "AWAITING_FINAL_PAYMENT",
  "FINAL_PAYMENT_SUBMITTED",
  "PAID_FULL",
  "READY_TO_SHIP",
  "SHIPPED",
  "COMPLETED",
  "CANCELLED",
];
export function orderFixture(status = "IN_TRANSIT", id = "STZ-FIXTURE-001") {
  const scenario =
    status === "CANCELLED"
      ? "cancelled"
      : status === "AWAITING_PREPAYMENT"
        ? "waiting"
        : status === "PREPAYMENT_SUBMITTED"
          ? "pending"
          : status === "AWAITING_FINAL_PAYMENT"
            ? "final-waiting"
            : status === "FINAL_PAYMENT_SUBMITTED"
              ? "final-pending"
              : ["PAID_FULL", "READY_TO_SHIP", "SHIPPED", "COMPLETED"].includes(
                    status,
                  )
                ? "final-approved"
                : "approved";
  const data = paymentFixture(scenario);
  data.order.status = status;
  data.order.publicId = id;
  data.instructions.orderPublicId = id;
  if (data.instructions.latestPayment)
    data.instructions.latestPayment.orderPublicId = id;
  data.order.recipient = {
    fullName: "TEST RECIPIENT",
    phone: "+998000000000",
    city: "TEST CITY",
    address: "TEST ADDRESS 1",
    apartment: "TEST 2",
    comment: "TEST COMMENT — not a real delivery address",
  };
  data.order.items[0].productNameRu = "Худи · снимок заказа";
  data.order.items[0].productNameUz = "Hudi · buyurtma nusxasi";
  return data;
}
export function orderFixtures() {
  return statuses.map((status, index) =>
    orderFixture(status, `STZ-FIXTURE-${String(index + 1).padStart(3, "0")}`),
  );
}
