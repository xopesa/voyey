export type GeneratorColor = {
  color: string;
  code: string;
  reviewed?: boolean;
};
export type VariantGeneratorInput = {
  baseSku: string;
  sizes: string[];
  colors: GeneratorColor[];
  stock: number | null;
  isActive: boolean;
};
export type GeneratedVariant = {
  sku: string;
  size: string;
  color: string | null;
  stock: number | null;
  isActive: boolean;
};
export type VariantPreviewRow = GeneratedVariant & {
  status: "NEW" | "EXISTS" | "CONFLICT";
  existingSku?: string;
};
export type VariantGeneratorErrorCode =
  | "invalidBaseSku"
  | "invalidGeneratorSizes"
  | "invalidColorCode"
  | "colorReviewRequired"
  | "generatorDuplicateColor"
  | "generatorLimit"
  | "generatorSkuLength"
  | "invalidInteger";
export class VariantGeneratorValidationError extends Error {
  constructor(public readonly code: VariantGeneratorErrorCode) {
    super(code);
  }
}
const colorKey = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[‘’ʻʼ`]/g, "'")
    .replace(/ё/g, "е");
const mappings: [string, string[]][] = [
  ["BLK", ["Black", "Чёрный", "Qora"]],
  ["WHT", ["White", "Белый", "Oq"]],
  ["CRM", ["Cream", "Кремовый", "Krem"]],
  ["BEG", ["Beige", "Бежевый", "Bej"]],
  ["GRY", ["Grey", "Gray", "Серый", "Kulrang"]],
  ["GRN", ["Green", "Зелёный", "Yashil"]],
  ["BLU", ["Blue", "Синий", "Ko‘k", "Kok"]],
  ["NVY", ["Navy"]],
  ["RED", ["Red", "Красный", "Qizil"]],
  ["BRN", ["Brown", "Коричневый", "Jigarrang"]],
  ["PNK", ["Pink", "Розовый", "Pushti"]],
  ["PUR", ["Purple", "Фиолетовый", "Binafsha"]],
  ["YLW", ["Yellow", "Жёлтый", "Sariq"]],
  ["ORG", ["Orange", "Оранжевый", "To‘q sariq"]],
];
const knownColors = new Map(
  mappings.flatMap(([code, names]) =>
    names.map((name) => [colorKey(name), code]),
  ),
);
export function suggestColorCode(color: string): {
  code: string;
  requiresReview: boolean;
} {
  const code = knownColors.get(colorKey(color));
  return code
    ? { code, requiresReview: false }
    : {
        code: color
          .replace(/[^a-z]/gi, "")
          .slice(0, 4)
          .toUpperCase(),
        requiresReview: true,
      };
}
const safeSegment = /^[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*$/;
export function normalizeVariantGenerator(
  input: VariantGeneratorInput,
): VariantGeneratorInput {
  const fail = (code: VariantGeneratorErrorCode): never => {
    throw new VariantGeneratorValidationError(code);
  };
  const baseSku = input.baseSku.trim().toUpperCase();
  if (!safeSegment.test(input.baseSku.trim()) || baseSku.length > 100)
    fail("invalidBaseSku");
  if (!input.sizes.length || input.sizes.length > 40)
    fail("invalidGeneratorSizes");
  const sizes = [
    ...new Set(input.sizes.map((size) => size.trim().toUpperCase())),
  ];
  if (
    input.sizes.some((size) => !safeSegment.test(size.trim())) ||
    sizes.some((size) => size.length > 50)
  )
    fail("invalidGeneratorSizes");
  if (
    input.stock !== null &&
    (!Number.isInteger(input.stock) ||
      input.stock < 0 ||
      input.stock > 2147483647)
  )
    fail("invalidInteger");
  if (typeof input.isActive !== "boolean" || input.colors.length > 20)
    fail("generatorLimit");
  const colors: GeneratorColor[] = [];
  for (const item of input.colors) {
    const code = item.code.trim().toUpperCase();
    if (
      !item.color.trim() ||
      item.color.length > 100 ||
      !/^[A-Za-z0-9]{2,6}$/.test(item.code.trim())
    )
      fail("invalidColorCode");
    if (suggestColorCode(item.color).requiresReview && item.reviewed !== true)
      fail("colorReviewRequired");
    const sameColor = colors.find(
      (c) => colorKey(c.color) === colorKey(item.color),
    );
    if (sameColor?.code === code) continue;
    if (sameColor || colors.some((c) => c.code === code))
      fail("generatorDuplicateColor");
    // Keep the display color exactly as entered; normalization is for matching only.
    colors.push({ ...item, code });
  }
  const normalized = { ...input, baseSku, sizes, colors };
  if (sizes.length * Math.max(1, colors.length) > 100) fail("generatorLimit");
  if (variantCombinations(normalized).some((row) => row.sku.length > 100))
    fail("generatorSkuLength");
  return normalized;
}
export function variantCombinations(
  input: VariantGeneratorInput,
): GeneratedVariant[] {
  return (input.colors.length ? input.colors : [null]).flatMap((color) =>
    input.sizes.map((size) => ({
      size,
      color: color?.color ?? null,
      sku: [input.baseSku, color?.code, size].filter(Boolean).join("-"),
      stock: input.stock,
      isActive: input.isActive,
    })),
  );
}
export function variantPair(size: string, color: string | null): string {
  return JSON.stringify([
    size.trim().toUpperCase(),
    color === null ? null : colorKey(color),
  ]);
}
export function classifyVariantGeneration(
  input: VariantGeneratorInput,
  existing: { id: string; size: string; color: string | null; sku: string }[],
  occupied: { id: string; sku: string }[],
): VariantPreviewRow[] {
  return variantCombinations(input).map((row) => {
    const match = existing.find(
      (item) =>
        variantPair(item.size, item.color) === variantPair(row.size, row.color),
    );
    const conflict = occupied.some(
      (item) => item.sku === row.sku && item.id !== match?.id,
    );
    return {
      ...row,
      status: conflict ? "CONFLICT" : match ? "EXISTS" : "NEW",
      ...(match ? { existingSku: match.sku } : {}),
    };
  });
}
