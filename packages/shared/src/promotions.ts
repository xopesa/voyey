export type PromotionFields = {
  price: number;
  salePrice?: number | null;
  saleStartsAt?: string | Date | null;
  saleEndsAt?: string | Date | null;
};

const timestamp = (value: string | Date) => new Date(value).getTime();

/** UTC instants; start is inclusive and end is exclusive. Invalid data fails closed. */
export function effectiveProductPrice(
  product: PromotionFields,
  now: number | Date = Date.now(),
) {
  const time = Number(now);
  const valid = validPromotion(product);
  const starts = product.saleStartsAt
    ? timestamp(product.saleStartsAt)
    : -Infinity;
  const ends = product.saleEndsAt ? timestamp(product.saleEndsAt) : Infinity;
  const isOnSale =
    valid && product.salePrice != null && time >= starts && time < ends;
  return {
    effectivePrice: isOnSale ? product.salePrice! : product.price,
    isOnSale,
  };
}

export function validPromotion(product: PromotionFields): boolean {
  const { price, salePrice, saleStartsAt, saleEndsAt } = product;
  if (salePrice == null) return !saleStartsAt && !saleEndsAt;
  if (!Number.isInteger(salePrice) || salePrice <= 0 || salePrice >= price)
    return false;
  if (saleStartsAt && !Number.isFinite(timestamp(saleStartsAt))) return false;
  if (saleEndsAt && !Number.isFinite(timestamp(saleEndsAt))) return false;
  return (
    !(saleStartsAt && saleEndsAt) ||
    timestamp(saleStartsAt) < timestamp(saleEndsAt)
  );
}

export function promotionStatus(product: PromotionFields, now = Date.now()) {
  if (product.salePrice == null) return "none";
  if (!validPromotion(product)) return "invalid";
  if (effectiveProductPrice(product, now).isOnSale) return "active";
  return product.saleStartsAt && timestamp(product.saleStartsAt) > now
    ? "scheduled"
    : "expired";
}

/** Asia/Tashkent has no DST; datetime-local is explicitly presented as UTC+5. */
export function toTashkentInput(value?: string | Date | null): string {
  if (!value) return "";
  return new Date(timestamp(value) + 5 * 3600000).toISOString().slice(0, 16);
}
export function fromTashkentInput(value: string): string | null {
  if (!value) return null;
  if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d$/.test(value))
    throw new Error("invalidPromotion");
  const date = new Date(`${value}:00+05:00`);
  if (!Number.isFinite(date.getTime()) || toTashkentInput(date) !== value)
    throw new Error("invalidPromotion");
  return date.toISOString();
}
