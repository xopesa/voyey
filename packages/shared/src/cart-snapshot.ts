/** Business fields that invalidate a displayed cart/promo quote; excludes display timestamps. */
export interface CartSnapshot {
  id: string;
  subtotal: number;
  items: Array<{
    saleMode?: string;
    id: string;
    product: { id: string };
    variant: { id: string; stock: number | null };
    quantity: number;
    unitPrice: number;
    lineTotal: number;
    heightCm: number | null;
    weightKg: number | null;
    isAvailable: boolean;
  }>;
}
export function cartSnapshotVersion(cart: CartSnapshot): string {
  return JSON.stringify([
    cart.id,
    cart.subtotal,
    cart.items
      .map((item) => [
        item.id,
        item.saleMode ?? "LEGACY",
        item.product.id,
        item.variant.id,
        item.quantity,
        item.unitPrice,
        item.lineTotal,
        item.heightCm,
        item.weightKg,
        item.variant.stock,
        item.isAvailable,
      ])
      .sort((a, b) =>
        String(a[0]) < String(b[0]) ? -1 : String(a[0]) > String(b[0]) ? 1 : 0,
      ),
  ]);
}
