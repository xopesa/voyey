"use client";
import { useEffect, useRef, useState } from "react";
import type { AdminExpense, ExpensePage } from "@stenzo/shared";
import { AdminFrame } from "../AdminFrame";
import { usePreferences } from "../Preferences";
import { api, errorKey } from "../../lib/api";
import { uzs, dateTime } from "../../lib/orders";
import {
  expenseCategories,
  expenseDraft,
  expensePayload,
} from "../../lib/finance";
import type { MessageKey } from "../../lib/i18n";
import "../../styles/finance.css";
export function Expenses({
  csrfToken,
  orderPublicId = "",
}: {
  csrfToken: string;
  orderPublicId?: string;
}) {
  const { t, locale } = usePreferences();
  const [filters, setFilters] = useState({
      category: "",
      state: "active",
      order: orderPublicId,
      from: "",
      to: "",
    }),
    [query, setQuery] = useState(
      new URLSearchParams(
        orderPublicId ? { order: orderPublicId } : {},
      ).toString(),
    ),
    [cursors, setCursors] = useState<string[]>([]),
    [page, setPage] = useState<ExpensePage | null>(null),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<MessageKey | null>(null),
    [revision, setRevision] = useState(0),
    [editor, setEditor] = useState<{
      row?: AdminExpense;
      draft: ReturnType<typeof expenseDraft>;
    } | null>(null);
  const lock = useRef(false),
    cursor = cursors.at(-1);
  useEffect(() => {
    const c = new AbortController();
    setLoading(true);
    setPage(null);
    setError(null);
    const p = new URLSearchParams(query);
    p.set("limit", "20");
    if (cursor) p.set("cursor", cursor);
    void api<ExpensePage>("finance/expenses?" + p, { signal: c.signal })
      .then((r) => {
        if (!c.signal.aborted) setPage(r);
      })
      .catch((e) => {
        if (!c.signal.aborted) setError(errorKey(e));
      })
      .finally(() => {
        if (!c.signal.aborted) setLoading(false);
      });
    return () => c.abort();
  }, [query, cursor, revision]);
  async function mutate(action: () => Promise<unknown>) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError(null);
    try {
      await action();
      setEditor(null);
      setCursors([]);
      setRevision((v) => v + 1);
    } catch (e) {
      setError(
        e instanceof Error && e.message === "financeInvalidExpense"
          ? "financeInvalidExpense"
          : errorKey(e),
      );
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  const headers = { "x-csrf-token": csrfToken };
  return (
    <AdminFrame csrfToken={csrfToken} preventLogout={busy}>
      <div className="page-heading">
        <div>
          <a href="/admin/finance" className="muted">
            ← {t("financeTitle")}
          </a>
          <h1>{t("financeExpenses")}</h1>
          <p className="muted">{t("financeExpenseHint")}</p>
        </div>
        <button
          className="primary"
          disabled={busy}
          onClick={() =>
            setEditor({ draft: expenseDraft(undefined, filters.order) })
          }
        >
          + {t("financeNewExpense")}
        </button>
      </div>
      {error && (
        <p role="alert" className="error">
          {t(error)} {t("financeRetryHint")}
        </p>
      )}
      {editor && (
        <form
          className="editor"
          onSubmit={(e) => {
            e.preventDefault();
            void mutate(() =>
              api(
                "finance/expenses" +
                  (editor.row ? "/" + encodeURIComponent(editor.row.id) : ""),
                {
                  method: editor.row ? "PATCH" : "POST",
                  headers,
                  body: JSON.stringify(
                    expensePayload(editor.draft, editor.row),
                  ),
                },
              ),
            );
          }}
        >
          <h2>{t(editor.row ? "financeEditExpense" : "financeNewExpense")}</h2>
          <fieldset disabled={busy} className="finance-fields">
            <div className="form-grid">
              <label>
                {t("financeCategory")}
                <select
                  value={editor.draft.category}
                  onChange={(e) =>
                    setEditor({
                      ...editor,
                      draft: {
                        ...editor.draft,
                        category: e.target.value as AdminExpense["category"],
                      },
                    })
                  }
                >
                  {expenseCategories.map((k) => (
                    <option key={k} value={k}>
                      {t(`financeCategory_${k}`)}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                {t("financeAmount")}
                <input
                  value={editor.draft.amount}
                  inputMode="numeric"
                  maxLength={10}
                  required
                  onChange={(e) =>
                    setEditor({
                      ...editor,
                      draft: { ...editor.draft, amount: e.target.value },
                    })
                  }
                />
              </label>
              <label>
                {t("financeOccurredAt")}
                <input
                  type="datetime-local"
                  min="1970-01-01T05:00"
                  required
                  value={editor.draft.occurredAt}
                  onChange={(e) =>
                    setEditor({
                      ...editor,
                      draft: { ...editor.draft, occurredAt: e.target.value },
                    })
                  }
                />
              </label>
              <label>
                {t("financeExpenseOrder")}
                <input
                  value={editor.draft.orderPublicId}
                  maxLength={100}
                  placeholder="STZ-..."
                  onChange={(e) =>
                    setEditor({
                      ...editor,
                      draft: { ...editor.draft, orderPublicId: e.target.value },
                    })
                  }
                />
              </label>
            </div>
            <label>
              {t("financeDescription")}
              <textarea
                rows={3}
                maxLength={500}
                value={editor.draft.description}
                onChange={(e) =>
                  setEditor({
                    ...editor,
                    draft: { ...editor.draft, description: e.target.value },
                  })
                }
              />
            </label>
            <div className="finance-actions">
              <button className="primary">{t("save")}</button>
              <button type="button" onClick={() => setEditor(null)}>
                {t("cancel")}
              </button>
            </div>
          </fieldset>
        </form>
      )}
      <form
        className="editor product-filters finance-filters"
        onSubmit={(e) => {
          e.preventDefault();
          const p = new URLSearchParams();
          for (const [k, v] of Object.entries(filters))
            if (v.trim()) p.set(k, v.trim());
          setCursors([]);
          setQuery(p.toString());
          setRevision((v) => v + 1);
        }}
      >
        <label>
          {t("financeCategory")}
          <select
            value={filters.category}
            onChange={(e) =>
              setFilters({ ...filters, category: e.target.value })
            }
          >
            <option value="">{t("financeAll")}</option>
            {expenseCategories.map((k) => (
              <option key={k} value={k}>
                {t(`financeCategory_${k}`)}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t("status")}
          <select
            value={filters.state}
            onChange={(e) => setFilters({ ...filters, state: e.target.value })}
          >
            <option value="active">{t("financeExpenseActive")}</option>
            <option value="voided">{t("financeVoided")}</option>
            <option value="all">{t("financeAll")}</option>
          </select>
        </label>
        <label>
          {t("financeExpenseOrder")}
          <input
            value={filters.order}
            maxLength={100}
            onChange={(e) => setFilters({ ...filters, order: e.target.value })}
          />
        </label>
        {(["from", "to"] as const).map((k) => (
          <label key={k}>
            {t(k === "from" ? "dashboardFrom" : "dashboardTo")}
            <input
              type="date"
              value={filters[k]}
              onChange={(e) => setFilters({ ...filters, [k]: e.target.value })}
            />
          </label>
        ))}
        <button disabled={busy || loading}>{t("search")}</button>
      </form>
      {loading ? (
        <p role="status">{t("loading")}</p>
      ) : page && !page.expenses.length ? (
        <p className="state">{t("financeNoExpenses")}</p>
      ) : (
        page && (
          <div className="finance-table-wrap">
            <table>
              <thead>
                <tr>
                  {(
                    [
                      "financeOccurredAt",
                      "financeCategory",
                      "financeAmount",
                      "financeDescription",
                      "financeExpenseOrder",
                      "status",
                      "actions",
                    ] as const
                  ).map((k) => (
                    <th key={k}>{t(k)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {page.expenses.map((e) => (
                  <tr key={e.id}>
                    <td>{dateTime(e.occurredAt, locale)}</td>
                    <td>{t(`financeCategory_${e.category}`)}</td>
                    <td>{uzs(e.amount, locale)} UZS</td>
                    <td className="finance-description">
                      {e.description ?? "—"}
                    </td>
                    <td>
                      {e.orderPublicId ? (
                        <a
                          href={
                            "/admin/orders/" +
                            encodeURIComponent(e.orderPublicId)
                          }
                        >
                          {e.orderPublicId}
                        </a>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td>
                      {t(e.voidedAt ? "financeVoided" : "financeExpenseActive")}
                      {e.voidedAt && (
                        <small className="muted">
                          {" "}
                          {dateTime(e.voidedAt, locale)}
                        </small>
                      )}
                    </td>
                    <td>
                      {!e.voidedAt && (
                        <div className="finance-actions">
                          <button
                            disabled={busy}
                            onClick={() =>
                              setEditor({ row: e, draft: expenseDraft(e) })
                            }
                          >
                            {t("edit")}
                          </button>
                          <button
                            disabled={busy}
                            onClick={() => {
                              if (window.confirm(t("financeVoidConfirm")))
                                void mutate(() =>
                                  api(
                                    `finance/expenses/${encodeURIComponent(e.id)}/void`,
                                    { method: "POST", headers },
                                  ),
                                );
                            }}
                          >
                            {t("financeVoid")}
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}
      <div className="finance-actions">
        <button
          disabled={busy || loading || !cursors.length}
          onClick={() => setCursors((v) => v.slice(0, -1))}
        >
          {t("customerPrevious")}
        </button>
        <button
          disabled={busy || loading || !page?.nextCursor}
          onClick={() => setCursors((v) => [...v, page!.nextCursor!])}
        >
          {t("customerNext")}
        </button>
      </div>
    </AdminFrame>
  );
}
