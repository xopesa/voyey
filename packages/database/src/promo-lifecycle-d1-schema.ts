// Scalar metadata. SQL 0028 owns all FK, transition and timing invariants.
export const promoLifecycleModels = {
  CheckoutFirstWindow: {
    fields: {
      orderId: {
        type: "String",
        updated: false,
      },
      checkoutGroupId: {
        type: "String",
        updated: false,
      },
      createdAt: {
        type: "DateTime",
        updated: false,
      },
      expiresAt: {
        type: "DateTime",
        updated: false,
      },
    },
    relations: {},
  },
  CheckoutFirstExtension: {
    fields: {
      orderId: {
        type: "String",
        updated: false,
      },
      paymentId: {
        type: "String",
        updated: false,
      },
      createdBy: {
        type: "String",
        updated: false,
      },
      decisionAt: {
        type: "DateTime",
        updated: false,
      },
      expiresAt: {
        type: "DateTime",
        updated: false,
      },
    },
    relations: {},
  },
  PromoReservation: {
    fields: {
      id: {
        type: "String",
        updated: false,
      },
      promoCodeId: {
        type: "String",
        updated: false,
      },
      checkoutGroupId: {
        type: "String",
        updated: false,
      },
      orderId: {
        type: "String",
        updated: false,
      },
      userId: {
        type: "String",
        updated: false,
      },
      discountAmount: {
        type: "Int",
        updated: false,
      },
      policySnapshot: {
        type: "Json",
        updated: false,
      },
      createdAt: {
        type: "DateTime",
        updated: false,
      },
    },
    relations: {},
  },
  PromoReservationEvent: {
    fields: {
      id: {
        type: "String",
        updated: false,
      },
      reservationId: {
        type: "String",
        updated: false,
      },
      kind: {
        type: "String",
        updated: false,
      },
      actorId: {
        type: "String",
        updated: false,
      },
      createdAt: {
        type: "DateTime",
        updated: false,
      },
      paymentLedgerId: {
        type: "String",
        updated: false,
      },
      cancellationId: {
        type: "String",
        updated: false,
      },
    },
    relations: {},
  },
} as const;
