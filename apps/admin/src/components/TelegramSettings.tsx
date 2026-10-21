"use client";
import { useEffect, useState, type FormEvent } from "react";
import { validTelegramAdminId, type TelegramAdminDto } from "@stenzo/shared";
import { AdminFrame } from "./AdminFrame";
import { usePreferences } from "./Preferences";
import { api, ApiError, errorKey } from "../lib/api";
import type { MessageKey } from "../lib/i18n";

export function TelegramSettings({ csrfToken }: { csrfToken: string }) {
  const { t } = usePreferences();
  const [rows, setRows] = useState<TelegramAdminDto[]>([]);
  const [telegramId, setTelegramId] = useState("");
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<MessageKey | null>(null);
  useEffect(() => {
    let live = true;
    api<{ admins: TelegramAdminDto[] }>("telegram/admins")
      .then((data) => {
        if (live) setRows(data.admins);
      })
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
  async function add(event: FormEvent) {
    event.preventDefault();
    if (!validTelegramAdminId(telegramId)) {
      setError("telegramInvalid");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const row = await api<TelegramAdminDto>("telegram/admins", {
        method: "POST",
        headers: { "x-csrf-token": csrfToken },
        body: JSON.stringify({ telegramId, label: label.trim() || null }),
      });
      setRows((current) => [...current, row]);
      setTelegramId("");
      setLabel("");
    } catch (e) {
      setError(
        e instanceof ApiError && e.status === 409
          ? "telegramDuplicate"
          : errorKey(e),
      );
    } finally {
      setBusy(false);
    }
  }
  async function patch(
    row: TelegramAdminDto,
    input: Partial<
      Pick<
        TelegramAdminDto,
        "label" | "isActive" | "notifyNewOrders" | "notifyPayments"
      >
    >,
  ) {
    if (
      input.isActive === false &&
      !window.confirm(t("telegramDisableConfirm"))
    )
      return;
    setBusy(true);
    setError(null);
    try {
      const updated = await api<TelegramAdminDto>(
        `telegram/admins/${encodeURIComponent(row.id)}`,
        {
          method: "PATCH",
          headers: { "x-csrf-token": csrfToken },
          body: JSON.stringify(input),
        },
      );
      setRows((current) =>
        current.map((value) => (value.id === updated.id ? updated : value)),
      );
    } catch (e) {
      setError(errorKey(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <AdminFrame csrfToken={csrfToken}>
      <div className="page-heading">
        <div>
          <p className="eyebrow">STENZO ADMIN</p>
          <h1>{t("telegram")}</h1>
          <p className="muted">{t("telegramIntro")}</p>
        </div>
      </div>
      {error && (
        <p role="alert" className="error">
          {t(error)}
        </p>
      )}
      <form onSubmit={add} className="editor telegram-settings">
        <label>
          {t("telegramId")}
          <input
            required
            inputMode="numeric"
            autoComplete="off"
            value={telegramId}
            maxLength={16}
            onChange={(e) => setTelegramId(e.target.value)}
            disabled={busy}
          />
        </label>
        <label>
          {t("telegramLabel")}
          <input
            value={label}
            maxLength={100}
            onChange={(e) => setLabel(e.target.value)}
            disabled={busy}
          />
        </label>
        <button className="primary" type="submit" disabled={busy || loading}>
          {t("telegramAdd")}
        </button>
      </form>
      {loading ? (
        <p role="status">STENZO…</p>
      ) : rows.length === 0 ? (
        <p>{t("telegramEmpty")}</p>
      ) : (
        rows.map((row) => (
          <section
            className="editor telegram-settings"
            key={row.id}
            aria-label={`${t("telegramId")} ${row.telegramId}`}
          >
            <h2>{row.label || row.telegramId}</h2>
            <p>
              {t("telegramId")}: <strong>{row.telegramId}</strong>
            </p>
            <p>
              {row.user
                ? [
                    row.user.firstName,
                    row.user.lastName,
                    row.user.username ? `@${row.user.username}` : null,
                    row.user.preferredLocale.toUpperCase(),
                  ]
                    .filter(Boolean)
                    .join(" · ")
                : t("telegramUnlinked")}
            </p>
            <LabelEditor
              row={row}
              busy={busy}
              save={(label) => void patch(row, { label })}
            />
            <p>
              {t("telegramCreated")}: {new Date(row.createdAt).toLocaleString()}
            </p>
            <p>{t(row.isActive ? "telegramActive" : "telegramInactive")}</p>
            <label className="checkbox">
              <input
                type="checkbox"
                checked={row.notifyNewOrders}
                disabled={busy}
                onChange={(e) =>
                  void patch(row, { notifyNewOrders: e.target.checked })
                }
              />
              {t("telegramNewOrders")}
            </label>
            <label className="checkbox">
              <input
                type="checkbox"
                checked={row.notifyPayments}
                disabled={busy}
                onChange={(e) =>
                  void patch(row, { notifyPayments: e.target.checked })
                }
              />
              {t("telegramPayments")}
            </label>
            <button
              type="button"
              disabled={busy}
              onClick={() => void patch(row, { isActive: !row.isActive })}
            >
              {t(row.isActive ? "telegramDisable" : "telegramEnable")}
            </button>
          </section>
        ))
      )}
    </AdminFrame>
  );
}

function LabelEditor({
  row,
  busy,
  save,
}: {
  row: TelegramAdminDto;
  busy: boolean;
  save: (label: string | null) => void;
}) {
  const { t } = usePreferences();
  const [value, setValue] = useState(row.label ?? "");
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        save(value.trim() || null);
      }}
    >
      <label>
        {t("telegramLabel")}
        <input
          value={value}
          maxLength={100}
          disabled={busy}
          onChange={(e) => setValue(e.target.value)}
        />
      </label>
      <button disabled={busy || value === (row.label ?? "")}>
        {t("telegramSaveLabel")}
      </button>
    </form>
  );
}
