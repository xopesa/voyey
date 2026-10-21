"use client";

import Link from "next/link";
import { useCallback } from "react";
import { getCatalogProduct, ApiRequestError } from "../../lib/api-client";
import { usePreferences } from "../PreferencesProvider";
import { useCatalogResource } from "../home/useCatalogResource";
import { Button, Card, Page, Skeleton } from "../ui/foundation";
import { Icon } from "../ui/Icon";
import { ProductView } from "./ProductView";

export function ProductDetail({ slug }: { slug: string }) {
  const { t } = usePreferences();
  const load = useCallback(
    async (signal: AbortSignal) => {
      try {
        return await getCatalogProduct(slug, signal);
      } catch (error) {
        if (error instanceof ApiRequestError && error.status === 404)
          return null;
        throw error;
      }
    },
    [slug],
  );
  const { state, retry } = useCatalogResource(load);
  return (
    <Page className="product-page">
      {state.status === "loading" ? (
        <div
          className="product-loading"
          role="status"
          aria-label={t("product.loading")}
        >
          <span className="visually-hidden">{t("product.loading")}</span>
          <Skeleton className="product-loading__image" />
          <Skeleton className="product-loading__title" />
          <Skeleton className="product-loading__price" />
          <Skeleton className="product-loading__options" />
        </div>
      ) : state.status === "error" || !state.data ? (
        <Card
          className="product-state"
          role={state.status === "error" ? "alert" : "status"}
        >
          <Icon name={state.status === "error" ? "retry" : "catalog"} />
          <h1>
            {t(state.status === "error" ? "product.error" : "product.notFound")}
          </h1>
          <p className="ui-copy">
            {t(
              state.status === "error"
                ? "home.errorHint"
                : "product.notFoundHint",
            )}
          </p>
          {state.status === "error" && (
            <Button onClick={retry}>{t("home.retry")}</Button>
          )}
          <Link href="/catalog" className="ui-button ui-button--secondary">
            {t("product.toCatalog")}
          </Link>
        </Card>
      ) : (
        <ProductView key={state.data.id} product={state.data} reload={retry} />
      )}
    </Page>
  );
}
