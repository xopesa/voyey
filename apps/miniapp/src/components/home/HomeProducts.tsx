"use client";

import Link from "next/link";
import { getCatalogProducts } from "../../lib/api-client";
import { usePreferences } from "../PreferencesProvider";
import { Skeleton } from "../ui/foundation";
import { Icon } from "../ui/Icon";
import { CatalogState } from "./CatalogState";
import { ProductCard } from "../catalog/ProductCard";
import { useCatalogResource } from "./useCatalogResource";
import { useProductReturnScroll } from "../product/useProductReturnScroll";

const loadProducts = (signal: AbortSignal) =>
  getCatalogProducts({ limit: 6 }, signal);

export function HomeProducts() {
  const { t } = usePreferences();
  const { state, retry } = useCatalogResource(loadProducts);
  useProductReturnScroll(state.status === "success");
  return (
    <section
      className="home-products"
      aria-labelledby="home-products-title"
      aria-busy={state.status === "loading"}
    >
      <div className="home-products__heading">
        <h2 id="home-products-title" className="home-section-title">
          {t("home.products")}
        </h2>
        <Link href="/catalog" className="home-all-link">
          {t("home.viewAll")}
          <Icon name="arrow" />
        </Link>
      </div>
      {state.status === "loading" ? (
        <div
          className="home-products__grid"
          role="status"
          aria-label={t("home.productsLoading")}
        >
          <span className="visually-hidden">{t("home.productsLoading")}</span>
          {[0, 1, 2, 3].map((id) => (
            <div className="product-skeleton" key={id}>
              <Skeleton className="product-skeleton__media" />
              <Skeleton className="product-skeleton__name" />
              <Skeleton className="product-skeleton__price" />
            </div>
          ))}
        </div>
      ) : state.status === "error" ? (
        <CatalogState kind="products" error retry={retry} />
      ) : state.data.products.length === 0 ? (
        <CatalogState kind="products" />
      ) : (
        <div className="home-products__grid">
          {state.data.products.map((product) => (
            <ProductCard key={product.id} product={product} from="/" />
          ))}
        </div>
      )}
    </section>
  );
}
