"use client";
import { useState, type FormEvent } from "react";
import {
  normalizeVariantGenerator,
  suggestColorCode,
  VariantGeneratorValidationError,
  type GeneratorColor,
  type VariantPreviewRow,
} from "@stenzo/shared";
import { api, errorKey } from "../../lib/api";
import { integer } from "../../lib/products";
import type { MessageKey } from "../../lib/i18n";
import { usePreferences } from "../Preferences";

export function VariantGenerator({
  productId,
  csrfToken,
  disabled,
  onBusyChange,
  refresh,
  onClose,
}: {
  productId: string;
  csrfToken: string;
  disabled: boolean;
  onBusyChange: (busy: boolean) => void;
  refresh: () => Promise<void>;
  onClose: () => void;
}) {
  const { t } = usePreferences();
  const [draft, setDraft] = useState({
    baseSku: "",
    sizes: "",
    colors: [] as GeneratorColor[],
    stock: "",
    isActive: true,
  });
  const [preview, setPreview] = useState<VariantPreviewRow[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<MessageKey | null>(null);
  const [created, setCreated] = useState<number | null>(null);
  function change(next: typeof draft) {
    setDraft(next);
    setPreview(null);
    setError(null);
    setCreated(null);
  }
  function colorChange(index: number, next: GeneratorColor) {
    change({
      ...draft,
      colors: draft.colors.map((color, i) => (i === index ? next : color)),
    });
  }
  async function request(apply: boolean) {
    if (
      busy ||
      disabled ||
      (apply && (!preview || preview.some((row) => row.status === "CONFLICT")))
    )
      return;
    setError(null);
    setCreated(null);
    try {
      const input = normalizeVariantGenerator({
        ...draft,
        sizes: draft.sizes.split(/[,\r\n]+/).filter((size) => size.trim()),
        stock: draft.stock.trim() ? integer(draft.stock) : null,
      });
      setBusy(true);
      onBusyChange(true);
      const result = await api<{
        rows: VariantPreviewRow[];
        createdCount: number;
      }>(
        `catalog/products/${encodeURIComponent(productId)}/variants/${apply ? "generate" : "generate-preview"}`,
        {
          method: "POST",
          headers: { "x-csrf-token": csrfToken },
          body: JSON.stringify(input),
        },
      );
      if (apply) {
        setPreview(null);
        setCreated(result.createdCount);
        await refresh();
      } else setPreview(result.rows);
    } catch (error) {
      setPreview(null);
      setError(
        error instanceof VariantGeneratorValidationError
          ? error.code
          : error instanceof Error && error.message === "invalidInteger"
            ? "invalidInteger"
            : errorKey(error),
      );
    } finally {
      setBusy(false);
      onBusyChange(false);
    }
  }
  function submit(event: FormEvent) {
    event.preventDefault();
    void request(false);
  }
  return (
    <form onSubmit={submit} aria-busy={busy}>
      <h3>{t("variantGenerator")}</h3>
      <p className="muted">{t("generatorHint")}</p>
      <fieldset disabled={disabled || busy}>
        <div className="form-grid">
          <label>
            {t("baseSku")}
            <input
              required
              maxLength={100}
              placeholder="SW-RISE"
              value={draft.baseSku}
              onChange={(e) => change({ ...draft, baseSku: e.target.value })}
            />
          </label>
          <label>
            {t("generatorSizes")}
            <textarea
              required
              rows={4}
              maxLength={4000}
              placeholder={"S\nM\nL\nXL"}
              value={draft.sizes}
              onChange={(e) => change({ ...draft, sizes: e.target.value })}
            />
          </label>
          <label>
            {t("defaultStock")}
            <input
              inputMode="numeric"
              pattern="[0-9]*"
              value={draft.stock}
              onChange={(e) => change({ ...draft, stock: e.target.value })}
            />
            <span className="muted">{t("generatorStockHint")}</span>
          </label>
        </div>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={draft.isActive}
            onChange={(e) => change({ ...draft, isActive: e.target.checked })}
          />
          {t("variantActive")}
        </label>
        <h4>{t("generatorColors")}</h4>
        <p className="muted">{t("generatorNoColorHint")}</p>
        {draft.colors.map((color, index) => (
          <div key={index} className="form-grid">
            <label>
              {t("color")}
              <input
                required
                maxLength={100}
                value={color.color}
                onChange={(e) => {
                  const suggestion = suggestColorCode(e.target.value);
                  colorChange(index, {
                    color: e.target.value,
                    code: suggestion.code,
                    reviewed: !suggestion.requiresReview,
                  });
                }}
              />
            </label>
            <label>
              {t("colorCode")}
              <input
                required
                maxLength={6}
                pattern="[A-Za-z0-9]{2,6}"
                value={color.code}
                onChange={(e) =>
                  colorChange(index, {
                    ...color,
                    code: e.target.value,
                    reviewed: true,
                  })
                }
              />
            </label>
            {suggestColorCode(color.color).requiresReview && (
              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={color.reviewed === true}
                  onChange={(e) =>
                    colorChange(index, { ...color, reviewed: e.target.checked })
                  }
                />
                {t("colorReviewRequired")}
              </label>
            )}
            <button
              type="button"
              className="quiet"
              onClick={() =>
                change({
                  ...draft,
                  colors: draft.colors.filter((_, i) => i !== index),
                })
              }
            >
              {t("generatorRemoveColor")}
            </button>
          </div>
        ))}
        <button
          type="button"
          className="secondary"
          disabled={draft.colors.length >= 20}
          onClick={() =>
            change({
              ...draft,
              colors: [
                ...draft.colors,
                { color: "", code: "", reviewed: false },
              ],
            })
          }
        >
          {t("generatorAddColor")}
        </button>
      </fieldset>
      {error && (
        <p className="error" role="alert">
          {t(error)}
        </p>
      )}
      {created !== null && (
        <p className="notice" role="status">
          {created === 0
            ? t("noNewVariants")
            : t("generatedCount").replace("{count}", String(created))}
        </p>
      )}
      {preview && (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>{t("size")}</th>
                <th>{t("color")}</th>
                <th>{t("sku")}</th>
                <th>{t("status")}</th>
              </tr>
            </thead>
            <tbody>
              {preview.map((row) => (
                <tr key={row.sku}>
                  <td>{row.size}</td>
                  <td>{row.color ?? "—"}</td>
                  <td>
                    <code>{row.sku}</code>
                    {row.existingSku && row.existingSku !== row.sku && (
                      <p className="muted">
                        {t("generatorExistingSku")}:{" "}
                        <code>{row.existingSku}</code>
                      </p>
                    )}
                  </td>
                  <td>
                    {t(
                      row.status === "NEW"
                        ? "newVariantStatus"
                        : row.status === "EXISTS"
                          ? "existingVariantStatus"
                          : "skuConflict",
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="form-actions">
        <button className="secondary" disabled={disabled || busy}>
          {t(busy ? "saving" : "generatorPreview")}
        </button>
        <button
          type="button"
          className="primary"
          disabled={
            disabled ||
            busy ||
            !preview ||
            preview.some((row) => row.status === "CONFLICT")
          }
          onClick={() => void request(true)}
        >
          {t("generatorApply")}
        </button>
        <button
          type="button"
          className="quiet"
          disabled={disabled || busy}
          onClick={onClose}
        >
          {t("cancel")}
        </button>
      </div>
    </form>
  );
}
