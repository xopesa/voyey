"use client";
import { useEffect, useState } from "react";
import type {
  Customer,
  CustomerCard,
  CustomerFilter,
  CustomerOrderPage,
  CustomerPage,
} from "@stenzo/shared";
import { AdminFrame } from "../AdminFrame";
import { usePreferences } from "../Preferences";
import { api, errorKey } from "../../lib/api";
import {
  dateTime,
  uzs,
  orderStatusKey,
  type OrderStatus,
} from "../../lib/orders";
import type { MessageKey } from "../../lib/i18n";
import "../../styles/customers.css";

export function telegramCustomerUrl(username: string | null) {
  return username && /^[A-Za-z][A-Za-z0-9_]{4,31}$/.test(username)
    ? `https://t.me/${username}`
    : null;
}
export const customerName = (c: Customer) =>
  [c.firstName, c.lastName].filter(Boolean).join(" ") ||
  (c.username ? "@" + c.username : c.telegramId);
export function CustomersList({ csrfToken }: { csrfToken: string }) {
  const { t, locale } = usePreferences();
  const [search, setSearch] = useState(""),
    [filter, setFilter] = useState<CustomerFilter>("all");
  const [query, setQuery] = useState(""),
    [cursors, setCursors] = useState<string[]>([]);
  const [page, setPage] = useState<CustomerPage | null>(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState<MessageKey | null>(null);
  const cursor = cursors.at(-1);
  useEffect(() => {
    const abort = new AbortController();
    setLoading(true);
    setError(null);
    const params = new URLSearchParams(query);
    params.set("limit", "20");
    if (cursor) params.set("cursor", cursor);
    void api<CustomerPage>(`customers?${params}`, { signal: abort.signal })
      .then((p) => {
        if (!abort.signal.aborted) setPage(p);
      })
      .catch((e) => {
        if (!abort.signal.aborted) setError(errorKey(e));
      })
      .finally(() => {
        if (!abort.signal.aborted) setLoading(false);
      });
    return () => abort.abort();
  }, [query, cursor]);
  return (
    <AdminFrame csrfToken={csrfToken}>
      <div className="page-heading">
        <div>
          <p className="eyebrow">STENZO ADMIN</p>
          <h1>{t("customers")}</h1>
          <p className="muted">{t("customersIntro")}</p>
        </div>
      </div>
      <form
        className="product-filters"
        onSubmit={(e) => {
          e.preventDefault();
          setCursors([]);
          setQuery(
            new URLSearchParams({ search: search.trim(), filter }).toString(),
          );
        }}
      >
        <label>
          {t("customerSearch")}
          <input
            value={search}
            maxLength={100}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
        <label>
          {t("customerFilter")}
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value as CustomerFilter)}
          >
            {(
              ["all", "active", "blocked", "with-orders", "no-orders"] as const
            ).map((f) => (
              <option key={f} value={f}>
                {t(`customerFilter_${f}`)}
              </option>
            ))}
          </select>
        </label>
        <button className="primary" disabled={loading}>
          {t("search")}
        </button>
      </form>
      {error && (
        <p role="alert" className="error">
          {t(error)}
        </p>
      )}
      {loading ? (
        <p role="status">{t("loading")}</p>
      ) : !page?.customers.length ? (
        <section className="editor empty-state">
          <h2>{t("customerEmpty")}</h2>
          <p>{t("customerMissing")}</p>
        </section>
      ) : (
        <div className="list-panel">
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  {[
                    "customerIdentity",
                    "customerLocale",
                    "status",
                    "customerRegistered",
                    "customerOrderCount",
                    "customerReceived",
                    "customerActiveOrders",
                    "customerLatestOrder",
                    "customerLastInteraction",
                  ].map((k) => (
                    <th key={k}>{t(k as MessageKey)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {page.customers.map((c) => (
                  <tr key={c.id}>
                    <td>
                      <a href={`/admin/customers/${encodeURIComponent(c.id)}`}>
                        <strong>{customerName(c)}</strong>
                      </a>
                      <br />
                      <span className="muted">
                        {c.telegramId}
                        {c.username ? ` · @${c.username}` : ""}
                      </span>
                    </td>
                    <td>{c.preferredLocale.toUpperCase()}</td>
                    <td>{t(`customerStatus_${c.status}`)}</td>
                    <td>{dateTime(c.registeredAt, locale)}</td>
                    <td>{c.orderCount}</td>
                    <td>{uzs(c.approvedPayments, locale)} UZS</td>
                    <td>{c.activeOrders}</td>
                    <td>
                      {c.latestOrder ? (
                        <a
                          href={`/admin/orders/${encodeURIComponent(c.latestOrder.publicId)}`}
                        >
                          {c.latestOrder.publicId}
                        </a>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td>{dateTime(c.lastInteractionAt, locale)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      <div className="form-actions button-row">
        <button
          disabled={loading || !cursors.length}
          onClick={() => setCursors((c) => c.slice(0, -1))}
        >
          {t("customerPrevious")}
        </button>
        <span>
          {t("customerPage")} {cursors.length + 1}
        </span>
        <button
          disabled={loading || !page?.nextCursor}
          onClick={() =>
            page?.nextCursor && setCursors((c) => [...c, page.nextCursor!])
          }
        >
          {t("customerNext")}
        </button>
      </div>
    </AdminFrame>
  );
}

export function CustomerDetail({
  csrfToken,
  customerId,
  children,
}: {
  csrfToken: string;
  customerId: string;
  children?: React.ReactNode;
}) {
  const { t, locale } = usePreferences();
  const [customer, setCustomer] = useState<CustomerCard | null>(null),
    [page, setPage] = useState<CustomerOrderPage | null>(null);
  const [loading, setLoading] = useState(true),
    [error, setError] = useState<MessageKey | null>(null),
    [cursors, setCursors] = useState<string[]>([]);
  const cursor = cursors.at(-1);
  useEffect(() => {
    const abort = new AbortController();
    setLoading(true);
    setError(null);
    const root = `customers/${encodeURIComponent(customerId)}`;
    void Promise.all([
      api<{ customer: CustomerCard }>(root, { signal: abort.signal }),
      api<CustomerOrderPage>(
        `${root}/orders?limit=20${cursor ? "&cursor=" + encodeURIComponent(cursor) : ""}`,
        { signal: abort.signal },
      ),
    ])
      .then(([c, p]) => {
        if (!abort.signal.aborted) {
          setCustomer(c.customer);
          setPage(p);
        }
      })
      .catch((e) => {
        if (!abort.signal.aborted) setError(errorKey(e));
      })
      .finally(() => {
        if (!abort.signal.aborted) setLoading(false);
      });
    return () => abort.abort();
  }, [customerId, cursor]);
  const url = customer ? telegramCustomerUrl(customer.username) : null;
  return (
    <AdminFrame csrfToken={csrfToken}>
      <div className="page-heading">
        <div>
          <a href="/admin/customers" className="muted">
            ← {t("customers")}
          </a>
          <h1>{customer ? customerName(customer) : t("customerCard")}</h1>
          <p className="muted">{t("customersIntro")}</p>
        </div>
        {customer?.status === "ACTIVE" && (
          <a
            className="button primary"
            href={`/admin/customers/${encodeURIComponent(customer.id)}/orders/new`}
          >
            + {t("manualCreate")}
          </a>
        )}
        {url && (
          <a
            className="button"
            href={url}
            target="_blank"
            rel="noopener noreferrer"
          >
            {t("customerTelegram")}
          </a>
        )}
      </div>
      {error && (
        <p role="alert" className="error">
          {t(error)}
        </p>
      )}
      {loading ? (
        <p role="status">{t("loading")}</p>
      ) : (
        customer && (
          <>
            <section className="customer-summary">
              {[
                ["customerOrderCount", customer.orderCount],
                [
                  "customerReceived",
                  `${uzs(customer.approvedPayments, locale)} UZS`,
                ],
                ["customerActiveOrders", customer.activeOrders],
                ["customerCompleted", customer.completedOrders],
              ].map(([key, value]) => (
                <article className="editor" key={key}>
                  <p className="muted">{t(key as MessageKey)}</p>
                  <strong>{value}</strong>
                </article>
              ))}
            </section>
            <div className="customer-columns">
              <section className="editor">
                <h2>Telegram</h2>
                <dl className="finance-grid">
                  <div>
                    <dt>ID</dt>
                    <dd>{customer.telegramId}</dd>
                  </div>
                  <div>
                    <dt>Username</dt>
                    <dd>{customer.username ? "@" + customer.username : "—"}</dd>
                  </div>
                  <div>
                    <dt>{t("customerFirstName")}</dt>
                    <dd>{customer.firstName ?? "—"}</dd>
                  </div>
                  <div>
                    <dt>{t("customerLastName")}</dt>
                    <dd>{customer.lastName ?? "—"}</dd>
                  </div>
                  <div>
                    <dt>{t("customerLocale")}</dt>
                    <dd>{customer.preferredLocale.toUpperCase()}</dd>
                  </div>
                  <div>
                    <dt>{t("status")}</dt>
                    <dd>{t(`customerStatus_${customer.status}`)}</dd>
                  </div>
                  <div>
                    <dt>{t("customerRegistered")}</dt>
                    <dd>{dateTime(customer.registeredAt, locale)}</dd>
                  </div>
                  <div>
                    <dt>{t("customerLatestOrder")}</dt>
                    <dd>
                      {customer.latestOrder ? (
                        <a
                          href={`/admin/orders/${encodeURIComponent(customer.latestOrder.publicId)}`}
                        >
                          {customer.latestOrder.publicId}
                        </a>
                      ) : (
                        "—"
                      )}
                    </dd>
                  </div>
                </dl>
              </section>
              <section className="editor">
                <h2>{t("customerLatestRecipient")}</h2>
                {customer.latestRecipient ? (
                  <dl className="finance-grid">
                    {(
                      [
                        "fullName",
                        "phone",
                        "city",
                        "address",
                        "apartment",
                      ] as const
                    ).map((key) => (
                      <div key={key}>
                        <dt>{t(`customerRecipient_${key}`)}</dt>
                        <dd>{customer.latestRecipient![key] ?? "—"}</dd>
                      </div>
                    ))}
                  </dl>
                ) : (
                  <p className="muted">{t("customerNoRecipient")}</p>
                )}
              </section>
            </div>
            <section className="editor">
              <h2>{t("customerPaymentSummary")}</h2>
              <p className="muted">{t("customerPaymentHint")}</p>
              <dl className="finance-grid">
                <div>
                  <dt>{t("customerReceived")}</dt>
                  <dd>{uzs(customer.approvedPayments, locale)} UZS</dd>
                </div>
                <div>
                  <dt>{t("customerPrepayments")}</dt>
                  <dd>{uzs(customer.prepayments, locale)} UZS</dd>
                </div>
                <div>
                  <dt>{t("customerFinalPayments")}</dt>
                  <dd>{uzs(customer.finalPayments, locale)} UZS</dd>
                </div>
                <div>
                  <dt>{t("lifecycleRefunded")}</dt>
                  <dd>{uzs(customer.refunded ?? 0, locale)} UZS</dd>
                </div>
                <div>
                  <dt>{t("lifecycleRefundPending")}</dt>
                  <dd>{uzs(customer.pendingRefunds ?? 0, locale)} UZS</dd>
                </div>
              </dl>
            </section>
            {children}
            <section className="list-panel">
              <div className="customer-section-title">
                <h2>{t("customerHistory")}</h2>
              </div>
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      {[
                        "orderDetail",
                        "customerSource",
                        "customerCreatedAt",
                        "goodsTotal",
                        "marketingDiscount",
                        "customerReceived",
                        "status",
                      ].map((k) => (
                        <th key={k}>{t(k as MessageKey)}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {page?.orders.map((o) => (
                      <tr key={o.publicId}>
                        <td>
                          <a
                            href={`/admin/orders/${encodeURIComponent(o.publicId)}`}
                          >
                            {o.publicId}
                          </a>
                        </td>
                        <td>
                          {t(
                            o.source === "ADMIN"
                              ? "orderSourceAdmin"
                              : "orderSourceMiniapp",
                          )}
                        </td>
                        <td>{dateTime(o.createdAt, locale)}</td>
                        <td>{uzs(o.total, locale)} UZS</td>
                        <td>{uzs(o.discountAmount, locale)} UZS</td>
                        <td>{uzs(o.paid, locale)} UZS</td>
                        <td>{t(orderStatusKey(o.status as OrderStatus))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {!page?.orders.length && (
                <p className="muted customer-section-title">
                  {t("customerNoOrders")}
                </p>
              )}
            </section>
            <div className="form-actions button-row">
              <button
                disabled={!cursors.length}
                onClick={() => setCursors((c) => c.slice(0, -1))}
              >
                {t("customerPrevious")}
              </button>
              <button
                disabled={!page?.nextCursor}
                onClick={() =>
                  page?.nextCursor &&
                  setCursors((c) => [...c, page.nextCursor!])
                }
              >
                {t("customerNext")}
              </button>
            </div>
          </>
        )
      )}
    </AdminFrame>
  );
}
