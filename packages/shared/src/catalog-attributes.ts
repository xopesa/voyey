export type CatalogAttributeScope = "PRODUCT" | "VARIANT";
export type CatalogAttributeType = "TEXT" | "NUMBER" | "INTEGER" | "BOOLEAN";
export type CatalogAttributeDefinition = {
  key: string;
  nameRu: string;
  nameUz: string;
  type: CatalogAttributeType;
  scope: CatalogAttributeScope;
  unit?: string;
  min?: number;
  max?: number;
};
export type CatalogAttributeValues = Record<string, string | number | boolean>;
export const CATALOG_ATTRIBUTES_MAX_BYTES = 16_384;
const reservedKeys = new Set([
  "__proto__",
  "prototype",
  "constructor",
  "sku",
  "size",
  "color",
  "stock",
  "price",
  "cost_price",
  "sale_price",
  "preorder_enabled",
]);
export class CatalogAttributesValidationError extends Error {}
const invalid = (): never => {
  throw new CatalogAttributesValidationError("Invalid catalog attributes");
};
const record = (value: unknown): value is Record<string, unknown> =>
  value !== null &&
  typeof value === "object" &&
  !Array.isArray(value) &&
  [Object.prototype, null].includes(Object.getPrototypeOf(value));
const keyValid = (key: string) =>
  /^[a-z][a-z0-9_]{0,49}$/.test(key) && !reservedKeys.has(key);
const finite = (value: unknown): value is number =>
  typeof value === "number" &&
  Number.isFinite(value) &&
  Math.abs(value) <= Number.MAX_SAFE_INTEGER;
function bounded(value: unknown) {
  if (
    new TextEncoder().encode(JSON.stringify(value)).byteLength >
    CATALOG_ATTRIBUTES_MAX_BYTES
  )
    invalid();
}
function text(value: unknown, max: number): string {
  if (typeof value !== "string" || !value.trim() || value.trim().length > max)
    return invalid();
  return value.trim();
}

/** Optional definitions, with no required buyer/body measurements or fixed categories. */
export function normalizeCatalogAttributeDefinitions(
  value: unknown = [],
): CatalogAttributeDefinition[] {
  if (!Array.isArray(value) || value.length > 32) return invalid();
  const keys = new Set<string>();
  const result = value.map((raw): CatalogAttributeDefinition => {
    if (
      !record(raw) ||
      Object.keys(raw).some(
        (k) =>
          ![
            "key",
            "nameRu",
            "nameUz",
            "type",
            "scope",
            "unit",
            "min",
            "max",
          ].includes(k),
      )
    )
      return invalid();
    if (typeof raw.key !== "string" || !keyValid(raw.key) || keys.has(raw.key))
      return invalid();
    keys.add(raw.key);
    if (
      typeof raw.type !== "string" ||
      !["TEXT", "NUMBER", "INTEGER", "BOOLEAN"].includes(raw.type)
    )
      return invalid();
    const scope = raw.scope === undefined ? "PRODUCT" : raw.scope;
    if (scope !== "PRODUCT" && scope !== "VARIANT") return invalid();
    const numeric = raw.type === "NUMBER" || raw.type === "INTEGER";
    if (!numeric && [raw.unit, raw.min, raw.max].some((v) => v !== undefined))
      return invalid();
    for (const limit of [raw.min, raw.max])
      if (
        limit !== undefined &&
        (!finite(limit) ||
          (raw.type === "INTEGER" && !Number.isSafeInteger(limit)))
      )
        return invalid();
    if (
      raw.min !== undefined &&
      raw.max !== undefined &&
      Number(raw.min) > Number(raw.max)
    )
      return invalid();
    return {
      key: raw.key,
      nameRu: text(raw.nameRu, 200),
      nameUz: text(raw.nameUz, 200),
      type: raw.type as CatalogAttributeType,
      scope,
      ...(raw.unit === undefined ? {} : { unit: text(raw.unit, 30) }),
      ...(raw.min === undefined ? {} : { min: raw.min as number }),
      ...(raw.max === undefined ? {} : { max: raw.max as number }),
    };
  });
  bounded(result);
  return result;
}

export function normalizeCatalogAttributeValues(
  value: unknown = {},
): CatalogAttributeValues {
  if (!record(value) || Object.keys(value).length > 32) return invalid();
  const result: CatalogAttributeValues = {};
  for (const key of Object.keys(value).sort()) {
    if (!keyValid(key)) return invalid();
    const item = value[key];
    if (typeof item === "string") result[key] = text(item, 2000);
    else if (typeof item === "boolean" || finite(item)) result[key] = item;
    else return invalid();
  }
  bounded(result);
  return result;
}

export function validateCatalogAttributeValues(
  definitions: readonly CatalogAttributeDefinition[],
  value: unknown,
  scope: CatalogAttributeScope,
): CatalogAttributeValues {
  const values = normalizeCatalogAttributeValues(value);
  const allowed = new Map(
    definitions.filter((d) => d.scope === scope).map((d) => [d.key, d]),
  );
  for (const [key, item] of Object.entries(values)) {
    const definition = allowed.get(key);
    if (!definition) return invalid();
    if (definition.type === "TEXT" && typeof item !== "string")
      return invalid();
    if (definition.type === "BOOLEAN" && typeof item !== "boolean")
      return invalid();
    if (definition.type === "NUMBER" || definition.type === "INTEGER") {
      if (
        !finite(item) ||
        (definition.type === "INTEGER" && !Number.isSafeInteger(item))
      )
        return invalid();
      if (definition.min !== undefined && item < definition.min)
        return invalid();
      if (definition.max !== undefined && item > definition.max)
        return invalid();
    }
  }
  return values;
}
