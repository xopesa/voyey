"use client";
import { useEffect, useState } from "react";
import { api, errorKey } from "../../lib/api";
import { usePreferences } from "../Preferences";
import {
  channelErrorKeys,
  channelStatusKeys,
  type ChannelPublication,
} from "../../lib/telegram-channel";
import type { MessageKey } from "../../lib/i18n";

export function TelegramChannel({
  publishToChannel,
  onPublishToChannelChange,
  productId,
  active,
  initial,
  revision,
  csrfToken,
  disabled,
  choiceDisabled,
  onBusyChange,
}: {
  publishToChannel: boolean;
  onPublishToChannelChange: (enabled: boolean) => void;
  productId: string;
  active: boolean;
  initial?: ChannelPublication;
  revision: object;
  csrfToken: string;
  disabled: boolean;
  choiceDisabled?: boolean;
  onBusyChange: (busy: boolean) => void;
}) {
  const { t, locale } = usePreferences();
  const [publication, setPublication] = useState<ChannelPublication>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<MessageKey>();
  useEffect(() => {
    const controller = new AbortController();
    setError(undefined);
    if (initial) {
      setPublication(initial);
      return;
    }
    setPublication(undefined);
    api<{ publication: ChannelPublication }>(
      `catalog/products/${encodeURIComponent(productId)}/telegram`,
      { signal: controller.signal },
    )
      .then((result) => {
        if (!controller.signal.aborted) setPublication(result.publication);
      })
      .catch((error) => {
        if (!controller.signal.aborted) setError(errorKey(error));
      });
    return () => controller.abort();
  }, [productId, initial, revision]);
  async function publish() {
    if (
      !publishToChannel ||
      busy ||
      disabled ||
      !active ||
      !publication?.retryAllowed
    )
      return;
    setBusy(true);
    onBusyChange(true);
    setError(undefined);
    try {
      const result = await api<{ publication: ChannelPublication }>(
        `catalog/products/${encodeURIComponent(productId)}/telegram/publish`,
        { method: "POST", headers: { "x-csrf-token": csrfToken } },
      );
      setPublication(result.publication);
    } catch (error) {
      setError(errorKey(error));
    } finally {
      setBusy(false);
      onBusyChange(false);
    }
  }
  return (
    <section className="editor" aria-busy={busy}>
      <h2>{t("channelTitle")}</h2>
      <label className="channel-publication-choice">
        <input
          type="checkbox"
          checked={publishToChannel}
          disabled={(choiceDisabled ?? disabled) || busy}
          onChange={(event) => onPublishToChannelChange(event.target.checked)}
        />
        {t("channelAlsoPublish")}
      </label>
      <p className="muted">{t("channelPublicationChoiceHint")}</p>
      <p role="status">
        {t(
          busy
            ? "channelPending"
            : publication
              ? channelStatusKeys[publication.status]
              : "loading",
        )}
      </p>
      {publication?.publishedAt && (
        <p className="muted">
          {new Date(publication.publishedAt).toLocaleString(
            locale === "uz" ? "uz-UZ" : "ru-RU",
          )}
        </p>
      )}
      {publication?.errorCode && (
        <p className="error" role="alert">
          {t(channelErrorKeys[publication.errorCode] ?? "channelUnavailable")}
        </p>
      )}
      {error && (
        <p className="error" role="alert">
          {t(error)}
        </p>
      )}
      <button
        type="button"
        className="secondary"
        disabled={
          !publishToChannel ||
          disabled ||
          busy ||
          !active ||
          !publication?.retryAllowed ||
          publication.status === "PUBLISHED" ||
          publication.status === "PENDING"
        }
        onClick={publish}
      >
        {t(
          publication?.status === "PUBLISHED"
            ? "channelPublished"
            : publication?.status === "FAILED"
              ? "channelRetry"
              : "channelPublish",
        )}
      </button>
    </section>
  );
}
