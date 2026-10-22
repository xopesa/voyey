import { describe, expect, it } from "vitest";
import {
  createCatalogOrderItemSnapshot,
  readCatalogOrderItemSnapshot,
  normalizeCatalogAttributeDefinitions as definitions,
} from "@stenzo/shared";
import {
  prepareOrderItems,
  type CheckoutLine,
} from "../src/modules/checkout/domain.js";
import { CheckoutMeasurementsError } from "../src/modules/checkout/errors.js";
import {
  categoryCreateSchema,
  categoryPatchSchema,
} from "../src/modules/admin/catalog/schemas.js";
import { parseManualOrder } from "../src/modules/admin/manual-orders.js";
import { addCartItemSchema } from "../src/modules/cart/schemas.js";

const field = { key: "brand", nameRu: "Бренд", nameUz: "Brend", type: "TEXT" };
const schema = definitions([
  field,
  {
    ...field,
    key: "pack_count",
    type: "INTEGER",
    scope: "VARIANT",
    unit: "шт",
    min: 1,
  },
  { ...field, key: "unused" },
]);
function line(required?: boolean): CheckoutLine {
  return {
    productId: "p",
    variantId: "v",
    quantity: 1,
    heightCm: null,
    weightKg: null,
    product: {
      id: "p",
      nameRu: "Товар",
      nameUz: "Tovar",
      slug: "product",
      price: 100001,
      currency: "UZS",
      status: "ACTIVE",
      images: [],
      category: {
        id: "c",
        nameRu: "Категория",
        nameUz: "Turkum",
        slug: "category",
        isActive: true,
        requiresBuyerMeasurements: required,
        attributeDefinitions: schema,
      },
      attributes: { brand: "Fixture" },
    },
    variant: {
      id: "v",
      productId: "p",
      sku: "FIXTURE",
      size: "",
      color: null,
      stock: 2,
      isActive: true,
      attributes: { pack_count: 12 },
    },
  };
}
describe("category-based buyer measurements", () => {
  it("keeps legacy categories required and explicitly opts out without checking names", () => {
    for (const required of [undefined, true])
      expect(() => prepareOrderItems([line(required)])).toThrow(
        CheckoutMeasurementsError,
      );
    const generic = line(false);
    generic.product.category.nameRu = "Одежда";
    const order = prepareOrderItems([generic]);
    expect(order.items[0]).toMatchObject({
      heightCm: null,
      weightKg: null,
      size: "",
      color: null,
    });
    expect(order.requiredPrepayment).toBe(50001);
    expect(order.remainingAmount).toBe(50000);
    expect(order.cargoAmount).toBeNull();
  });
  it.each([true, false])(
    "preserves valid measurements for required=%s",
    (required) => {
      const item = { ...line(required), heightCm: 180, weightKg: 75 };
      expect(prepareOrderItems([item]).items[0]).toMatchObject({
        heightCm: 180,
        weightKg: 75,
      });
    },
  );
  it.each([
    { heightCm: 99 },
    { heightCm: 251 },
    { heightCm: 180.5 },
    { heightCm: NaN },
    { weightKg: 29 },
    { weightKg: 301 },
    { weightKg: 80.5 },
    { weightKg: Infinity },
  ])("rejects invalid supplied optional measurements %#", (patch) => {
    expect(() => prepareOrderItems([{ ...line(false), ...patch }])).toThrow(
      CheckoutMeasurementsError,
    );
  });
  it("does not require a pair for an optional category, but still requires both for clothing", () => {
    expect(
      prepareOrderItems([{ ...line(false), heightCm: 180 }]).items[0]!.weightKg,
    ).toBeNull();
    expect(() => prepareOrderItems([{ ...line(true), heightCm: 180 }])).toThrow(
      CheckoutMeasurementsError,
    );
  });
  it("keeps category create/patch backward compatible and flag strictly Boolean", () => {
    const old = { nameRu: "Товар", nameUz: "Tovar", slug: "anything" };
    expect(categoryCreateSchema.parse(old).requiresBuyerMeasurements).toBe(
      true,
    );
    expect(
      categoryCreateSchema.parse({ ...old, requiresBuyerMeasurements: false })
        .requiresBuyerMeasurements,
    ).toBe(false);
    expect(categoryPatchSchema.parse({ nameRu: "Другое" })).toEqual({
      nameRu: "Другое",
    });
    for (const bad of [null, 0, 1, "false", [], {}]) {
      expect(
        categoryCreateSchema.safeParse({
          ...old,
          requiresBuyerMeasurements: bad,
        }).success,
      ).toBe(false);
      expect(
        categoryPatchSchema.safeParse({ requiresBuyerMeasurements: bad })
          .success,
      ).toBe(false);
    }
  });
  it("manual schema delegates category rules to the common engine; client overrides stay forbidden", () => {
    const input = {
      userId: "u",
      recipient: {
        fullName: "Synthetic buyer",
        phone: "+998900000000",
        city: "Fixture",
        address: "Fixture street",
      },
      items: [{ productId: "p", variantId: "v", quantity: 1 }],
    };
    expect(parseManualOrder(input).items[0]).toMatchObject({
      heightCm: null,
      weightKg: null,
    });
    for (const extra of [
      { requiresBuyerMeasurements: false },
      { catalogSnapshot: {} },
      { saleMode: "PREORDER" },
      { price: 1 },
    ]) {
      expect(
        addCartItemSchema.safeParse({ ...input.items[0], ...extra }).success,
      ).toBe(false);
      expect(() =>
        parseManualOrder({
          ...input,
          items: [{ ...input.items[0], ...extra }],
        }),
      ).toThrow();
    }
  });
});

describe("historical catalog snapshots", () => {
  it("captures category, only used definitions, product/SKU values and effective sizing policy", () => {
    const item = line(false);
    const snapshot = prepareOrderItems([item]).items[0]!.catalogSnapshot;
    expect(snapshot).toEqual({
      version: 1,
      category: {
        id: "c",
        nameRu: "Категория",
        nameUz: "Turkum",
        slug: "category",
      },
      requiresBuyerMeasurements: false,
      attributeDefinitions: schema.slice(0, 2),
      productAttributes: { brand: "Fixture" },
      variantAttributes: { pack_count: 12 },
    });
    expect(snapshot).not.toHaveProperty("price");
    expect(snapshot).not.toHaveProperty("productNameRu");
    item.product.attributes = { brand: "Changed" };
    item.product.category.nameRu = "Changed";
    item.variant.attributes = { pack_count: 1 };
    expect(snapshot.productAttributes.brand).toBe("Fixture");
    expect(snapshot.category!.nameRu).toBe("Категория");
    expect(
      readCatalogOrderItemSnapshot(JSON.parse(JSON.stringify(snapshot))),
    ).toEqual(snapshot);
  });
  it("does not manufacture history for old orders", () => {
    expect(readCatalogOrderItemSnapshot(undefined)).toBeNull();
    expect(readCatalogOrderItemSnapshot(null)).toBeNull();
    expect(
      createCatalogOrderItemSnapshot({}, undefined, undefined),
    ).toMatchObject({
      category: null,
      requiresBuyerMeasurements: true,
      productAttributes: {},
      variantAttributes: {},
    });
  });
  it.each(
    [
      {},
      [],
      { version: 2 },
      { version: 1, requiresBuyerMeasurements: false, category: {} },
    ].map((raw) => [raw]),
  )("rejects malformed stored snapshots %#", (raw) => {
    expect(() => readCatalogOrderItemSnapshot(raw)).toThrow();
  });
  it("does not publish arbitrary raw private fields from a stored JSON record", () => {
    const snapshot = prepareOrderItems([line(false)]).items[0]!.catalogSnapshot;
    const raw = {
      ...snapshot,
      costPrice: 40000,
      sourceUrl: "https://private.example.invalid",
      category: { ...snapshot.category!, privateCredential: "fixture" },
    };
    expect(readCatalogOrderItemSnapshot(raw)).toEqual(snapshot);
  });
});
