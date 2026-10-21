"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, errorKey } from "../../lib/api";
import { dateTime } from "../../lib/orders";
import type { MessageKey } from "../../lib/i18n";
import { usePreferences } from "../Preferences";
type Note = { id: string; body: string; createdAt: string; createdBy: string };
export function CustomerNotes({
  customerId,
  csrfToken,
}: {
  customerId: string;
  csrfToken: string;
}) {
  const { t, locale } = usePreferences();
  const [body, setBody] = useState(""),
    [notes, setNotes] = useState<Note[]>([]),
    [cursor, setCursor] = useState<string | null>(null),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true),
    [error, setError] = useState<MessageKey | null>(null);
  const lock = useRef(false);
  const load = useCallback(
    async (next?: string, signal?: AbortSignal) => {
      const page = await api<{ notes: Note[]; nextCursor: string | null }>(
        `customers/${encodeURIComponent(customerId)}/notes?limit=20${next ? "&cursor=" + encodeURIComponent(next) : ""}`,
        { signal },
      );
      if (!signal?.aborted) {
        setNotes((rows) =>
          next
            ? [
                ...rows,
                ...page.notes.filter((n) => !rows.some((r) => r.id === n.id)),
              ]
            : page.notes,
        );
        setCursor(page.nextCursor);
      }
    },
    [customerId],
  );
  useEffect(() => {
    const c = new AbortController();
    setLoading(true);
    void load(undefined, c.signal)
      .catch((e) => {
        if (!c.signal.aborted) setError(errorKey(e));
      })
      .finally(() => {
        if (!c.signal.aborted) setLoading(false);
      });
    return () => c.abort();
  }, [load]);
  async function create() {
    if (lock.current || !body.trim()) return;
    lock.current = true;
    setBusy(true);
    setError(null);
    try {
      await api(`customers/${encodeURIComponent(customerId)}/notes`, {
        method: "POST",
        headers: { "x-csrf-token": csrfToken },
        body: JSON.stringify({ body: body.trim() }),
      });
      setBody("");
      await load();
    } catch (e) {
      setError(errorKey(e));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return (
    <section className="editor">
      <h2>{t("customerNotes")}</h2>
      <p className="muted">{t("customerNotesHint")}</p>
      {error && (
        <p role="alert" className="error">
          {t(error)}
        </p>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void create();
        }}
      >
        <label>
          {t("customerNoteBody")}
          <textarea
            value={body}
            maxLength={2000}
            required
            rows={4}
            disabled={busy}
            onChange={(e) => setBody(e.target.value)}
          />
        </label>
        <button className="primary" disabled={busy || !body.trim()}>
          {t("customerNoteAdd")}
        </button>
      </form>
      {loading ? (
        <p role="status">{t("loading")}</p>
      ) : !notes.length ? (
        <p className="muted">{t("customerNotesEmpty")}</p>
      ) : (
        <ol className="customer-notes-list">
          {notes.map((n) => (
            <li key={n.id}>
              <p>{n.body}</p>
              <small className="muted">
                {dateTime(n.createdAt, locale)} ·{" "}
                {t(
                  n.createdBy === "web-admin"
                    ? "customerNoteWebAdmin"
                    : "customerNoteTelegramAdmin",
                )}
              </small>
            </li>
          ))}
        </ol>
      )}
      {cursor && (
        <button
          disabled={busy}
          onClick={() => {
            if (lock.current) return;
            lock.current = true;
            setBusy(true);
            void load(cursor)
              .catch((e) => setError(errorKey(e)))
              .finally(() => {
                lock.current = false;
                setBusy(false);
              });
          }}
        >
          {t("customerNext")}
        </button>
      )}
    </section>
  );
}
