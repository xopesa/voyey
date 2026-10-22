import { prisma } from "@stenzo/database";
import {
  CatalogAttributesValidationError,
  normalizeCatalogAttributeDefinitions,
  normalizeCatalogAttributeValues,
  validateCatalogAttributeValues,
  type CatalogAttributeDefinition,
  type CatalogAttributeScope,
} from "@stenzo/shared";
import { HttpError } from "../../auth/errors.js";

export function categoryDefinitions(
  value: unknown,
): CatalogAttributeDefinition[] {
  try {
    return normalizeCatalogAttributeDefinitions(value);
  } catch (error) {
    if (error instanceof CatalogAttributesValidationError)
      throw new HttpError(400, error.message);
    throw error;
  }
}
export function categoryAttributeValues(
  definitions: unknown,
  value: unknown,
  scope: CatalogAttributeScope,
) {
  try {
    return validateCatalogAttributeValues(
      categoryDefinitions(definitions),
      value,
      scope,
    );
  } catch (error) {
    if (error instanceof CatalogAttributesValidationError)
      throw new HttpError(400, error.message);
    throw error;
  }
}

/** Called INSIDE D1 atomic(): concurrent product/schema writes must revalidate. */
export async function assertCategoryAttributesCompatible(
  categoryId: string,
  previous: unknown,
  next: CatalogAttributeDefinition[],
) {
  const products = await prisma.product.findMany({
    where: { categoryId },
    select: { attributes: true, variants: { select: { attributes: true } } },
  });
  const used = new Set<string>();
  try {
    for (const product of products) {
      const values = normalizeCatalogAttributeValues(product.attributes);
      for (const key of Object.keys(values)) used.add(key);
      validateCatalogAttributeValues(next, values, "PRODUCT");
      for (const variant of product.variants) {
        const values = normalizeCatalogAttributeValues(variant.attributes);
        for (const key of Object.keys(values)) used.add(key);
        validateCatalogAttributeValues(next, values, "VARIANT");
      }
    }
    const old = categoryDefinitions(previous);
    // A new unit must never silently reinterpret previously stored numbers.
    for (const definition of old) {
      const replacement = next.find((d) => d.key === definition.key);
      if (used.has(definition.key) && replacement?.unit !== definition.unit)
        throw new CatalogAttributesValidationError();
    }
  } catch (error) {
    if (error instanceof CatalogAttributesValidationError)
      throw new HttpError(
        409,
        "Category attributes conflict with existing products or variants",
      );
    throw error;
  }
}
