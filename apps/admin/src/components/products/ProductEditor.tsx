"use client";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { AdminFrame } from "../AdminFrame";
import { usePreferences } from "../Preferences";
import { api, errorKey } from "../../lib/api";
import {
  emptyDraft,
  productDraft,
  productInput,
  type Category,
  type Product,
} from "../../lib/products";
import type { MessageKey } from "../../lib/i18n";
import { ProductBasics } from "./ProductBasics";
import { ProductImages } from "./ProductImages";
import { ProductVariants } from "./ProductVariants";
import { useUnsavedChanges } from "./useUnsavedChanges";
import { TelegramChannel } from "./TelegramChannel";

export function ProductEditor({
  csrfToken,
  productId,
}: {
  csrfToken: string;
  productId?: string;
}) {
  const { t } = usePreferences();
  const router = useRouter();
  const [product, setProduct] = useState<Product | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [draft, setDraft] = useState(emptyDraft);
  const [baseline, setBaseline] = useState(emptyDraft);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [resourceBusy, setResourceBusy] = useState(false);
  const [variantDirty, setVariantDirty] = useState(false);
  const [photosDirty, setPhotosDirty] = useState(false);
  const [error, setError] = useState<MessageKey | null>(null);
  const [notice, setNotice] = useState<MessageKey | null>(null);
  const [revision, setRevision] = useState(0);
  const [maxImageBytes, setMaxImageBytes] = useState(5242880);
  const [publishToChannel, setPublishToChannel] = useState(false);
  useEffect(() => setPublishToChannel(false), [productId]);
  const dirty = JSON.stringify(draft) !== JSON.stringify(baseline);
  const blocked = busy || resourceBusy;
  useUnsavedChanges(
    dirty || variantDirty || photosDirty || blocked,
    t("discardChanges"),
  );
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    Promise.all([
      api<{ categories: Category[] }>("catalog/categories", {
        signal: controller.signal,
      }),
      productId
        ? api<{ product: Product }>(
            `catalog/products/${encodeURIComponent(productId)}`,
            { signal: controller.signal },
          )
        : Promise.resolve(null),
      api<{ maxImageUploadSize: number }>("catalog/upload-config", {
        signal: controller.signal,
      }),
    ])
      .then(([cats, result, config]) => {
        if (controller.signal.aborted) return;
        setCategories(cats.categories.filter((c) => !c.archivedAt));
        setMaxImageBytes(config.maxImageUploadSize);
        const next = result ? productDraft(result.product) : { ...emptyDraft };
        setProduct(result?.product ?? null);
        setDraft(next);
        setBaseline(next);
      })
      .catch((error) => {
        if (!controller.signal.aborted) setError(errorKey(error));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [productId, revision]);
  const refresh = useCallback(async () => {
    if (!productId) return;
    // Refresh media/variants without replacing unsaved basic fields.
    const result = await api<{ product: Product }>(
      `catalog/products/${encodeURIComponent(productId)}`,
    );
    setProduct(result.product);
  }, [productId]);
  async function save(event: FormEvent) {
    event.preventDefault();
    if (blocked) return;
    setError(null);
    setNotice(null);
    try {
      const { currency, ...fields } = productInput(draft);
      setBusy(true);
      const result = await api<{ product: Product }>(
        productId
          ? `catalog/products/${encodeURIComponent(productId)}`
          : "catalog/products",
        {
          method: productId ? "PATCH" : "POST",
          headers: { "x-csrf-token": csrfToken },
          body: JSON.stringify(
            productId
              ? { ...fields, publishToChannel }
              : {
                  ...fields,
                  currency,
                  status: "DRAFT",
                  publishToChannel: false,
                },
          ),
        },
      );
      const next = productDraft(result.product);
      setProduct(result.product);
      setDraft(next);
      setBaseline(next);
      setNotice("productSaved");
      if (!productId) router.replace(`/products/${result.product.id}`);
    } catch (error) {
      const validation =
        error instanceof Error &&
        ["invalidInteger", "invalidSource", "invalid"].includes(error.message)
          ? (error.message as MessageKey)
          : errorKey(error);
      setError(validation);
    } finally {
      setBusy(false);
    }
  }
  async function toggle() {
    if (!product || blocked || dirty || variantDirty || photosDirty) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await api<{ product: Product }>(
        `catalog/products/${product.id}/${product.status === "ACTIVE" ? "deactivate" : "activate"}`,
        {
          method: "POST",
          headers: { "x-csrf-token": csrfToken },
          body: JSON.stringify({
            publishToChannel: product.status !== "ACTIVE" && publishToChannel,
          }),
        },
      );
      setProduct(result.product);
      const next = productDraft(result.product);
      setDraft(next);
      setBaseline(next);
      setNotice("productUpdated");
    } catch (error) {
      setError(errorKey(error));
    } finally {
      setBusy(false);
    }
  }
  const activationBlocked =
    blocked || dirty || variantDirty || photosDirty || !!product?.archivedAt;
  return (
    <AdminFrame
      csrfToken={csrfToken}
      preventLogout={dirty || variantDirty || photosDirty || blocked}
    >
      <div className="page-heading">
        <div>
          <a className="muted" href="/admin/products">
            ← {t("backProducts")}
          </a>
          <h1>{t(productId ? "editProduct" : "newProduct")}</h1>
          <p className="muted">{t("workflow")}</p>
        </div>
        {product && (
          <button
            className="secondary"
            onClick={toggle}
            disabled={activationBlocked}
            title={dirty ? t("saveBeforeActivate") : undefined}
          >
            {t(product.status === "ACTIVE" ? "deactivate" : "activate")}
          </button>
        )}
      </div>
      {loading ? (
        <div className="state" role="status">
          <span className="spinner" />
          {t("productsLoading")}
        </div>
      ) : (
        <>
          {error && (
            <p className="error" role="alert">
              {t(error)}
              {((!product && productId) || categories.length === 0) && (
                <button
                  className="quiet"
                  onClick={() => setRevision((value) => value + 1)}
                >
                  {t("retry")}
                </button>
              )}
            </p>
          )}
          {notice && (
            <p className="notice" role="status">
              {t(notice)}
            </p>
          )}
          {product?.archivedAt && (
            <p className="notice">
              {t("archiveProductLocked")}{" "}
              <a href="/admin/products">{t("backProducts")}</a>
            </p>
          )}
          {(!productId || product) && !product?.archivedAt && (
            <>
              <form onSubmit={save} aria-busy={busy}>
                <ProductBasics
                  draft={draft}
                  setDraft={setDraft}
                  categories={categories}
                  isNew={!productId}
                  disabled={busy}
                />
                {categories.length === 0 && (
                  <p className="error">{t("noCategories")}</p>
                )}
                <div className="editor-actions">
                  <button
                    className="primary"
                    disabled={blocked || categories.length === 0}
                  >
                    {t(busy ? "saving" : productId ? "save" : "saveDraft")}
                  </button>
                  <button
                    className="secondary"
                    type="button"
                    disabled={blocked || !dirty}
                    onClick={() => {
                      setDraft(baseline);
                      setError(null);
                    }}
                  >
                    {t("cancelEdit")}
                  </button>
                  {dirty && (
                    <span className="muted" role="status">
                      {t("unsaved")}
                    </span>
                  )}
                </div>
              </form>
              {product && productId ? (
                <>
                  <TelegramChannel
                    publishToChannel={publishToChannel}
                    onPublishToChannelChange={setPublishToChannel}
                    productId={productId}
                    active={product.status === "ACTIVE"}
                    initial={product.telegramPublication}
                    revision={product}
                    csrfToken={csrfToken}
                    disabled={activationBlocked}
                    choiceDisabled={blocked}
                    onBusyChange={setResourceBusy}
                  />
                  <ProductImages
                    productId={productId}
                    images={product.images}
                    csrfToken={csrfToken}
                    maxBytes={maxImageBytes}
                    disabled={blocked}
                    onBusyChange={setResourceBusy}
                    onDirtyChange={setPhotosDirty}
                    refresh={refresh}
                  />
                  <ProductVariants
                    productId={productId}
                    variants={product.variants}
                    csrfToken={csrfToken}
                    disabled={blocked}
                    onBusyChange={setResourceBusy}
                    onDirtyChange={setVariantDirty}
                    refresh={refresh}
                  />
                </>
              ) : (
                <section className="editor muted">{t("saveFirst")}</section>
              )}
            </>
          )}
        </>
      )}
    </AdminFrame>
  );
}
