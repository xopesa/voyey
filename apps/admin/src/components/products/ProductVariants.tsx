"use client";
import { useEffect, useState, type FormEvent } from "react";
import { usePreferences } from "../Preferences";
import { api, errorKey } from "../../lib/api";
import { integer, type ProductVariant } from "../../lib/products";
import type { MessageKey } from "../../lib/i18n";
import { VariantGenerator } from "./VariantGenerator";

const empty = { size: "", color: "", sku: "", stock: "", isActive: true };
export function ProductVariants({
  productId,
  variants,
  csrfToken,
  disabled,
  onBusyChange,
  onDirtyChange,
  refresh,
}: {
  productId: string;
  variants: ProductVariant[];
  csrfToken: string;
  disabled: boolean;
  onBusyChange: (busy: boolean) => void;
  onDirtyChange: (dirty: boolean) => void;
  refresh: () => Promise<void>;
}) {
  const { t } = usePreferences();
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const [draft, setDraft] = useState(empty);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<MessageKey | null>(null);
  const [notice, setNotice] = useState(false);
  const [generator, setGenerator] = useState(false);
  useEffect(() => {
    onDirtyChange(editing !== null || generator);
  }, [editing, generator, onDirtyChange]);
  async function save(event: FormEvent) {
    event.preventDefault();
    if (!editing || busy || disabled) return;
    setError(null);
    setNotice(false);
    try {
      const stock = draft.stock.trim() ? integer(draft.stock) : null;
      if (!draft.sku.trim() || !draft.size.trim()) {
        setError("invalid");
        return;
      }
      setBusy(true);
      onBusyChange(true);
      const result = await api<{ variant: ProductVariant }>(
        editing === "new"
          ? `catalog/products/${productId}/variants`
          : `catalog/variants/${editing}`,
        {
          method: editing === "new" ? "POST" : "PATCH",
          headers: { "x-csrf-token": csrfToken },
          body: JSON.stringify({
            ...draft,
            sku: draft.sku.trim(),
            size: draft.size.trim(),
            color: draft.color.trim() || null,
            stock,
          }),
        },
      );
      // Close a successfully persisted form before refreshing, preventing accidental duplicate SKU retries.
      setEditing(null);
      setDraft(empty);
      setNotice(true);
      void result;
      await refresh();
    } catch (error) {
      setError(
        error instanceof Error && error.message === "invalidInteger"
          ? "invalidInteger"
          : errorKey(error),
      );
    } finally {
      setBusy(false);
      onBusyChange(false);
    }
  }
  async function toggle(variant: ProductVariant) {
    setBusy(true);
    onBusyChange(true);
    setError(null);
    setNotice(false);
    try {
      await api(
        `catalog/variants/${variant.id}/${variant.isActive ? "deactivate" : "activate"}`,
        { method: "POST", headers: { "x-csrf-token": csrfToken } },
      );
      await refresh();
    } catch (error) {
      setError(errorKey(error));
    } finally {
      setBusy(false);
      onBusyChange(false);
    }
  }
  return (
    <section className="editor" aria-labelledby="variants-title">
      <div className="section-heading">
        <div>
          <h2 id="variants-title">{t("variants")}</h2>
          <p className="muted">{t("variantsHint")}</p>
        </div>
        <div className="row-actions">
          <button
            className="secondary"
            disabled={disabled || busy || editing !== null || generator}
            onClick={() => {
              setGenerator(true);
              setNotice(false);
              setError(null);
            }}
          >
            {t("generateVariants")}
          </button>
          <button
            className="secondary"
            disabled={disabled || busy || editing !== null || generator}
            onClick={() => {
              setEditing("new");
              setDraft(empty);
              setError(null);
            }}
          >
            {t("addVariant")}
          </button>
        </div>
      </div>
      {generator && (
        <VariantGenerator
          productId={productId}
          csrfToken={csrfToken}
          disabled={disabled || busy}
          onBusyChange={onBusyChange}
          refresh={refresh}
          onClose={() => setGenerator(false)}
        />
      )}
      {error && (
        <p className="error" role="alert">
          {t(error)}{" "}
          <button
            className="quiet"
            disabled={busy || disabled}
            onClick={() =>
              refresh().catch((error) => setError(errorKey(error)))
            }
          >
            {t("retry")}
          </button>
        </p>
      )}
      {notice && (
        <p className="notice" role="status">
          {t("variantSaved")}
        </p>
      )}
      {editing && (
        <form onSubmit={save} aria-busy={busy}>
          <fieldset disabled={disabled || busy}>
            <h3>{t(editing === "new" ? "newVariant" : "edit")}</h3>
            <div className="form-grid">
              <label>
                {t("size")}
                <input
                  value={draft.size}
                  list="size-options"
                  required
                  maxLength={50}
                  onChange={(event) =>
                    setDraft({ ...draft, size: event.target.value })
                  }
                />
                <datalist id="size-options">
                  {["S", "M", "L", "XL", "XXL"].map((size) => (
                    <option value={size} key={size} />
                  ))}
                </datalist>
              </label>
              <label>
                {t("color")}
                <input
                  value={draft.color}
                  maxLength={100}
                  onChange={(event) =>
                    setDraft({ ...draft, color: event.target.value })
                  }
                />
              </label>
              <label>
                {t("sku")}
                <input
                  value={draft.sku}
                  required
                  maxLength={100}
                  onChange={(event) =>
                    setDraft({ ...draft, sku: event.target.value })
                  }
                />
              </label>
              <label>
                {t("stock")}
                <input
                  inputMode="numeric"
                  pattern="[0-9]*"
                  value={draft.stock}
                  onChange={(event) =>
                    setDraft({ ...draft, stock: event.target.value })
                  }
                />
              </label>
            </div>
            <label className="checkbox">
              <input
                type="checkbox"
                checked={draft.isActive}
                onChange={(event) =>
                  setDraft({ ...draft, isActive: event.target.checked })
                }
              />
              {t("variantActive")}
            </label>
          </fieldset>
          <div className="form-actions">
            <button className="primary" disabled={disabled || busy}>
              {t(busy ? "saving" : "save")}
            </button>
            <button
              className="secondary"
              type="button"
              disabled={disabled || busy}
              onClick={() => {
                setEditing(null);
                setDraft(empty);
                setError(null);
              }}
            >
              {t("cancel")}
            </button>
          </div>
        </form>
      )}
      {variants.length === 0 ? (
        <p className="muted section-empty">{t("noVariants")}</p>
      ) : (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>{t("size")}</th>
                <th>{t("color")}</th>
                <th>{t("sku")}</th>
                <th>{t("stock")}</th>
                <th>{t("status")}</th>
                <th>{t("actions")}</th>
              </tr>
            </thead>
            <tbody>
              {variants.map((variant) => (
                <tr key={variant.id}>
                  <td>{variant.size}</td>
                  <td>{variant.color ?? "—"}</td>
                  <td>
                    <code>{variant.sku}</code>
                  </td>
                  <td>{variant.stock ?? "∞"}</td>
                  <td>
                    {t(variant.isActive ? "productActive" : "productInactive")}
                  </td>
                  <td>
                    <div className="row-actions">
                      <button
                        className="secondary"
                        disabled={
                          disabled || busy || editing !== null || generator
                        }
                        onClick={() => {
                          setEditing(variant.id);
                          setDraft({
                            size: variant.size,
                            color: variant.color ?? "",
                            sku: variant.sku,
                            stock:
                              variant.stock === null
                                ? ""
                                : String(variant.stock),
                            isActive: variant.isActive,
                          });
                          setError(null);
                        }}
                      >
                        {t("edit")}
                      </button>
                      <button
                        className="quiet"
                        disabled={
                          disabled || busy || editing !== null || generator
                        }
                        onClick={() => toggle(variant)}
                      >
                        {t(variant.isActive ? "deactivate" : "activate")}
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
  );
}
