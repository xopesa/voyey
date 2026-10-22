import {
  CatalogAttributesValidationError,
  normalizeCatalogAttributeDefinitions,
  validateCatalogAttributeValues,
  type CatalogAttributeDefinition,
  type CatalogAttributeValues,
} from "./catalog-attributes.js";

/** Product names, SKU, size/color and prices already have dedicated OrderItem columns. */
export type CatalogOrderItemSnapshot = {
  version: 1;
  category: { id: string; nameRu: string; nameUz: string; slug: string } | null;
  requiresBuyerMeasurements: boolean;
  attributeDefinitions: CatalogAttributeDefinition[];
  productAttributes: CatalogAttributeValues;
  variantAttributes: CatalogAttributeValues;
};

type SnapshotCategory = {
  id?: string;
  nameRu?: string;
  nameUz?: string;
  slug?: string;
  requiresBuyerMeasurements?: boolean;
  attributeDefinitions?: unknown;
};

export function createCatalogOrderItemSnapshot(
  category: SnapshotCategory,
  productAttributes: unknown,
  variantAttributes: unknown,
): CatalogOrderItemSnapshot {
  const definitions = normalizeCatalogAttributeDefinitions(
    category.attributeDefinitions,
  );
  const product = validateCatalogAttributeValues(
    definitions,
    productAttributes,
    "PRODUCT",
  );
  const variant = validateCatalogAttributeValues(
    definitions,
    variantAttributes,
    "VARIANT",
  );
  const used = new Set([...Object.keys(product), ...Object.keys(variant)]);
  const { id, nameRu, nameUz, slug } = category;
  return {
    version: 1,
    // Optional identity is only for legacy repository fixtures; D1 loads all fields.
    category:
      id && nameRu && nameUz && slug ? { id, nameRu, nameUz, slug } : null,
    requiresBuyerMeasurements: category.requiresBuyerMeasurements !== false,
    attributeDefinitions: definitions.filter((d) => used.has(d.key)),
    productAttributes: product,
    variantAttributes: variant,
  };
}

/** Read only the stored snapshot: never enrich historical orders from today's catalog. */
export function readCatalogOrderItemSnapshot(
  value: unknown,
): CatalogOrderItemSnapshot | null {
  if (value === null || value === undefined) return null;
  const bad = (): never => {
    throw new CatalogAttributesValidationError(
      "Invalid order catalog snapshot",
    );
  };
  if (typeof value !== "object" || Array.isArray(value)) return bad();
  const raw = value as Record<string, unknown>;
  if (raw.version !== 1 || typeof raw.requiresBuyerMeasurements !== "boolean")
    return bad();
  let category: CatalogOrderItemSnapshot["category"] = null;
  if (raw.category !== null) {
    if (
      !raw.category ||
      typeof raw.category !== "object" ||
      Array.isArray(raw.category)
    )
      return bad();
    const c = raw.category as Record<string, unknown>;
    if (
      ![c.id, c.nameRu, c.nameUz, c.slug].every(
        (v) => typeof v === "string" && v.length > 0,
      )
    )
      return bad();
    category = {
      id: c.id as string,
      nameRu: c.nameRu as string,
      nameUz: c.nameUz as string,
      slug: c.slug as string,
    };
  }
  const result = createCatalogOrderItemSnapshot(
    {
      ...category,
      requiresBuyerMeasurements: raw.requiresBuyerMeasurements,
      attributeDefinitions: raw.attributeDefinitions,
    },
    raw.productAttributes,
    raw.variantAttributes,
  );
  return result;
}
