"use client";
import { safeImageUrl } from "../../lib/products";
import { uzs, type AdminOrder } from "../../lib/orders";
import { usePreferences } from "../Preferences";
export function OrderOverview({ order }: { order: AdminOrder }) {
  const { t, locale } = usePreferences();
  const fields = [
    [t("customerName"), order.recipient.fullName],
    [
      t("telegram"),
      `${order.customer.username ? `@${order.customer.username} · ` : ""}${order.customer.telegramId}`,
    ],
    [t("phone"), order.recipient.phone],
    [t("city"), order.recipient.city],
    [t("address"), order.recipient.address],
    [t("apartment"), order.recipient.apartment ?? "—"],
    [t("comment"), order.recipient.comment ?? "—"],
  ];
  return (
    <>
      <section className="editor">
        <h2>{t("customer")}</h2>
        <dl className="detail-grid">
          {fields.map(([label, value]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      </section>
      <section className="editor">
        <h2>{t("orderItems")}</h2>
        <p className="muted section-intro">{t("snapshotHint")}</p>
        <div className="order-items">
          {order.items.map((item, index) => (
            <article className="order-item" key={`${item.sku}-${index}`}>
              <div className="order-item-image">
                {item.imageUrl && safeImageUrl(item.imageUrl) ? (
                  <img
                    src={safeImageUrl(item.imageUrl)}
                    alt={
                      locale === "ru" ? item.productNameRu : item.productNameUz
                    }
                    loading="lazy"
                  />
                ) : (
                  <span className="empty-icon" aria-hidden="true">
                    ◇
                  </span>
                )}
              </div>
              <div className="order-item-details">
                <h3>
                  {locale === "ru" ? item.productNameRu : item.productNameUz}
                </h3>
                <code>{item.sku}</code>
                <dl className="detail-grid item-grid">
                  {[
                    [t("size"), item.size],
                    [t("color"), item.color ?? "—"],
                    [t("quantity"), item.quantity],
                    [
                      t("unitPrice"),
                      `${uzs(item.unitPrice, locale)} ${t("sum")}`,
                    ],
                    [
                      t("lineTotal"),
                      `${uzs(item.lineTotal, locale)} ${t("sum")}`,
                    ],
                    [t("height"), item.heightCm ?? "—"],
                    [t("weight"), item.weightKg ?? "—"],
                  ].map(([label, value]) => (
                    <div key={label}>
                      <dt>{label}</dt>
                      <dd>{value}</dd>
                    </div>
                  ))}
                </dl>
                {item.sourceUrl && safeImageUrl(item.sourceUrl) && (
                  <a
                    className="button secondary procurement-link"
                    href={safeImageUrl(item.sourceUrl)}
                    target="_blank"
                    rel="noopener noreferrer"
                    referrerPolicy="no-referrer"
                  >
                    {t("procurementLink")} ↗
                  </a>
                )}
              </div>
            </article>
          ))}
        </div>
      </section>
    </>
  );
}
