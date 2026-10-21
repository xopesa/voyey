import type { Cart } from "../../lib/cart";
import {
  cartImageSource,
  displayedPrepayment,
  formatCartAmount,
} from "../../lib/cart";
import { CartPhoto } from "../cart/CartItemCard";
import { usePreferences } from "../PreferencesProvider";
import { Card } from "../ui/foundation";
export function CheckoutSummary({
  cart,
  promo,
}: {
  cart: Cart;
  promo?: { code: string; discountAmount: number; total: number };
}) {
  const total = promo?.total ?? cart.subtotal;
  const { t, localizedText } = usePreferences();
  const format = (value: number) => formatCartAmount(value, t("cart.currency"));
  return (
    <>
      <Card className="checkout-section">
        <h2>
          <span>4</span>
          {t("checkout.order")}
        </h2>
        <div className="checkout-order-items">
          {cart.items.map((item) => {
            const name = localizedText({
              ru: item.product.nameRu,
              uz: item.product.nameUz,
            });
            const src = cartImageSource(item);
            return (
              <article
                key={item.id}
                className="checkout-order-item"
                data-unavailable={!item.isAvailable}
              >
                <CartPhoto key={src ?? "empty"} src={src} name={name} />
                <div>
                  <h3>{name}</h3>
                  <p className="ui-copy">
                    {t("product.size")} {item.variant.size}
                    {item.variant.color
                      ? ` · ${t("product.color")} ${item.variant.color}`
                      : ""}
                  </p>
                  <p className="ui-copy">
                    {t("checkout.quantity", { count: item.quantity })} ·{" "}
                    {format(item.unitPrice)}
                  </p>
                  <p className="ui-copy">
                    {t("product.height")}: {item.heightCm ?? "—"} ·{" "}
                    {t("product.weight")}: {item.weightKg ?? "—"}
                  </p>
                  <p className="checkout-line-total">
                    {t("cart.lineTotal")}{" "}
                    <strong>{format(item.lineTotal)}</strong>
                  </p>
                  {!item.isAvailable && (
                    <p className="cart-error">{t("cart.unavailable")}</p>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      </Card>
      <Card className="checkout-section checkout-total">
        <h2>
          <span>5</span>
          {t("checkout.total")}
        </h2>
        <dl>
          <div>
            <dt>{t("promo.subtotal")}</dt>
            <dd>{format(cart.subtotal)}</dd>
          </div>
          {promo && (
            <>
              <div>
                <dt>
                  {t("promo.label")} {promo.code}
                </dt>
                <dd>−{format(promo.discountAmount)}</dd>
              </div>
              <div>
                <dt>{t("cart.fullTotal")}</dt>
                <dd>{format(total)}</dd>
              </div>
            </>
          )}
          <div>
            <dt>{t("cart.prepayment")}</dt>
            <dd>{format(displayedPrepayment(total))}</dd>
          </div>
          <div>
            <dt>{t("checkout.remaining")}</dt>
            <dd>{format(total - displayedPrepayment(total))}</dd>
          </div>
        </dl>
        <p className="ui-copy">{t("product.cargo")}</p>
        <p className="checkout-field-hint">{t("cart.estimate")}</p>
      </Card>
    </>
  );
}
