import { describe, expect, it } from "vitest";
import {
  normalizeCatalogAttributeDefinitions as definitions,
  normalizeCatalogAttributeValues as values,
  validateCatalogAttributeValues as validate,
} from "@stenzo/shared";
import {
  categoryCreateSchema,
  categoryPatchSchema,
  productCreateSchema,
  productPatchSchema,
  variantCreateSchema,
  variantPatchSchema,
} from "../src/modules/admin/catalog/schemas.js";

const field = {
  key: "material",
  nameRu: "Материал",
  nameUz: "Material",
  type: "TEXT",
};
describe("universal category attributes", () => {
  it("uses optional definitions without fixed categories or buyer measurements", () => {
    const schema = definitions([field]);
    expect(schema[0]!.scope).toBe("PRODUCT");
    expect(validate(schema, {}, "PRODUCT")).toEqual({});
    expect(validate(schema, { material: " cotton " }, "PRODUCT")).toEqual({
      material: "cotton",
    });
    expect(() => validate(schema, { material: "cotton" }, "VARIANT")).toThrow();
  });
  it.each([
    ["TEXT", "cotton"],
    ["NUMBER", 12.5],
    ["INTEGER", 0],
    ["BOOLEAN", false],
  ])("accepts %s values without coercion", (type, value) => {
    const schema = definitions([{ ...field, type }]);
    expect(validate(schema, { material: value }, "PRODUCT")).toEqual({
      material: value,
    });
  });
  it.each([
    ["TEXT", 3],
    ["NUMBER", "3"],
    ["INTEGER", 1.5],
    ["BOOLEAN", "false"],
    ["NUMBER", NaN],
    ["NUMBER", Infinity],
    ["NUMBER", Number.MAX_SAFE_INTEGER + 1],
  ])("rejects invalid %s values", (type, value) => {
    expect(() =>
      validate(
        definitions([{ ...field, type }]),
        { material: value },
        "PRODUCT",
      ),
    ).toThrow();
  });
  it("checks bounds, scope and unknown keys", () => {
    const schema = definitions([
      {
        ...field,
        key: "pack_count",
        scope: "VARIANT",
        type: "INTEGER",
        min: 1,
        max: 12,
        unit: "шт",
      },
    ]);
    expect(validate(schema, { pack_count: 12 }, "VARIANT")).toEqual({
      pack_count: 12,
    });
    for (const v of [0, 13, 1.5])
      expect(() => validate(schema, { pack_count: v }, "VARIANT")).toThrow();
    expect(() => validate(schema, { unknown: 1 }, "PRODUCT")).toThrow();
  });
  it.each(
    [
      null,
      {},
      [field, field],
      [{ ...field, type: ["TEXT"] }],
      [{ ...field, scope: null }],
      [{ ...field, required: true }],
      [{ ...field, min: 1 }],
      [{ ...field, unit: "ml" }],
      [{ ...field, type: "NUMBER", min: 2, max: 1 }],
      [{ ...field, type: "INTEGER", min: 0.5 }],
      [{ ...field, type: "NUMBER", max: Infinity }],
      [{ ...field, nameUz: " " }],
      [{ ...field, key: "constructor" }],
      [{ ...field, key: "price" }],
      [{ ...field, key: "size" }],
      [{ ...field, key: "Bad-Key" }],
    ].map((input) => [input]),
  )("rejects malformed definition %#", (input) => {
    expect(() => definitions(input)).toThrow();
  });
  it.each([
    null,
    [],
    { material: null },
    { material: [] },
    { material: {} },
    { material: " " },
    { stock: 4 },
    JSON.parse('{"__proto__":"x"}'),
  ])("rejects malformed attribute map %#", (input) => {
    expect(() => values(input)).toThrow();
  });
  it("limits count, text length and UTF-8 storage size", () => {
    expect(() =>
      definitions(
        Array.from({ length: 33 }, (_, i) => ({ ...field, key: `field_${i}` })),
      ),
    ).toThrow();
    expect(() =>
      values(
        Object.fromEntries(
          Array.from({ length: 33 }, (_, i) => [`field_${i}`, true]),
        ),
      ),
    ).toThrow();
    expect(() => values({ material: "x".repeat(2001) })).toThrow();
    expect(() =>
      values(
        Object.fromEntries(
          Array.from({ length: 5 }, (_, i) => [`field_${i}`, "я".repeat(2000)]),
        ),
      ),
    ).toThrow();
    expect(() =>
      definitions(
        Array.from({ length: 32 }, (_, i) => ({
          ...field,
          key: `field_${i}`,
          nameRu: "я".repeat(200),
          nameUz: "я".repeat(200),
        })),
      ),
    ).toThrow();
  });
  it("preserves old create/patch contracts and accepts absent size", () => {
    expect(
      categoryCreateSchema.parse({
        nameRu: "Товар",
        nameUz: "Tovar",
        slug: "custom",
      }).attributeDefinitions,
    ).toEqual([]);
    expect(categoryPatchSchema.parse({ nameRu: "Другое" })).toEqual({
      nameRu: "Другое",
    });
    expect(
      productCreateSchema.parse({
        categoryId: "c",
        nameRu: "Товар",
        nameUz: "Tovar",
        slug: "p",
        price: 100,
      }).attributes,
    ).toEqual({});
    expect(productPatchSchema.parse({ price: 100 })).toEqual({ price: 100 });
    expect(productPatchSchema.parse({ attributes: {} })).toEqual({
      attributes: {},
    });
    for (const size of [undefined, null, "", " "]) {
      expect(variantCreateSchema.parse({ sku: "GENERIC", size }).size).toBe("");
    }
    expect(
      variantCreateSchema.parse({
        sku: "OLD",
        size: "M",
        color: "blue",
        stock: 3,
      }),
    ).toMatchObject({
      size: "M",
      color: "blue",
      stock: 3,
      attributes: {},
      preorderEnabled: false,
    });
    expect(variantPatchSchema.parse({ stock: 0 })).toEqual({ stock: 0 });
    expect(variantPatchSchema.parse({ size: null })).toEqual({ size: "" });
    expect(
      variantCreateSchema.safeParse({ sku: "NEW", price: 100 }).success,
    ).toBe(false);
  });
});
