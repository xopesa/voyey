"use client";

import { useRouter, useSearchParams } from "next/navigation";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type FormEvent,
} from "react";
import { getCatalogCategories, getCatalogProducts } from "../../lib/api-client";
import { catalogHref } from "../../lib/catalog";
import { CatalogFeed } from "../../lib/catalog-feed";
import { usePreferences } from "../PreferencesProvider";
import { CatalogState } from "../home/CatalogState";
import { useCatalogResource } from "../home/useCatalogResource";
import { Button, Card, IconButton, Page, Skeleton } from "../ui/foundation";
import { Icon } from "../ui/Icon";
import { ProductCard } from "./ProductCard";
import { useProductReturnScroll } from "../product/useProductReturnScroll";

// Preserve loaded pages for the immediate return from a product, without a new
// API contract or persistent product cache. Detail and cart revalidate stock.
let returnFeed:
  { href: string; feed: CatalogFeed; savedAt: number } | undefined;

export function CatalogSkeleton() {
  const { t } = usePreferences();
  return (
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
  );
}

export function Catalog() {
  const { t, localizedText } = usePreferences();
  const router = useRouter();
  const params = useSearchParams();
  const search = (params.get("search") ?? "").trim().slice(0, 200);
  const category = (params.get("category") ?? "").trim();
  const [draft, setDraft] = useState(search);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const input = useRef<HTMLInputElement>(null);
  const categoryNav = useRef<HTMLElement>(null);
  const categories = useCatalogResource(getCatalogCategories);
  const feed = useMemo(
    () =>
      returnFeed?.href === catalogHref({ search, category }) &&
      Date.now() - returnFeed.savedAt < 300_000
        ? returnFeed.feed
        : new CatalogFeed({ search, category, limit: 12 }, getCatalogProducts),
    [search, category],
  );
  const state = useSyncExternalStore(
    feed.subscribe,
    feed.snapshot,
    feed.snapshot,
  );

  useEffect(() => {
    if (returnFeed?.feed === feed) returnFeed = undefined;
    if (feed.snapshot().status !== "success") void feed.start();
    return feed.cancel;
  }, [feed]);
  useEffect(() => {
    setDraft(search);
    return () => clearTimeout(timer.current);
  }, [search, category]);
  useEffect(() => {
    categoryNav.current
      ?.querySelector<HTMLButtonElement>('[aria-pressed="true"]')
      ?.scrollIntoView({
        inline: "nearest",
        block: "nearest",
        behavior: "smooth",
      });
  }, [category, categories.state]);
  useProductReturnScroll(
    state.status === "success" && categories.state.status !== "loading",
  );

  function updateSearch(value: string, immediate = false) {
    setDraft(value);
    clearTimeout(timer.current);
    const navigate = () =>
      router.replace(catalogHref({ search: value, category }), {
        scroll: false,
      });
    if (immediate) navigate();
    else timer.current = setTimeout(navigate, 300);
  }
  function chooseCategory(slug: string) {
    clearTimeout(timer.current);
    router.push(catalogHref({ search: draft, category: slug }), {
      scroll: false,
    });
  }
  function reset() {
    clearTimeout(timer.current);
    setDraft("");
    router.push("/catalog", { scroll: false });
  }
  function submit(event: FormEvent) {
    event.preventDefault();
    updateSearch(draft, true);
  }
  const filtered = Boolean(search || category);

  return (
    <Page className="catalog-page">
      <header className="catalog-heading">
        <p className="ui-eyebrow">{t("catalog.eyebrow")}</p>
        <h1 className="ui-heading">{t("nav.catalog")}</h1>
        <p className="ui-copy">{t("catalog.subtitle")}</p>
      </header>
      <form className="catalog-search" role="search" onSubmit={submit}>
        <Icon name="search" />
        <label className="visually-hidden" htmlFor="catalog-search-input">
          {t("catalog.searchLabel")}
        </label>
        <input
          ref={input}
          id="catalog-search-input"
          type="search"
          value={draft}
          onChange={(event) => updateSearch(event.target.value)}
          placeholder={t("catalog.searchPlaceholder")}
          maxLength={200}
          autoComplete="off"
          enterKeyHint="search"
        />
        {draft && (
          <IconButton
            className="catalog-search__clear"
            label={t("catalog.clearSearch")}
            onClick={() => {
              updateSearch("", true);
              input.current?.focus();
            }}
          >
            <Icon name="close" />
          </IconButton>
        )}
      </form>
      <section
        className="catalog-categories"
        aria-label={t("home.categories")}
        aria-busy={categories.state.status === "loading"}
      >
        {categories.state.status === "loading" ? (
          <div
            className="home-categories__scroll"
            role="status"
            aria-label={t("home.categoriesLoading")}
          >
            {[0, 1, 2].map((id) => (
              <Skeleton key={id} className="home-categories__skeleton" />
            ))}
          </div>
        ) : categories.state.status === "error" ? (
          <CatalogState kind="categories" error retry={categories.retry} />
        ) : (
          <>
            <nav
              ref={categoryNav}
              className="home-categories__scroll"
              aria-label={t("home.categories")}
            >
              <button
                type="button"
                className="ui-badge catalog-category"
                aria-pressed={!category}
                onClick={() => chooseCategory("")}
              >
                {t("home.allCategories")}
              </button>
              {categories.state.data.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className="ui-badge catalog-category"
                  aria-pressed={category === item.slug}
                  onClick={() => chooseCategory(item.slug)}
                >
                  {localizedText({ ru: item.nameRu, uz: item.nameUz })}
                </button>
              ))}
            </nav>
            {categories.state.data.length === 0 && (
              <p className="ui-copy">{t("home.categoriesEmpty")}</p>
            )}
          </>
        )}
      </section>
      <section
        className="catalog-results"
        aria-labelledby="catalog-results-title"
        aria-busy={state.status === "loading" || state.loadingMore}
      >
        <div className="catalog-results__heading">
          <h2 id="catalog-results-title" className="home-section-title">
            {t("home.products")}
          </h2>
          {filtered && (
            <button type="button" className="catalog-reset" onClick={reset}>
              {t("catalog.resetFilters")}
            </button>
          )}
        </div>
        {state.status === "loading" ? (
          <CatalogSkeleton />
        ) : state.status === "error" ? (
          <CatalogState kind="products" error retry={() => void feed.start()} />
        ) : state.products.length === 0 ? (
          <Card className="catalog-empty" role="status">
            <span className="catalog-empty__icon">
              <Icon name={filtered ? "search" : "catalog"} />
            </span>
            <h3>{t(filtered ? "catalog.noResults" : "home.productsEmpty")}</h3>
            <p className="ui-copy">
              {t(filtered ? "catalog.noResultsHint" : "home.productsEmptyHint")}
            </p>
            {filtered && (
              <Button variant="secondary" onClick={reset}>
                {t("catalog.resetFilters")}
              </Button>
            )}
          </Card>
        ) : (
          <>
            <div className="home-products__grid">
              {state.products.map((product) => (
                <ProductCard
                  key={product.id}
                  product={product}
                  from={catalogHref({ search, category })}
                  onOpen={() => {
                    if (!state.loadingMore)
                      returnFeed = {
                        href: catalogHref({ search, category }),
                        feed,
                        savedAt: Date.now(),
                      };
                  }}
                />
              ))}
            </div>
            <div className="catalog-pagination">
              <p className="ui-copy" role="status" aria-live="polite">
                {t("catalog.loadedCount", { count: state.products.length })}
              </p>
              {state.moreError && (
                <p className="ui-copy" role="alert">
                  {t("catalog.moreError")}
                </p>
              )}
              {state.nextCursor && (
                <Button
                  variant="secondary"
                  disabled={state.loadingMore}
                  onClick={() => void feed.more()}
                >
                  {t(
                    state.loadingMore
                      ? "catalog.loadingMore"
                      : state.moreError
                        ? "home.retry"
                        : "catalog.loadMore",
                  )}
                </Button>
              )}
            </div>
          </>
        )}
      </section>
    </Page>
  );
}
