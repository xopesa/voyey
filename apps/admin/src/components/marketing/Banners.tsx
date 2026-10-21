"use client";
import { useEffect, useState, type FormEvent } from "react";
import type { AdminBanner, BannerInput, BannerTarget } from "@stenzo/shared";
import { AdminFrame } from "../AdminFrame";
import { usePreferences } from "../Preferences";
import { api, errorKey } from "../../lib/api";
import type { MessageKey } from "../../lib/i18n";
import type { Category, Product } from "../../lib/products";
import "../../styles/marketing.css";

export function MarketingHome({ csrfToken }: { csrfToken: string }) {
  const { t } = usePreferences();
  return (
    <AdminFrame csrfToken={csrfToken}>
      <div className="page-heading">
        <div>
          <p className="eyebrow">STENZO ADMIN</p>
          <h1>{t("marketing")}</h1>
          <p className="muted">{t("marketingIntro")}</p>
        </div>
      </div>
      <div className="marketing-cards">
        <a className="editor" href="/admin/marketing/banners">
          <h2>{t("banners")}</h2>
          <p className="muted">{t("bannersIntro")}</p>
          <span className="marketing-link">{t("open")} →</span>
        </a>
        <a className="editor" href="/admin/marketing/promo-codes">
          <h2>{t("promoCodes")}</h2>
          <p className="muted">{t("promoIntro")}</p>
          <span className="marketing-link">{t("open")} →</span>
        </a>
      </div>
      <div className="marketing-info">
        <a className="editor" href="/admin/products">
          <h2>{t("promotions")}</h2>
          <p className="muted">{t("promotionsIntro")}</p>
          <span className="marketing-link">{t("products")} →</span>
        </a>
      </div>
    </AdminFrame>
  );
}
const empty: BannerInput = {
  titleRu: "",
  titleUz: "",
  subtitleRu: null,
  subtitleUz: null,
  buttonRu: null,
  buttonUz: null,
  targetType: "NONE",
  targetCategoryId: null,
  targetProductId: null,
  targetUrl: null,
  sortOrder: 0,
  isActive: false,
};
const targetLabels = {
  NONE: "bannerNone",
  CATALOG: "catalog",
  CATEGORY: "category",
  PRODUCT: "products",
  URL: "bannerUrl",
} as const;
export function BannerManager({ csrfToken }: { csrfToken: string }) {
  const { t, locale } = usePreferences();
  const [banners, setBanners] = useState<AdminBanner[]>([]);
  const [editor, setEditor] = useState<{
    id?: string;
    imageUrl?: string;
    input: BannerInput;
  } | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false);
  const [error, setError] = useState<MessageKey | null>(null);
  const [notice, setNotice] = useState(false);
  const headers = { "x-csrf-token": csrfToken };
  async function load() {
    setBanners(
      (await api<{ banners: AdminBanner[] }>("marketing/banners")).banners,
    );
  }
  useEffect(() => {
    let live = true;
    load()
      .catch((e) => {
        if (live) setError(errorKey(e));
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, []);
  useEffect(() => {
    if (!editor || !["PRODUCT", "CATEGORY"].includes(editor.input.targetType))
      return;
    const controller = new AbortController();
    void (async () => {
      const cats = await api<{ categories: Category[] }>("catalog/categories", {
        signal: controller.signal,
      });
      setCategories(cats.categories);
      if (editor.input.targetType === "PRODUCT") {
        const all: Product[] = [];
        let cursor: string | null = null;
        do {
          const result: { products: Product[]; nextCursor: string | null } =
            await api(
              `catalog/products?limit=50${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
              { signal: controller.signal },
            );
          all.push(...result.products);
          cursor = result.nextCursor;
        } while (cursor && !controller.signal.aborted);
        setProducts(all);
      }
    })().catch((e) => {
      if (!controller.signal.aborted) setError(errorKey(e));
    });
    return () => controller.abort();
  }, [editor?.input.targetType]);
  function field<K extends keyof BannerInput>(key: K, value: BannerInput[K]) {
    setEditor((current) =>
      current
        ? { ...current, input: { ...current.input, [key]: value } }
        : current,
    );
  }
  function edit(b?: AdminBanner) {
    setError(null);
    setNotice(false);
    setFile(null);
    setEditor(
      b
        ? {
            id: b.id,
            imageUrl: b.imageUrl,
            input: Object.fromEntries(
              Object.keys(empty).map((key) => [
                key,
                b[key as keyof AdminBanner],
              ]),
            ) as unknown as BannerInput,
          }
        : { input: { ...empty } },
    );
  }
  async function save(e: FormEvent) {
    e.preventDefault();
    if (!editor || busy) return;
    setBusy(true);
    setError(null);
    setNotice(false);
    try {
      let id = editor.id;
      // Create an inactive draft before uploading. Keep its ID if a later step fails.
      if (!id) {
        const created = await api<{ banner: AdminBanner }>(
          "marketing/banners",
          {
            method: "POST",
            headers,
            body: JSON.stringify({ ...editor.input, isActive: false }),
          },
        );
        id = created.banner.id;
        setEditor({ ...editor, id });
      }
      if (file) {
        const form = new FormData();
        form.append("file", file);
        const result = await api<{ banner: AdminBanner }>(
          `marketing/banners/${encodeURIComponent(id)}/images/upload`,
          { method: "POST", headers, body: form },
        );
        setEditor({ ...editor, id, imageUrl: result.banner.imageUrl });
        setFile(null);
      }
      await api(`marketing/banners/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers,
        body: JSON.stringify(editor.input),
      });
      await load();
      setEditor(null);
      setNotice(true);
    } catch (e) {
      setError(errorKey(e));
    } finally {
      setBusy(false);
    }
  }
  async function action(b: AdminBanner, remove = false) {
    if (busy || (remove && !window.confirm(t("bannerDeleteConfirm")))) return;
    setBusy(true);
    setError(null);
    setNotice(false);
    try {
      await api(
        `marketing/banners/${encodeURIComponent(b.id)}${remove ? "" : `/${b.isActive ? "deactivate" : "activate"}`}`,
        { method: remove ? "DELETE" : "POST", headers },
      );
      await load();
      setNotice(true);
    } catch (e) {
      setError(errorKey(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <AdminFrame csrfToken={csrfToken} preventLogout={busy}>
      <div className="page-heading">
        <div>
          <a className="muted" href="/admin/marketing">
            ← {t("marketing")}
          </a>
          <h1>{t("banners")}</h1>
          <p className="muted">{t("bannersIntro")}</p>
        </div>
        <button
          className="primary"
          disabled={busy || !!editor}
          onClick={() => edit()}
        >
          {t("newBanner")}
        </button>
      </div>
      {error && (
        <p className="error" role="alert">
          {t(error)}{" "}
          <button
            onClick={() => {
              setLoading(true);
              void load()
                .then(() => setError(null))
                .catch((e) => setError(errorKey(e)))
                .finally(() => setLoading(false));
            }}
            disabled={busy}
          >
            {t("retry")}
          </button>
        </p>
      )}
      {notice && (
        <p className="notice" role="status">
          {t("saved")}
        </p>
      )}
      {editor && (
        <section className="editor">
          <h2>{t(editor.id ? "edit" : "newBanner")}</h2>
          <form onSubmit={save}>
            <fieldset disabled={busy}>
              <div className="form-grid">
                {(
                  [
                    "titleRu",
                    "titleUz",
                    "subtitleRu",
                    "subtitleUz",
                    "buttonRu",
                    "buttonUz",
                  ] as const
                ).map((key) => (
                  <label key={key}>
                    {t(key)}
                    <input
                      value={editor.input[key] ?? ""}
                      required={key.startsWith("title")}
                      maxLength={key.startsWith("subtitle") ? 1000 : 200}
                      onChange={(e) =>
                        field(
                          key,
                          e.target.value ||
                            (key.startsWith("title") ? "" : null),
                        )
                      }
                    />
                  </label>
                ))}
                <label>
                  {t("bannerImage")}
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                  />
                  <small>{t("bannerImageHint")}</small>
                </label>
                <label>
                  {t("bannerAction")}
                  <select
                    value={editor.input.targetType}
                    onChange={(e) =>
                      setEditor({
                        ...editor,
                        input: {
                          ...editor.input,
                          targetType: e.target.value as BannerTarget,
                          targetCategoryId: null,
                          targetProductId: null,
                          targetUrl: null,
                        },
                      })
                    }
                  >
                    {Object.entries(targetLabels).map(([value, key]) => (
                      <option value={value} key={value}>
                        {t(key)}
                      </option>
                    ))}
                  </select>
                </label>
                {editor.input.targetType === "CATEGORY" && (
                  <label>
                    {t("category")}
                    <select
                      required
                      value={editor.input.targetCategoryId ?? ""}
                      onChange={(e) =>
                        field("targetCategoryId", e.target.value || null)
                      }
                    >
                      <option value="">—</option>
                      {categories.map((c) => (
                        <option value={c.id} key={c.id}>
                          {locale === "ru" ? c.nameRu : c.nameUz}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                {editor.input.targetType === "PRODUCT" && (
                  <label>
                    {t("products")}
                    <select
                      required
                      value={editor.input.targetProductId ?? ""}
                      onChange={(e) =>
                        field("targetProductId", e.target.value || null)
                      }
                    >
                      <option value="">—</option>
                      {products.map((p) => (
                        <option value={p.id} key={p.id}>
                          {locale === "ru" ? p.nameRu : p.nameUz}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                {editor.input.targetType === "URL" && (
                  <label>
                    {t("bannerUrl")}
                    <input
                      required
                      type="url"
                      pattern="https://.*"
                      value={editor.input.targetUrl ?? ""}
                      onChange={(e) =>
                        field("targetUrl", e.target.value || null)
                      }
                    />
                  </label>
                )}
                <label>
                  {t("order")}
                  <input
                    type="number"
                    min="0"
                    max="2147483647"
                    step="1"
                    required
                    value={editor.input.sortOrder}
                    onChange={(e) => field("sortOrder", Number(e.target.value))}
                  />
                </label>
              </div>
              {editor.imageUrl && (
                <img
                  className="banner-editor-image"
                  src={editor.imageUrl}
                  alt={editor.input.titleRu || editor.input.titleUz}
                />
              )}
              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={editor.input.isActive}
                  onChange={(e) => field("isActive", e.target.checked)}
                />
                {t("active")}
              </label>
              <div className="form-actions">
                <button className="primary">
                  {t(busy ? "saving" : "save")}
                </button>
                <button
                  type="button"
                  className="secondary"
                  onClick={() => setEditor(null)}
                >
                  {t("cancel")}
                </button>
              </div>
            </fieldset>
          </form>
        </section>
      )}
      <section className="list-panel" aria-busy={loading}>
        {loading ? (
          <p className="state" role="status">
            {t("loading")}
          </p>
        ) : banners.length === 0 ? (
          <div className="state">
            <h2>{t("noBanners")}</h2>
            <p className="muted">{t("bannersEmptyHint")}</p>
          </div>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  {[
                    "bannerImage",
                    "titleRu",
                    "titleUz",
                    "bannerAction",
                    "order",
                    "status",
                    "actions",
                  ].map((key) => (
                    <th key={key}>{t(key as MessageKey)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {banners.map((b) => (
                  <tr key={b.id}>
                    <td>
                      {b.imageUrl ? (
                        <img
                          className="banner-thumbnail"
                          src={b.imageUrl}
                          alt={locale === "ru" ? b.titleRu : b.titleUz}
                        />
                      ) : (
                        "—"
                      )}
                    </td>
                    <td>{b.titleRu}</td>
                    <td>{b.titleUz}</td>
                    <td>{t(targetLabels[b.targetType])}</td>
                    <td>{b.sortOrder}</td>
                    <td>
                      <span className={`badge ${b.isActive ? "active" : ""}`}>
                        {t(b.isActive ? "active" : "inactive")}
                      </span>
                    </td>
                    <td>
                      <div className="row-actions">
                        <button
                          disabled={busy || !!editor}
                          onClick={() => edit(b)}
                        >
                          {t("edit")}
                        </button>
                        <button
                          disabled={busy || !!editor}
                          onClick={() => void action(b)}
                        >
                          {t(b.isActive ? "deactivate" : "activate")}
                        </button>
                        <button
                          disabled={busy || !!editor}
                          onClick={() => void action(b, true)}
                        >
                          {t("delete")}
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
    </AdminFrame>
  );
}
