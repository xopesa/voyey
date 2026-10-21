"use client";
import { useEffect, useRef, useState } from "react";
import type {
  CustomerCard,
  CustomerPage,
  CustomerRecipient,
} from "@stenzo/shared";
import { AdminFrame } from "../AdminFrame";
import { usePreferences } from "../Preferences";
import { api, ApiError, errorKey } from "../../lib/api";
import type { MessageKey } from "../../lib/i18n";
import { customerName } from "./Customers";
import type { Product } from "../../lib/products";
import { uzs } from "../../lib/orders";
import {
  emptyManualRecipient,
  manualPayload,
  readManualAttempt,
  storeManualAttempt,
  clearManualAttempt,
  type ManualLine,
  type ManualPreview,
} from "../../lib/manual-orders";
import "../../styles/customers.css";

export function ManualOrder({
  csrfToken,
  customerId,
}: {
  csrfToken: string;
  customerId?: string;
}) {
  const { t, locale } = usePreferences();
  const [userSearch, setUserSearch] = useState(""),
    [customers, setCustomers] = useState<CustomerPage["customers"]>([]),
    [chosenId, setChosenId] = useState(customerId ?? ""),
    [customer, setCustomer] = useState<CustomerCard | null>(null);
  const [recipient, setRecipient] = useState<CustomerRecipient>({
      ...emptyManualRecipient,
    }),
    [lines, setLines] = useState<(ManualLine & { label: string })[]>([]),
    [promo, setPromo] = useState("");
  const [productSearch, setProductSearch] = useState(""),
    [products, setProducts] = useState<Product[]>([]),
    [productId, setProductId] = useState(""),
    [variantId, setVariantId] = useState("");
  const [quantity, setQuantity] = useState("1"),
    [height, setHeight] = useState(""),
    [weight, setWeight] = useState("");
  const [busy, setBusy] = useState(false),
    [loadingCustomer, setLoadingCustomer] = useState(false),
    [error, setError] = useState<MessageKey | null>(null),
    [quote, setQuote] = useState<{ key: string; value: ManualPreview } | null>(
      null,
    ),
    [uncertain, setUncertain] = useState(false);
  const finished = useRef(false);
  const lock = useRef(false),
    attempt = useRef<{ userId: string; key: string } | null>(null);
  const product = products.find((p) => p.id === productId),
    variants =
      product?.variants.filter(
        (v) => v.isActive && (v.stock === null || v.stock > 0),
      ) ?? [];
  let payload: ReturnType<typeof manualPayload> | undefined;
  try {
    payload = manualPayload(chosenId, recipient, lines, promo);
  } catch {
    /* incomplete form */
  }
  const fingerprint = payload ? JSON.stringify(payload) : "",
    preview = quote?.key === fingerprint ? quote.value : null;
  useEffect(() => {
    const c = new AbortController();
    setCustomer(null);
    setQuote(null);
    setRecipient({ ...emptyManualRecipient });
    if (!chosenId) return () => c.abort();
    setLoadingCustomer(true);
    setError(null);
    void api<{ customer: CustomerCard }>(
      `customers/${encodeURIComponent(chosenId)}`,
      { signal: c.signal },
    )
      .then((r) => {
        if (!c.signal.aborted) {
          setCustomer(r.customer);
          setRecipient(
            r.customer.latestRecipient ?? { ...emptyManualRecipient },
          );
          setUncertain(readManualAttempt(chosenId)?.uncertain ?? false);
        }
      })
      .catch((e) => {
        if (!c.signal.aborted)
          setError(
            e instanceof ApiError && e.status === 404
              ? "customerMissing"
              : errorKey(e),
          );
      })
      .finally(() => {
        if (!c.signal.aborted) setLoadingCustomer(false);
      });
    return () => c.abort();
  }, [chosenId]);
  function failed(e: unknown) {
    setError(
      e instanceof Error && e.message === "manualInvalid"
        ? "manualInvalid"
        : e instanceof ApiError && e.status === 409 && !e.code
          ? "manualConflict"
          : errorKey(e),
    );
  }
  async function run(action: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (e) {
      failed(e);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  function add() {
    try {
      if (!product || !variantId) throw Error("manualInvalid");
      if (lines.some((l) => l.variantId === variantId)) {
        setError("manualDuplicateVariant");
        return;
      }
      const v = variants.find((v) => v.id === variantId);
      if (!v) throw Error("manualInvalid");
      const next = [
        ...lines,
        {
          productId,
          variantId,
          quantity: Number(quantity),
          heightCm: Number(height),
          weightKg: Number(weight),
          label: `${locale === "ru" ? product.nameRu : product.nameUz} · ${v.size}${v.color ? " · " + v.color : ""}`,
        },
      ];
      manualPayload(chosenId || "selection-pending", recipient, next, promo);
      setLines(next);
      setError(null);
    } catch (e) {
      failed(e);
    }
  }
  async function check() {
    await run(async () => {
      setQuote(null);
      const body = manualPayload(chosenId, recipient, lines, promo);
      const result = await api<{ preview: ManualPreview }>(
        "orders/manual/preview",
        {
          method: "POST",
          headers: { "x-csrf-token": csrfToken },
          body: JSON.stringify(body),
        },
      );
      setQuote({ key: JSON.stringify(body), value: result.preview });
    });
  }
  async function create() {
    if (
      finished.current ||
      !preview ||
      !payload ||
      customer?.status !== "ACTIVE"
    )
      return;
    const body = payload;
    await run(async () => {
      if (attempt.current?.userId !== body.userId)
        attempt.current = {
          userId: body.userId,
          key: readManualAttempt(body.userId)?.key ?? crypto.randomUUID(),
        };
      const key = attempt.current.key;
      storeManualAttempt(body.userId, key, true);
      setUncertain(true);
      const result = await api<{ order: { publicId: string } }>(
        "orders/manual",
        {
          method: "POST",
          headers: { "x-csrf-token": csrfToken, "idempotency-key": key },
          body: JSON.stringify(body),
        },
      );
      if (
        !result.order ||
        typeof result.order.publicId !== "string" ||
        !/^[-A-Za-z0-9._:]{1,100}$/.test(result.order.publicId)
      )
        throw Error("Unconfirmed order");
      finished.current = true;
      clearManualAttempt(body.userId);
      attempt.current = null;
      setUncertain(false);
      window.location.assign(
        `/admin/orders/${encodeURIComponent(result.order.publicId)}`,
      );
    });
  }
  const money = (n: number) => `${uzs(n, locale)} UZS`;
  return (
    <AdminFrame csrfToken={csrfToken} preventLogout={busy}>
      <div className="page-heading">
        <div>
          <a
            href={
              chosenId
                ? `/admin/customers/${encodeURIComponent(chosenId)}`
                : "/admin/orders"
            }
            className="muted"
          >
            ← {t(chosenId ? "customerCard" : "orders")}
          </a>
          <h1>{t("manualOrder")}</h1>
          <p className="muted">{t("manualIntro")}</p>
        </div>
      </div>
      {error && (
        <p role="alert" className="error">
          {t(error)}
        </p>
      )}
      {uncertain && (
        <p role="status" className="notice">
          {t("manualRecovery")}
        </p>
      )}
      <section className="editor">
        <h2>{t("manualCustomer")}</h2>
        {!customerId && (
          <form
            className="customer-picker"
            onSubmit={(e) => {
              e.preventDefault();
              void run(async () =>
                setCustomers(
                  (
                    await api<CustomerPage>(
                      `customers?filter=active&limit=20&search=${encodeURIComponent(userSearch.trim())}`,
                    )
                  ).customers,
                ),
              );
            }}
          >
            <label>
              {t("customerSearch")}
              <input
                value={userSearch}
                maxLength={100}
                onChange={(e) => setUserSearch(e.target.value)}
                disabled={busy}
              />
            </label>
            <button disabled={busy} type="submit">
              {t("search")}
            </button>
          </form>
        )}
        {customers.map((c) => (
          <button
            key={c.id}
            disabled={busy || loadingCustomer}
            type="button"
            onClick={() => setChosenId(c.id)}
          >
            {customerName(c)} · {c.telegramId}
          </button>
        ))}
        {loadingCustomer ? (
          <p role="status">{t("loading")}</p>
        ) : customer ? (
          <>
            <p>
              <strong>{customerName(customer)}</strong> · {customer.telegramId}{" "}
              · {t(`customerStatus_${customer.status}`)}
            </p>
            {customer.status !== "ACTIVE" && (
              <p className="error">{t("manualCustomerInactive")}</p>
            )}
          </>
        ) : (
          <p className="muted">{t("customerMissing")}</p>
        )}
      </section>
      <fieldset
        disabled={
          busy || loadingCustomer || !customer || customer.status !== "ACTIVE"
        }
        className="manual-order-fields"
      >
        <section className="editor">
          <h2>{t("manualItems")}</h2>
          <form
            className="customer-picker"
            onSubmit={(e) => {
              e.preventDefault();
              void run(async () => {
                const page = await api<{ products: Product[] }>(
                  `catalog/products?status=ACTIVE&limit=20&search=${encodeURIComponent(productSearch.trim())}`,
                );
                setProducts(page.products.filter((p) => p.category.isActive));
                setProductId("");
                setVariantId("");
              });
            }}
          >
            <label>
              {t("manualProductSearch")}
              <input
                value={productSearch}
                maxLength={100}
                onChange={(e) => setProductSearch(e.target.value)}
              />
            </label>
            <button type="submit">{t("search")}</button>
          </form>
          <div className="form-grid">
            <label>
              {t("products")}
              <select
                value={productId}
                onChange={(e) => {
                  setProductId(e.target.value);
                  setVariantId("");
                }}
              >
                <option value="">{t("manualChooseProduct")}</option>
                {products.map((p) => (
                  <option key={p.id} value={p.id}>
                    {locale === "ru" ? p.nameRu : p.nameUz}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {t("manualVariant")}
              <select
                value={variantId}
                onChange={(e) => setVariantId(e.target.value)}
              >
                <option value="">{t("manualChooseVariant")}</option>
                {variants.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.size} · {v.color ?? "—"} ·{" "}
                    {v.stock === null ? "∞" : v.stock}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {t("manualQuantity")}
              <input
                type="number"
                min={1}
                max={99}
                step={1}
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
              />
            </label>
            <label>
              {t("manualHeight")}
              <input
                type="number"
                min={100}
                max={250}
                step={1}
                value={height}
                onChange={(e) => setHeight(e.target.value)}
              />
            </label>
            <label>
              {t("manualWeight")}
              <input
                type="number"
                min={30}
                max={300}
                step={1}
                value={weight}
                onChange={(e) => setWeight(e.target.value)}
              />
            </label>
          </div>
          <button type="button" disabled={lines.length >= 20} onClick={add}>
            {t("manualAddItem")}
          </button>
          <ol className="customer-notes-list">
            {lines.map((l, i) => (
              <li key={l.variantId}>
                <strong>{l.label}</strong>
                <p>
                  {l.quantity} · {l.heightCm} cm · {l.weightKg} kg
                </p>
                <button
                  type="button"
                  onClick={() =>
                    setLines((rows) => rows.filter((_, n) => n !== i))
                  }
                >
                  {t("manualRemoveItem")}
                </button>
              </li>
            ))}
          </ol>
        </section>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void check();
          }}
        >
          <section className="editor">
            <h2>{t("manualRecipient")}</h2>
            <p className="muted">{t("customerLatestRecipient")}</p>
            <div className="form-grid">
              {(
                [
                  "fullName",
                  "phone",
                  "city",
                  "address",
                  "apartment",
                  "comment",
                ] as const
              ).map((key) => (
                <label key={key}>
                  {t(`manualRecipient_${key}`)}
                  <input
                    required={key !== "apartment" && key !== "comment"}
                    maxLength={
                      key === "comment"
                        ? 1000
                        : key === "address"
                          ? 500
                          : key === "fullName"
                            ? 200
                            : key === "phone"
                              ? 24
                              : 100
                    }
                    value={recipient[key] ?? ""}
                    type={key === "phone" ? "tel" : "text"}
                    onChange={(e) =>
                      setRecipient((r) => ({ ...r, [key]: e.target.value }))
                    }
                  />
                </label>
              ))}
            </div>
            <label>
              {t("promoCode")}
              <input
                value={promo}
                maxLength={32}
                onChange={(e) => setPromo(e.target.value)}
                autoComplete="off"
              />
            </label>
          </section>
          <button className="primary" disabled={!lines.length} type="submit">
            {t("manualPreview")}
          </button>
        </form>
        {preview && (
          <section className="editor manual-preview">
            <h2>{t("manualPreview")}</h2>
            <ul>
              {preview.items.map((i, index) => (
                <li key={index}>
                  {locale === "ru" ? i.productNameRu : i.productNameUz} ·{" "}
                  {i.size} · {i.quantity} × {money(i.unitPrice)} ={" "}
                  {money(i.lineTotal)}
                </li>
              ))}
            </ul>
            <dl className="finance-grid">
              {[
                ["marketingSubtotal", preview.subtotal],
                ["marketingDiscount", preview.discountAmount],
                ["goodsTotal", preview.total],
                ["prepayment", preview.requiredPrepayment],
                ["remainingGoods", preview.remainingAmount],
              ].map(([k, n]) => (
                <div key={k}>
                  <dt>{t(k as MessageKey)}</dt>
                  <dd>{money(Number(n))}</dd>
                </div>
              ))}
            </dl>
            {preview.promoCodeSnapshot && (
              <p>
                {t("promoCode")}: {preview.promoCodeSnapshot}
              </p>
            )}
            <p className="muted">{t("manualConfirmHint")}</p>
            <button
              className="primary"
              type="button"
              disabled={busy}
              onClick={() => void create()}
            >
              {t("manualCreate")}
            </button>
          </section>
        )}
      </fieldset>
    </AdminFrame>
  );
}
