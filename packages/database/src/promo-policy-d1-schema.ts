// Scalar read metadata; migration 0026 owns FKs and policy quarantine.
const fields = (types: Record<string, string>) =>
  Object.fromEntries(
    Object.entries(types).map(([name, type]) => [
      name,
      { type, updated: false },
    ]),
  );
export const promoPolicyModels = {
  PromoCampaign: {
    fields: fields({
      id: "String",
      campaignKey: "String",
      name: "String",
      createdBy: "String",
      createdAt: "DateTime",
    }),
    relations: {},
  },
  PromoCodePolicy: {
    fields: fields({
      promoCodeId: "String",
      saleModes: "String",
      audience: "String",
      purpose: "String",
      personalUserId: "String",
      campaignId: "String",
      scope: "String",
      createdBy: "String",
      createdAt: "DateTime",
      sealed: "Boolean",
    }),
    relations: {},
  },
  PromoPolicyCategory: {
    fields: fields({ promoCodeId: "String", categoryId: "String" }),
    relations: {},
  },
  PromoPolicyProduct: {
    fields: fields({ promoCodeId: "String", productId: "String" }),
    relations: {},
  },
  PromoPolicyExclusion: {
    fields: fields({
      promoCodeId: "String",
      productId: "String",
      saleModes: "String",
    }),
    relations: {},
  },
};
