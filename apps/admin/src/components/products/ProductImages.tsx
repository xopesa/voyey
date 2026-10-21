"use client";
import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { usePreferences } from "../Preferences";
import { api, errorKey } from "../../lib/api";
import { integer, safeImageUrl, type ProductImage } from "../../lib/products";
import type { MessageKey } from "../../lib/i18n";

type Pending = {
  id: string;
  file: File;
  url: string;
  error: MessageKey | null;
};
export function ProductImages({
  productId,
  images,
  csrfToken,
  maxBytes,
  disabled,
  onBusyChange,
  onDirtyChange,
  refresh,
}: {
  productId: string;
  images: ProductImage[];
  csrfToken: string;
  maxBytes: number;
  disabled: boolean;
  onBusyChange: (busy: boolean) => void;
  onDirtyChange: (dirty: boolean) => void;
  refresh: () => Promise<void>;
}) {
  const { t } = usePreferences();
  const [pending, setPending] = useState<Pending[]>([]);
  const [orders, setOrders] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState<MessageKey | null>(null);
  const urls = useRef(new Set<string>());
  const orderDirty = images.some(
    (image) =>
      orders[image.id] !== undefined &&
      orders[image.id] !== String(image.sortOrder),
  );
  useEffect(() => {
    onDirtyChange(pending.length > 0 || orderDirty);
  }, [pending.length, orderDirty, onDirtyChange]);
  useEffect(() => {
    const active = urls.current;
    return () => {
      for (const url of active) URL.revokeObjectURL(url);
    };
  }, []);
  const headers = { "x-csrf-token": csrfToken };
  function removePending(id: string) {
    setPending((previous) =>
      previous.filter((item) => {
        if (item.id !== id) return true;
        URL.revokeObjectURL(item.url);
        urls.current.delete(item.url);
        return false;
      }),
    );
  }
  function choose(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    const next = files.map((file) => {
      const error: MessageKey | null =
        file.size > maxBytes
          ? "imageTooLarge"
          : !["image/jpeg", "image/png", "image/webp"].includes(file.type)
            ? "imageType"
            : null;
      const url = !error ? URL.createObjectURL(file) : "";
      if (url) urls.current.add(url);
      return { id: crypto.randomUUID(), file, url, error };
    });
    setPending((previous) => [...previous, ...next]);
    event.target.value = "";
  }
  async function upload() {
    if (busy || disabled) return;
    setBusy(true);
    onBusyChange(true);
    setError(null);
    const files = pending.filter(
      (item) =>
        !item.error ||
        (item.error !== "imageType" && item.error !== "imageTooLarge"),
    );
    let order =
      images.reduce((max, image) => Math.max(max, image.sortOrder), -1) + 1;
    try {
      for (let index = 0; index < files.length; index++) {
        const item = files[index]!;
        setProgress(`${index + 1} / ${files.length}`);
        const data = new FormData();
        data.append("file", item.file);
        try {
          await api(
            `catalog/products/${productId}/images/upload?sortOrder=${order++}`,
            { method: "POST", headers, body: data },
          );
          removePending(item.id);
        } catch (error) {
          setPending((previous) =>
            previous.map((old) =>
              old.id === item.id ? { ...old, error: errorKey(error) } : old,
            ),
          );
        }
      }
      await refresh();
    } catch (error) {
      setError(errorKey(error));
    } finally {
      setBusy(false);
      onBusyChange(false);
      setProgress("");
    }
  }
  async function mutate(
    image: ProductImage,
    operation: "primary" | "order" | "delete",
  ) {
    if (busy || disabled) return;
    if (operation === "delete" && !window.confirm(t("removePhoto"))) return;
    setError(null);
    try {
      const input =
        operation === "primary"
          ? { isPrimary: true }
          : operation === "order"
            ? {
                sortOrder: integer(orders[image.id] ?? String(image.sortOrder)),
              }
            : undefined;
      setBusy(true);
      onBusyChange(true);
      await api(`catalog/images/${image.id}`, {
        method: operation === "delete" ? "DELETE" : "PATCH",
        headers,
        ...(input ? { body: JSON.stringify(input) } : {}),
      });
      if (operation !== "primary") {
        setOrders((previous) => {
          const next = { ...previous };
          delete next[image.id];
          return next;
        });
      }
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
  return (
    <section className="editor" aria-labelledby="photos-title">
      <div className="section-heading">
        <div>
          <h2 id="photos-title">{t("photos")}</h2>
          <p className="muted">{t("photosHint")}</p>
          <small>
            {t("uploadLimit")}: {Math.round((maxBytes / 1024 / 1024) * 10) / 10}{" "}
            MB
          </small>
        </div>
        <label className="button secondary file-button">
          {t("choosePhotos")}
          <input
            className="sr-only"
            type="file"
            accept="image/jpeg,image/png,image/webp"
            multiple
            disabled={disabled || busy}
            onChange={choose}
          />
        </label>
      </div>
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
      {images.length === 0 && pending.length === 0 && (
        <p className="muted section-empty">{t("noPhotos")}</p>
      )}
      <div className="image-grid">
        {[...images]
          .sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id))
          .map((image) => (
            <article className="image-card" key={image.id}>
              {safeImageUrl(image.url) && (
                <img
                  src={safeImageUrl(image.url)}
                  alt={t("photos")}
                  loading="lazy"
                />
              )}
              <div className="image-card-body">
                {image.isPrimary ? (
                  <span className="badge active">{t("primaryImage")}</span>
                ) : (
                  <button
                    className="secondary"
                    disabled={disabled || busy}
                    onClick={() => mutate(image, "primary")}
                  >
                    {t("makePrimary")}
                  </button>
                )}
                <label>
                  {t("photoOrder")}
                  <input
                    inputMode="numeric"
                    pattern="[0-9]+"
                    value={orders[image.id] ?? String(image.sortOrder)}
                    disabled={disabled || busy}
                    onChange={(event) =>
                      setOrders({ ...orders, [image.id]: event.target.value })
                    }
                  />
                </label>
                <div className="row-actions">
                  <button
                    className="secondary"
                    disabled={
                      disabled ||
                      busy ||
                      orders[image.id] === undefined ||
                      orders[image.id] === String(image.sortOrder)
                    }
                    onClick={() => mutate(image, "order")}
                  >
                    {t("save")}
                  </button>
                  <button
                    className="quiet"
                    disabled={disabled || busy}
                    onClick={() => mutate(image, "delete")}
                  >
                    {t("remove")}
                  </button>
                </div>
              </div>
            </article>
          ))}
        {pending.map((item) => (
          <article className="image-card pending-image" key={item.id}>
            {item.url && <img src={item.url} alt={item.file.name} />}
            <div className="image-card-body">
              <span className="file-name">{item.file.name}</span>
              <p
                className={item.error ? "error-text" : "muted"}
                role={item.error ? "alert" : undefined}
              >
                {t(item.error ?? "queued")}
              </p>
              <button
                className="quiet"
                disabled={disabled || busy}
                onClick={() => removePending(item.id)}
              >
                {t("remove")}
              </button>
            </div>
          </article>
        ))}
      </div>
      {pending.length > 0 && (
        <div className="form-actions">
          <button
            className="primary"
            onClick={upload}
            disabled={
              disabled ||
              busy ||
              pending.every(
                (item) =>
                  item.error === "imageTooLarge" || item.error === "imageType",
              )
            }
          >
            {t(busy ? "uploading" : "uploadPhotos")} {progress}
          </button>
        </div>
      )}
      {busy && (
        <p className="muted" role="status">
          {t("working")} {progress}
        </p>
      )}
    </section>
  );
}
