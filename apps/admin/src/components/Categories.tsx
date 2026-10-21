"use client";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { Header } from "./Header";
import { AdminNav } from "./AdminFrame";
import { usePreferences } from "./Preferences";
import { api, errorKey } from "../lib/api";
import type { MessageKey } from "../lib/i18n";

type Category = {
  archivedAt?: string | null;
  id: string;
  nameRu: string;
  nameUz: string;
  slug: string;
  sortOrder: number;
  isActive: boolean;
};
export function Categories({ csrfToken }: { csrfToken: string }) {
  const { t, locale } = usePreferences();
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<MessageKey | null>(null);
  const [notice, setNotice] = useState<MessageKey | null>(null);
  const [editor, setEditor] = useState<Category | "new" | null>(null);
  const [formError, setFormError] = useState<MessageKey | null>(null);
  const [busy, setBusy] = useState(false);
  const [archive, setArchive] = useState<"current" | "archived">("current");
  const archiveLock = useRef(false);
  const visibleCategories = categories.filter((c) =>
    archive === "archived" ? !!c.archivedAt : !c.archivedAt,
  );
  async function archiveCategory(category: Category) {
    if (
      busy ||
      archiveLock.current ||
      !window.confirm(
        t(category.archivedAt ? "archiveRestoreConfirm" : "archiveConfirm"),
      )
    )
      return;
    archiveLock.current = true;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const r = await api<{ category: Category }>(
        `catalog/categories/${encodeURIComponent(category.id)}/${category.archivedAt ? "restore" : "archive"}`,
        { method: "POST", headers },
      );
      upsert(r.category);
      setNotice("updated");
    } catch (e) {
      setError(errorKey(e));
    } finally {
      archiveLock.current = false;
      setBusy(false);
    }
  }
  const headers = { "x-csrf-token": csrfToken };
  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setCategories(
        (await api<{ categories: Category[] }>("catalog/categories"))
          .categories,
      );
    } catch (error) {
      setError(errorKey(error));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  function upsert(category: Category) {
    setCategories((previous) =>
      [...previous.filter((item) => item.id !== category.id), category].sort(
        (a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id),
      ),
    );
  }
  async function logout() {
    setBusy(true);
    setError(null);
    try {
      await api("auth/logout", { method: "POST", headers });
      window.location.replace("/admin/login");
    } catch (error) {
      setError(errorKey(error));
      setBusy(false);
    }
  }
  async function toggle(category: Category) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      upsert(
        (
          await api<{ category: Category }>(
            `catalog/categories/${encodeURIComponent(category.id)}/${category.isActive ? "deactivate" : "activate"}`,
            { method: "POST", headers },
          )
        ).category,
      );
      setNotice("updated");
    } catch (error) {
      setError(errorKey(error));
    } finally {
      setBusy(false);
    }
  }
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editor || busy) return;
    const data = new FormData(event.currentTarget);
    const input = {
      nameRu: String(data.get("nameRu")).trim(),
      nameUz: String(data.get("nameUz")).trim(),
      slug: String(data.get("slug")).trim(),
      sortOrder: Number(data.get("sortOrder")),
    };
    if (!input.nameRu || !input.nameUz) {
      setFormError("invalid");
      return;
    }
    setBusy(true);
    setFormError(null);
    setNotice(null);
    try {
      const isNew = editor === "new";
      const result = await api<{ category: Category }>(
        isNew
          ? "catalog/categories"
          : `catalog/categories/${encodeURIComponent(editor.id)}`,
        {
          method: isNew ? "POST" : "PATCH",
          headers,
          body: JSON.stringify(
            isNew
              ? { ...input, isActive: data.get("isActive") === "on" }
              : input,
          ),
        },
      );
      upsert(result.category);
      setEditor(null);
      setNotice("saved");
    } catch (error) {
      setFormError(errorKey(error));
    } finally {
      setBusy(false);
    }
  }
  const editing = editor && editor !== "new" ? editor : null;
  return (
    <div className="admin-dashboard-shell admin-section-shell" lang={locale}>
      <Header styled>
        <button className="quiet" disabled={busy} onClick={logout}>
          {t("logout")}
        </button>
      </Header>
      <div className="workspace">
        <AdminNav />
        <main className="content">
          <div className="page-heading">
            <div>
              <p className="eyebrow">{t("catalog")}</p>
              <h1>{t("categories")}</h1>
              <p className="muted">{t("intro")}</p>
            </div>
            <button
              className="primary"
              disabled={busy || loading || editor !== null}
              onClick={() => {
                setEditor("new");
                setFormError(null);
                setNotice(null);
              }}
            >
              <span aria-hidden="true">＋</span> {t("create")}
            </button>
          </div>
          <label className="archive-filter">
            {t("archiveFilter")}
            <select
              value={archive}
              disabled={busy || editor !== null}
              onChange={(e) =>
                setArchive(e.target.value as "current" | "archived")
              }
            >
              <option value="current">{t("archiveCurrent")}</option>
              <option value="archived">{t("archiveArchived")}</option>
            </select>
          </label>
          {notice && (
            <p className="notice" role="status">
              {t(notice)}
            </p>
          )}
          {error && (
            <div className="error" role="alert">
              {t(error)}{" "}
              <button
                className="quiet"
                onClick={load}
                disabled={loading || busy}
              >
                {t("retry")}
              </button>
            </div>
          )}
          {editor && (
            <section className="editor" aria-labelledby="editor-title">
              <div>
                <h2 id="editor-title">{t(editing ? "edit" : "create")}</h2>
                <p className="muted">{t(editing ? "editHint" : "newHint")}</p>
              </div>
              <form key={editing?.id ?? "new"} onSubmit={save} aria-busy={busy}>
                <fieldset disabled={busy}>
                  <div className="form-grid">
                    <label>
                      {t("nameRu")}
                      <input
                        autoFocus
                        name="nameRu"
                        lang="ru"
                        defaultValue={editing?.nameRu}
                        required
                        maxLength={200}
                      />
                    </label>
                    <label>
                      {t("nameUz")}
                      <input
                        name="nameUz"
                        lang="uz"
                        defaultValue={editing?.nameUz}
                        required
                        maxLength={200}
                      />
                    </label>
                    <label>
                      {t("slug")}
                      <input
                        name="slug"
                        defaultValue={editing?.slug}
                        required
                        maxLength={100}
                        pattern="[a-z0-9]+(-[a-z0-9]+)*"
                        aria-describedby="slug-hint"
                      />
                      <small id="slug-hint">{t("slugHint")}</small>
                    </label>
                    <label>
                      {t("order")}
                      <input
                        name="sortOrder"
                        type="number"
                        min={0}
                        max={2147483647}
                        step={1}
                        defaultValue={editing?.sortOrder ?? 0}
                        required
                      />
                    </label>
                  </div>
                  {!editing && (
                    <label className="checkbox">
                      <input name="isActive" type="checkbox" defaultChecked />
                      {t("active")}
                    </label>
                  )}
                </fieldset>
                {formError && (
                  <p className="error" role="alert">
                    {t(formError)}
                  </p>
                )}
                <div className="form-actions">
                  <button className="primary" disabled={busy}>
                    {t(busy ? "saving" : "save")}
                  </button>
                  <button
                    type="button"
                    className="secondary"
                    disabled={busy}
                    onClick={() => setEditor(null)}
                  >
                    {t("cancel")}
                  </button>
                </div>
              </form>
            </section>
          )}
          <section className="list-panel" aria-busy={loading}>
            {loading ? (
              <div className="state" role="status">
                <span className="spinner" />
                {t("loading")}
              </div>
            ) : error &&
              visibleCategories.length ===
                0 ? null : visibleCategories.length === 0 ? (
              <div className="state">
                <span className="empty-icon" aria-hidden="true">
                  ▦
                </span>
                <h2>{t("empty")}</h2>
                <p className="muted">{t("emptyHint")}</p>
              </div>
            ) : (
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>{t("nameRu")}</th>
                      <th>{t("nameUz")}</th>
                      <th>{t("slug")}</th>
                      <th>{t("order")}</th>
                      <th>{t("visibility")}</th>
                      <th>
                        <span className="sr-only">{t("actions")}</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleCategories.map((category) => (
                      <tr
                        key={category.id}
                        className={
                          category.archivedAt ? "archived-row" : undefined
                        }
                      >
                        <td lang="ru">{category.nameRu}</td>
                        <td lang="uz">{category.nameUz}</td>
                        <td>
                          <code>{category.slug}</code>
                        </td>
                        <td>{category.sortOrder}</td>
                        <td>
                          <span
                            className={`badge ${category.isActive ? "active" : ""}`}
                          >
                            <span aria-hidden="true">●</span>
                            {t(category.isActive ? "active" : "inactive")}
                          </span>
                        </td>
                        <td>
                          <div className="row-actions">
                            {!category.archivedAt && (
                              <>
                                <button
                                  className="secondary"
                                  disabled={busy || editor !== null}
                                  aria-label={`${t("edit")}: ${locale === "ru" ? category.nameRu : category.nameUz}`}
                                  onClick={() => {
                                    setEditor(category);
                                    setFormError(null);
                                    setNotice(null);
                                  }}
                                >
                                  {t("edit")}
                                </button>
                                <button
                                  className="quiet"
                                  disabled={busy || editor !== null}
                                  onClick={() => toggle(category)}
                                  aria-label={`${t(category.isActive ? "deactivate" : "activate")}: ${locale === "ru" ? category.nameRu : category.nameUz}`}
                                >
                                  {t(
                                    category.isActive
                                      ? "deactivate"
                                      : "activate",
                                  )}
                                </button>
                              </>
                            )}
                            <button
                              className="secondary"
                              disabled={busy || editor !== null}
                              onClick={() => archiveCategory(category)}
                            >
                              {t(
                                category.archivedAt
                                  ? "archiveRestore"
                                  : "archiveAction",
                              )}
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
        </main>
      </div>
    </div>
  );
}
