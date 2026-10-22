/** Future order selection; existing checkout does not accept either mode yet. */
export type SaleMode = "IN_STOCK" | "PREORDER";

export interface VariantSaleAvailability {
  IN_STOCK: {
    /** null means legacy untracked stock, not physical inventory or preorder. */
    quantity: number | null;
    available: boolean;
  };
  PREORDER: {
    /** Catalog permission only; no order/payment/reservation rules are activated. */
    enabled: boolean;
    checkoutEnabled: false;
  };
}

export function variantSaleAvailability(
  stock: number | null,
  preorderEnabled = false,
): VariantSaleAvailability {
  return {
    IN_STOCK: { quantity: stock, available: stock !== null && stock > 0 },
    PREORDER: { enabled: preorderEnabled, checkoutEnabled: false },
  };
}
