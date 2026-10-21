"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  fromTashkentInput,
  toTashkentInput,
  type AdminPromoCode,
  type PromoCodeInput,
} from "@stenzo/shared";
import { AdminFrame } from "../AdminFrame";
import { usePreferences } from "../Preferences";
import { api, errorKey } from "../../lib/api";
import type { MessageKey } from "../../lib/i18n";
import "../../styles/marketing.css";

type Draft = {
  code: string;
  type: "PERCENT" | "FIXED";
  value: string;
  minOrderAmount: string;
  maxDiscount: string;
  startsAt: string;
  endsAt: string;
  usageLimit: string;
  perUserLimit: string;
  isActive: boolean;
};
const empty: Draft = {
  code: "",
  type: "PERCENT",
  value: "",
  minOrderAmount: "",
  maxDiscount: "",
  startsAt: "",
  endsAt: "",
  usageLimit: "",
  perUserLimit: "1",
  isActive: false,
};
export function promoDraft(p: AdminPromoCode): Draft {
  const text = (n: number | null) => (n == null ? "" : String(n));
  return {
    code: p.code,
    type: p.type,
    value: text(p.value),
    minOrderAmount: text(p.minOrderAmount),
    maxDiscount: text(p.maxDiscount),
    usageLimit: text(p.usageLimit),
    perUserLimit: text(p.perUserLimit),
    isActive: p.isActive,
    startsAt: toTashkentInput(p.startsAt),
    endsAt: toTashkentInput(p.endsAt),
  };
}
export function promoInput(d: Draft): PromoCodeInput {
  const n = (v: string, required = false) => {
    if (!v && !required) return null;
    if (!/^\d+$/.test(v) || Number(v) < 1 || Number(v) > 2147483647)
      throw Error("promoInvalidSettings");
    return Number(v);
  };
  return {
    code: d.code.trim().toUpperCase(),
    type: d.type,
    value: n(d.value, true)!,
    minOrderAmount: n(d.minOrderAmount),
    maxDiscount: d.type === "PERCENT" ? n(d.maxDiscount) : null,
    startsAt: fromTashkentInput(d.startsAt),
    endsAt: fromTashkentInput(d.endsAt),
    usageLimit: n(d.usageLimit),
    perUserLimit: n(d.perUserLimit, true)!,
    isActive: d.isActive,
  };
}
export function promoState(p: AdminPromoCode, now = Date.now()) {
  if (!p.isActive) return "promoInactive";
  if (p.startsAt && Date.parse(p.startsAt) > now) return "promoScheduled";
  if (p.endsAt && Date.parse(p.endsAt) <= now) return "promoExpired";
  if (p.usageLimit != null && p.usageCount >= p.usageLimit)
    return "promoExhausted";
  return "promoActive";
}
export function PromoCodeManager({ csrfToken }: { csrfToken: string }) {
  const { t, locale } = usePreferences();
  const [rows, setRows] = useState<AdminPromoCode[]>([]);
  const [editor, setEditor] = useState<{ id?: string; draft: Draft } | null>(
    null,
  );
  const [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false);
  const [error, setError] = useState<MessageKey | null>(null),
    [notice, setNotice] = useState(false);
  const lock = useRef(false);
  const load = async (signal?: AbortSignal) =>
    setRows(
      (
        await api<{ promoCodes: AdminPromoCode[] }>("marketing/promo-codes", {
          signal,
        })
      ).promoCodes,
    );
  useEffect(() => {
    const c = new AbortController();
    void load(c.signal)
      .catch((e) => {
        if (!c.signal.aborted) setError(errorKey(e));
      })
      .finally(() => {
        if (!c.signal.aborted) setLoading(false);
      });
    return () => c.abort();
  }, []);
  async function perform(action: () => Promise<unknown>) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError(null);
    setNotice(false);
    try {
      await action();
      await load();
      setNotice(true);
    } catch (e) {
      setError(
        e instanceof Error && e.message === "promoInvalidSettings"
          ? "promoInvalidSettings"
          : errorKey(e),
      );
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  const headers = { "x-csrf-token": csrfToken };
  function save(e: FormEvent) {
    e.preventDefault();
    if (!editor) return;
    void perform(async () => {
      await api(`marketing/promo-codes${editor.id ? "/" + editor.id : ""}`, {
        method: editor.id ? "PATCH" : "POST",
        headers,
        body: JSON.stringify(promoInput(editor.draft)),
      });
      setEditor(null);
    });
  }
  const field = (key: keyof Draft, value: string | boolean) =>
    setEditor((e) => (e ? { ...e, draft: { ...e.draft, [key]: value } } : e));
  const period = (v: string | null) =>
    v
      ? new Intl.DateTimeFormat(locale === "ru" ? "ru-RU" : "uz-UZ", {
          timeZone: "Asia/Tashkent",
          dateStyle: "short",
          timeStyle: "short",
        }).format(new Date(v))
      : "—";
  return (
    <AdminFrame csrfToken={csrfToken} preventLogout={busy}>
      <div className="page-heading">
        <div>
          <a className="muted" href="/admin/marketing">
            ← {t("marketing")}
          </a>
          <h1>{t("promoCodes")}</h1>
          <p className="muted">{t("promoIntro")}</p>
        </div>
        <button
          className="primary"
          disabled={busy || !!editor}
          onClick={() => {
            setEditor({ draft: { ...empty } });
            setNotice(false);
          }}
        >
          {t("newPromo")}
        </button>
      </div>
      {error && (
        <p role="alert" className="error">
          {t(error)}{" "}
          <button
            className="quiet"
            disabled={busy}
            onClick={() => void perform(() => load())}
          >
            {t("retry")}
          </button>
        </p>
      )}
      {notice && (
        <p role="status" className="notice">
          {t("actionSaved")}
        </p>
      )}
      {editor && (
        <form className="editor" onSubmit={save}>
          <h2>{t(editor.id ? "edit" : "newPromo")}</h2>
          <fieldset disabled={busy} className="form-grid">
            <label>
              {t("promoCode")}
              <input
                required
                value={editor.draft.code}
                maxLength={32}
                pattern="[A-Za-z0-9]+(-[A-Za-z0-9]+)*"
                minLength={3}
                onChange={(e) => field("code", e.target.value)}
                autoComplete="off"
              />
            </label>
            <label>
              {t("promoType")}
              <select
                value={editor.draft.type}
                onChange={(e) => field("type", e.target.value)}
              >
                <option value="PERCENT">{t("promoPercent")}</option>
                <option value="FIXED">{t("promoFixed")}</option>
              </select>
            </label>
            {(
              [
                "value",
                "minOrderAmount",
                ...(editor.draft.type === "PERCENT"
                  ? ["maxDiscount" as const]
                  : []),
                "usageLimit",
                "perUserLimit",
              ] as const
            ).map((key) => (
              <label key={key}>
                {t(`promo_${key}`)}
                <input
                  type="number"
                  min={1}
                  step={1}
                  max={
                    key === "value" && editor.draft.type === "PERCENT"
                      ? 90
                      : 2147483647
                  }
                  required={key === "value" || key === "perUserLimit"}
                  value={editor.draft[key]}
                  onChange={(e) => field(key, e.target.value)}
                />
              </label>
            ))}
            <label>
              {t("saleStartsAt")}
              <input
                type="datetime-local"
                value={editor.draft.startsAt}
                onChange={(e) => field("startsAt", e.target.value)}
              />
            </label>
            <label>
              {t("saleEndsAt")}
              <input
                type="datetime-local"
                value={editor.draft.endsAt}
                onChange={(e) => field("endsAt", e.target.value)}
              />
            </label>
            <label className="checkbox">
              <input
                type="checkbox"
                checked={editor.draft.isActive}
                onChange={(e) => field("isActive", e.target.checked)}
              />
              {t("promoActive")}
            </label>
          </fieldset>
          <p className="muted">{t("promoTimezone")}</p>
          <div className="button-row">
            <button className="primary" disabled={busy}>
              {t("save")}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => setEditor(null)}
            >
              {t("cancel")}
            </button>
          </div>
        </form>
      )}
      {loading ? (
        <p role="status">{t("loading")}</p>
      ) : rows.length === 0 ? (
        <section className="empty-state editor">
          <h2>{t("promoEmpty")}</h2>
          <p>{t("promoIntro")}</p>
        </section>
      ) : (
        <div className="list-panel">
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  {[
                    "promoCode",
                    "promoType",
                    "promo_value",
                    "promoPeriod",
                    "promoUsage",
                    "promo_usageLimit",
                    "status",
                    "actions",
                  ].map((k) => (
                    <th key={k}>{t(k as MessageKey)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((p) => (
                  <tr key={p.id}>
                    <td>
                      <strong>{p.code}</strong>
                    </td>
                    <td>
                      {t(p.type === "PERCENT" ? "promoPercent" : "promoFixed")}
                    </td>
                    <td>
                      {p.value.toLocaleString(locale)}
                      {p.type === "PERCENT" ? "%" : " UZS"}
                    </td>
                    <td>
                      {period(p.startsAt)} — {period(p.endsAt)}
                    </td>
                    <td>{p.usageCount}</td>
                    <td>
                      {p.usageLimit ?? "∞"} · {t("promo_perUserLimit")}:{" "}
                      {p.perUserLimit}
                    </td>
                    <td>
                      <span
                        className={`badge ${promoState(p) === "promoActive" ? "active" : ""}`}
                      >
                        {t(promoState(p))}
                      </span>
                    </td>
                    <td>
                      <div className="button-row">
                        <button
                          disabled={busy || !!editor}
                          onClick={() => {
                            setEditor({ id: p.id, draft: promoDraft(p) });
                            setNotice(false);
                          }}
                        >
                          {t("edit")}
                        </button>
                        <button
                          disabled={busy || !!editor}
                          onClick={() =>
                            void perform(() =>
                              api(
                                `marketing/promo-codes/${p.id}/${p.isActive ? "deactivate" : "activate"}`,
                                { method: "POST", headers },
                              ),
                            )
                          }
                        >
                          {t(p.isActive ? "deactivate" : "activate")}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </AdminFrame>
  );
}
