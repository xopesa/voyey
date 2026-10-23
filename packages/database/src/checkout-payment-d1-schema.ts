// Scalar read facade metadata. SQL 0022 enforces relationships and state transitions.
const fields = (types: Record<string, string>) =>
  Object.fromEntries(
    Object.entries(types).map(([name, type]) => [
      name,
      { type, updated: false },
    ]),
  );
export const checkoutPaymentModels = {
  CheckoutPayment: {
    fields: fields({
      id: "String",
      orderId: "String",
      phase: "String",
      source: "String",
      submittedBy: "String",
      attachedBy: "String",
      submitKey: "String",
      submitFingerprint: "String",
      declaredAmount: "Int",
      expectedAmount: "Int",
      confirmedAmount: "Int",
      proofStorageKey: "String",
      proofMimeType: "String",
      proofSize: "Int",
      proofSha256: "String",
      status: "String",
      submittedAt: "DateTime",
      reviewedBy: "String",
      reviewedAt: "DateTime",
      reviewKey: "String",
      reviewFingerprint: "String",
      rejectionReason: "String",
    }),
    relations: {},
  },
  CheckoutPaymentLedger: {
    fields: fields({
      id: "String",
      paymentId: "String",
      orderId: "String",
      phase: "String",
      kind: "String",
      goodsAmount: "Int",
      cargoAmount: "Int",
      bankOperationDigest: "String",
      verifiedBy: "String",
      verifiedAt: "DateTime",
      reviewKey: "String",
      reviewFingerprint: "String",
    }),
    relations: {},
  },
};
