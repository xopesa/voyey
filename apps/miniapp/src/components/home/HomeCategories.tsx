"use client";

import Link from "next/link";
import { getCatalogCategories } from "../../lib/api-client";
import { catalogHref } from "../../lib/catalog";
import { usePreferences } from "../PreferencesProvider";
import { Skeleton } from "../ui/foundation";
import { CatalogState } from "./CatalogState";
import { useCatalogResource } from "./useCatalogResource";

export function HomeCategories() {
  const { t, localizedText } = usePreferences();
  const { state, retry } = useCatalogResource(getCatalogCategories);
  return (
    <section
      className="home-categories"
      aria-labelledby="home-categories-title"
      aria-busy={state.status === "loading"}
    >
      <h2 id="home-categories-title" className="home-section-title">
        {t("home.categories")}
      </h2>
      {state.status === "loading" ? (
        <div
          className="home-categories__scroll"
          role="status"
          aria-label={t("home.categoriesLoading")}
        >
          <span className="visually-hidden">{t("home.categoriesLoading")}</span>
          {[0, 1, 2].map((id) => (
            <Skeleton key={id} className="home-categories__skeleton" />
          ))}
        </div>
      ) : state.status === "error" ? (
        <CatalogState kind="categories" error retry={retry} />
      ) : state.data.length === 0 ? (
        <CatalogState kind="categories" />
      ) : (
        <div className="home-categories__scroll">
          <Link
            className="ui-badge home-category"
            data-active="true"
            href="/catalog"
          >
            {t("home.allCategories")}
          </Link>
          {state.data.map((category) => (
            <Link
              key={category.id}
              className="ui-badge home-category"
              href={catalogHref({ category: category.slug })}
            >
              {localizedText({ ru: category.nameRu, uz: category.nameUz })}
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}
