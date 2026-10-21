import type { VariantGeneratorInput, VariantPreviewRow } from "@stenzo/shared";
import type { AdminVariantRecord } from "./types.js";

export interface VariantGeneratorRepository {
  preview(
    productId: string,
    input: VariantGeneratorInput,
  ): Promise<{ rows: VariantPreviewRow[] }>;
  apply(
    actor: string,
    productId: string,
    input: VariantGeneratorInput,
  ): Promise<{
    createdCount: number;
    existingCount: number;
    variants: AdminVariantRecord[];
  }>;
}
