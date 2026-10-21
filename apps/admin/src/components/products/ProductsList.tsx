"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { AdminFrame } from "../AdminFrame";
import { usePreferences } from "../Preferences";
import { api, errorKey } from "../../lib/api";
import { productQuery, type Product, type Category } from "../../lib/products";
import type { MessageKey } from "../../lib/i18n";

export function ProductsList({ csrfToken }: { csrfToken: string }) {
  const { t, locale } = usePreferences();
  const [categories, setCategories] = useState<Category[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [filters, setFilters] = useState({
    archive: "current" as "current" | "archived",
    search: "",
    category: "",
    status: "",
  });
  const [applied, setApplied] = useState(filters);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<MessageKey | null>(null);
  const [revision, setRevision] = useState(0);
  const [channelChoices, setChannelChoices] = useState<Record<string, boolean>>(
    {},
  );
  const generation = useRef(0);
  const mutationLock = useRef(false);
  async function archiveProduct(product: Product) {
    if (
      busy ||
      mutationLock.current ||
      !window.confirm(
        t(product.archivedAt ? "archiveRestoreConfirm" : "archiveConfirm"),
      )
    )
      return;
    mutationLock.current = true;
    setBusy(true);
    setError(null);
    try {
      await api(
        `catalog/products/${encodeURIComponent(product.id)}/${product.archivedAt ? "restore" : "archive"}`,
        { method: "POST", headers: { "x-csrf-token": csrfToken } },
      );
      setRevision((v) => v + 1);
    } catch (e) {
      setError(errorKey(e));
    } finally {
      mutationLock.current = false;
      setBusy(false);
    }
  }
  useEffect(() => {
    const controller = new AbortController();
    const current = ++generation.current;
    setLoading(true);
    setError(null);
    setProducts([]);
    setCursor(null);
    Promise.all([
      api<{ categories: Category[] }>("catalog/categories", {
        signal: controller.signal,
      }),
      api<{ products: Product[]; nextCursor: string | null }>(
        productQuery(applied),
        { signal: controller.signal },
      ),
    ])
      .then(([cats, result]) => {
        if (current !== generation.current) return;
        setCategories(cats.categories);
        setProducts(result.products);
        setCursor(result.nextCursor);
      })
      .catch((error) => {
        if (!controller.signal.aborted) setError(errorKey(error));
      })
      .finally(() => {
        if (current === generation.current) setLoading(false);
      });
    return () => controller.abort();
  }, [applied, revision]);
  async function more() {
    if (!cursor || busy) return;
    const current = generation.current;
    setBusy(true);
    setError(null);
    try {
      const result = await api<{
        products: Product[];
        nextCursor: string | null;
      }>(productQuery(applied, cursor));
      if (current !== generation.current) return;
      setProducts((previous) => [
        ...previous,
        ...result.products.filter(
          (item) => !previous.some((old) => old.id === item.id),
        ),
      ]);
      setCursor(result.nextCursor);
    } catch (error) {
      if (current === generation.current) setError(errorKey(error));
    } finally {
      setBusy(false);
    }
  }
  async function toggle(product: Product) {
    if (product.archivedAt || busy || mutationLock.current) return;
    setBusy(true);
    setError(null);
    try {
      await api(
        `catalog/products/${encodeURIComponent(product.id)}/${product.status === "ACTIVE" ? "deactivate" : "activate"}`,
        {
          method: "POST",
          headers: { "x-csrf-token": csrfToken },
          body: JSON.stringify({
            publishToChannel:
              product.status !== "ACTIVE" &&
              channelChoices[product.id] === true,
          }),
        },
      );
      setRevision((previous) => previous + 1);
    } catch (error) {
      setError(errorKey(error));
    } finally {
      setBusy(false);
    }
  }
  function search(event: FormEvent) {
    event.preventDefault();
    setApplied({ ...filters });
  }
  return (
    <AdminFrame csrfToken={csrfToken}>
      <div className="page-heading">
        <div>
          <p className="eyebrow">{t("catalog")}</p>
          <h1>{t("products")}</h1>
          <p className="muted">{t("productsIntro")}</p>
        </div>
        <a className="button primary" href="/admin/products/new">
          ＋ {t("newProduct")}
        </a>
      </div>
      <form
        className="product-filters product-archive-filters"
        onSubmit={search}
      >
        <label>
          {t("archiveFilter")}
          <select
            value={filters.archive}
            onChange={(e) =>
              setFilters({
                ...filters,
                archive: e.target.value as "current" | "archived",
              })
            }
          >
            <option value="current">{t("archiveCurrent")}</option>
            <option value="archived">{t("archiveArchived")}</option>
          </select>
        </label>
        <label>
          {t("search")}
          <input
            value={filters.search}
            maxLength={200}
            placeholder={t("searchPlaceholder")}
            onChange={(event) =>
              setFilters({ ...filters, search: event.target.value })
            }
          />
        </label>
        <label>
          {t("category")}
          <select
            value={filters.category}
            onChange={(event) =>
              setFilters({ ...filters, category: event.target.value })
            }
          >
            <option value="">{t("allCategories")}</option>
            {categories.map((category) => (
              <option key={category.id} value={category.slug}>
                {locale === "ru" ? category.nameRu : category.nameUz}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t("status")}
          <select
            value={filters.status}
            onChange={(event) =>
              setFilters({ ...filters, status: event.target.value })
            }
          >
            <option value="">{t("allStatuses")}</option>
            <option value="DRAFT">{t("draft")}</option>
            <option value="ACTIVE">{t("productActive")}</option>
            <option value="INACTIVE">{t("productInactive")}</option>
          </select>
        </label>
        <button className="secondary" disabled={busy}>
          {t("search")}
        </button>
      </form>
      {error && (
        <p className="error" role="alert">
          {t(error)}{" "}
          <button
            className="quiet"
            onClick={() => setRevision((value) => value + 1)}
            disabled={busy}
          >
            {t("retry")}
          </button>
        </p>
      )}
      <section className="list-panel" aria-busy={loading}>
        {loading ? (
          <div className="state" role="status">
            <span className="spinner" />
            {t("productsLoading")}
          </div>
        ) : products.length === 0 ? (
          <div className="state">
            <h2>{t("noProducts")}</h2>
            <p className="muted">{t("noProductsHint")}</p>
          </div>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>{t("products")}</th>
                  <th>{t("category")}</th>
                  <th>{t("price")}</th>
                  <th>{t("status")}</th>
                  <th>{t("actions")}</th>
                </tr>
              </thead>
              <tbody>
                {products.map((product) => (
                  <tr
                    key={product.id}
                    className={product.archivedAt ? "archived-row" : undefined}
                  >
                    <td>
                      <a
                        className="product-link"
                        href={`/admin/products/${product.id}`}
                      >
                        {locale === "ru" ? product.nameRu : product.nameUz}
                      </a>
                      <div className="muted">
                        <code>{product.slug}</code>
                      </div>
                    </td>
                    <td>
                      {locale === "ru"
                        ? product.category.nameRu
                        : product.category.nameUz}
                    </td>
                    <td className="nowrap">
                      {new Intl.NumberFormat(
                        locale === "ru" ? "ru-RU" : "uz-UZ",
                      ).format(product.price)}{" "}
                      {t("sum")}
                    </td>
                    <td>
                      <span
                        className={`badge ${product.status === "ACTIVE" ? "active" : ""}`}
                      >
                        {t(
                          product.status === "DRAFT"
                            ? "draft"
                            : product.status === "ACTIVE"
                              ? "productActive"
                              : "productInactive",
                        )}
                      </span>
                    </td>
                    <td>
                      <div className="row-actions">
                        {!product.archivedAt && (
                          <>
                            <a
                              className="button secondary"
                              href={`/admin/products/${product.id}`}
                            >
                              {t("edit")}
                            </a>
                            {product.status !== "ACTIVE" && (
                              <label
                                className="channel-publication-choice"
                                title={t("channelPublicationChoiceHint")}
                              >
                                <input
                                  type="checkbox"
                                  checked={channelChoices[product.id] === true}
                                  disabled={busy}
                                  onChange={(event) =>
                                    setChannelChoices((current) => ({
                                      ...current,
                                      [product.id]: event.target.checked,
                                    }))
                                  }
                                />
                                {t("channelAlsoPublish")}
                              </label>
                            )}
                            <button
                              className="quiet"
                              disabled={busy}
                              onClick={() => toggle(product)}
                            >
                              {t(
                                product.status === "ACTIVE"
                                  ? "deactivate"
                                  : "activate",
                              )}
                            </button>
                          </>
                        )}
                        <button
                          className="secondary"
                          disabled={busy}
                          onClick={() => archiveProduct(product)}
                        >
                          {t(
                            product.archivedAt
                              ? "archiveRestore"
                              : "archiveAction",
                          )}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      {cursor && (
        <div className="load-more">
          <button
            className="secondary"
            disabled={busy || loading}
            onClick={more}
          >
            {t(busy ? "working" : "loadMore")}
          </button>
        </div>
      )}
    </AdminFrame>
  );
}
