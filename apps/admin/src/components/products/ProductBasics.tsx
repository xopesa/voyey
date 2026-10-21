"use client";
import {
  effectiveProductPrice,
  fromTashkentInput,
  promotionStatus,
} from "@stenzo/shared";
import { usePreferences } from "../Preferences";
import type { Category, ProductDraft } from "../../lib/products";

export function ProductBasics({
  draft,
  setDraft,
  categories,
  isNew,
  disabled,
}: {
  draft: ProductDraft;
  setDraft: (draft: ProductDraft) => void;
  categories: Category[];
  isNew: boolean;
  disabled: boolean;
}) {
  const { t, locale } = usePreferences();
  const field = (key: keyof ProductDraft, value: string) =>
    setDraft({ ...draft, [key]: value });
  let preview = { effectivePrice: Number(draft.price), isOnSale: false },
    status = "invalid";
  try {
    const value = {
      price: Number(draft.price),
      salePrice: draft.salePrice ? Number(draft.salePrice) : null,
      saleStartsAt: fromTashkentInput(draft.saleStartsAt || ""),
      saleEndsAt: fromTashkentInput(draft.saleEndsAt || ""),
    };
    preview = effectiveProductPrice(value);
    status = promotionStatus(value);
  } catch {
    /* invalid draft is shown inline */
  }
  return (
    <fieldset disabled={disabled} className="product-fields">
      <section className="editor">
        <h2>{t("basicInformation")}</h2>
        <div className="form-grid">
          <label>
            {t("nameRu")}
            <input
              lang="ru"
              value={draft.nameRu}
              maxLength={200}
              required
              onChange={(event) => field("nameRu", event.target.value)}
            />
          </label>
          <label>
            {t("nameUz")}
            <input
              lang="uz"
              value={draft.nameUz}
              maxLength={200}
              required
              onChange={(event) => field("nameUz", event.target.value)}
            />
          </label>
          <label>
            {t("descriptionRu")}
            <textarea
              lang="ru"
              value={draft.descriptionRu}
              maxLength={20000}
              rows={5}
              onChange={(event) => field("descriptionRu", event.target.value)}
            />
          </label>
          <label>
            {t("descriptionUz")}
            <textarea
              lang="uz"
              value={draft.descriptionUz}
              maxLength={20000}
              rows={5}
              onChange={(event) => field("descriptionUz", event.target.value)}
            />
          </label>
          <label>
            {t("slug")}
            <input
              value={draft.slug}
              required
              pattern="[a-z0-9]+(-[a-z0-9]+)*"
              maxLength={100}
              onChange={(event) => field("slug", event.target.value)}
            />
            <small>{t("slugHint")}</small>
          </label>
          <label>
            {t("category")}
            <select
              value={draft.categoryId}
              required
              onChange={(event) => field("categoryId", event.target.value)}
            >
              <option value="">{t("chooseCategory")}</option>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {locale === "ru" ? category.nameRu : category.nameUz}
                  {category.isActive ? "" : ` · ${t("inactive")}`}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t("status")}
            <select
              value={draft.status}
              disabled={isNew}
              onChange={(event) => field("status", event.target.value)}
            >
              <option value="DRAFT">{t("draft")}</option>
              <option value="ACTIVE">{t("productActive")}</option>
              <option value="INACTIVE">{t("productInactive")}</option>
            </select>
            {isNew && <small>{t("draftFirst")}</small>}
          </label>
          <label>
            {t("sourceUrl")}
            <input
              type="url"
              value={draft.sourceUrl}
              maxLength={2048}
              placeholder="https://…"
              onChange={(event) => field("sourceUrl", event.target.value)}
            />
            <small>{t("sourceHint")}</small>
          </label>
        </div>
      </section>
      <section className="editor">
        <h2>{t("price")}</h2>
        <label className="price-field">
          {t("priceUZS")}
          <input
            value={draft.price}
            inputMode="numeric"
            pattern="[0-9]+"
            required
            placeholder="850000"
            onChange={(event) => field("price", event.target.value)}
          />
          <small>
            {t("priceHint")}
            {/^\d+$/.test(draft.price) &&
              Number(draft.price) <= 2147483647 &&
              ` · ${new Intl.NumberFormat(locale === "ru" ? "ru-RU" : "uz-UZ").format(Number(draft.price))} ${t("sum")}`}
          </small>
        </label>
        <label className="price-field">
          {t("productCostPrice")}
          <input
            value={draft.costPrice}
            inputMode="numeric"
            pattern="[0-9]+"
            placeholder={t("productCostPlaceholder")}
            onChange={(event) => field("costPrice", event.target.value)}
          />
          <small>{t("productCostHint")}</small>
        </label>
      </section>
      <section className="editor">
        <h2>{t("promotions")}</h2>
        <p>{t("promotionTimezone")}</p>
        <div className="form-grid">
          <label>
            {t("salePrice")}
            <input
              inputMode="numeric"
              pattern="[0-9]*"
              value={draft.salePrice || ""}
              onChange={(e) => field("salePrice", e.target.value)}
            />
          </label>
          <label>
            {t("saleStartsAt")}
            <input
              type="datetime-local"
              value={draft.saleStartsAt || ""}
              onChange={(e) => field("saleStartsAt", e.target.value)}
            />
          </label>
          <label>
            {t("saleEndsAt")}
            <input
              type="datetime-local"
              value={draft.saleEndsAt || ""}
              onChange={(e) => field("saleEndsAt", e.target.value)}
            />
          </label>
        </div>
        <p role="status">
          {t(`promotion_${status}` as "promotion_none")} · {t("effectivePrice")}
          :{" "}
          {Number.isFinite(preview.effectivePrice)
            ? new Intl.NumberFormat(locale).format(preview.effectivePrice)
            : "—"}{" "}
          UZS
        </p>
        <button
          type="button"
          className="btn"
          onClick={() =>
            setDraft({
              ...draft,
              salePrice: "",
              saleStartsAt: "",
              saleEndsAt: "",
            })
          }
        >
          {t("clearPromotion")}
        </button>
      </section>
    </fieldset>
  );
}
