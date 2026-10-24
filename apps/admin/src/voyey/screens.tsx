import { useState, type ReactNode } from "react";
import { LayoutGroup, motion } from "motion/react";
import { assets } from "../../../miniapp/src/voyey/assets";
import proof from "./proof.svg?url";
import {
  dateTime,
  money,
  translate,
  type Locale,
  type MessageKey,
} from "./messages";
import {
  filterOrders,
  filterProducts,
  initialProducts,
  orderFilters,
  orders,
  promos,
  saveProduct,
  type DemoClaim,
  type DemoOrder,
  type DemoProduct,
  type OrderFilter,
  type ProductSort,
  type Section,
} from "./model";
import {
  Icon,
  VoyeyAdminButton as Button,
  VoyeyAdminCard as Card,
  VoyeyAdminDrawer as Drawer,
  VoyeyAdminInput as Input,
  VoyeyAdminStatusBadge as Badge,
  VoyeyAdminStatCard as Stat,
  VoyeyAdminTable as Table,
  VoyeyAdminEmptyState as Empty,
  useAdminMotion,
  transition,
} from "./components";

export function PageTitle({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
}) {
  return (
    <div className="va-page-title">
      <div>
        <h1>{title}</h1>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}
export function Filters({
  locale,
  value,
  onChange,
}: {
  locale: Locale;
  value: OrderFilter;
  onChange: (s: OrderFilter) => void;
}) {
  const reduced = useAdminMotion();
  return (
    <div
      className="va-filters"
      role="group"
      aria-label={translate(locale, "status")}
    >
      <LayoutGroup id="va-order-filters">
        {orderFilters.map((f) => (
          <motion.button
            key={f}
            aria-pressed={value === f}
            onClick={() => onChange(f)}
            transition={transition(reduced)}
          >
            {value === f && (
              <motion.span
                className="va-filter-active"
                layoutId={reduced ? undefined : "filter"}
                transition={transition(reduced)}
              />
            )}
            <span>{translate(locale, f)}</span>
          </motion.button>
        ))}
      </LayoutGroup>
    </div>
  );
}
export function OrderTable({
  source,
  locale,
  open,
}: {
  source: DemoOrder[];
  locale: Locale;
  open: (o: DemoOrder) => void;
}) {
  const t = (key: MessageKey) => translate(locale, key);
  return (
    <Table
      locale={locale}
      count={source.length}
      headers={[
        t("order"),
        t("buyer"),
        t("date"),
        t("mode"),
        t("amount"),
        t("status"),
        t("paymentStatus"),
        t("actions"),
      ]}
    >
      {source.map((o) => (
        <tr key={o.id}>
          <td>
            <button className="va-text-button" onClick={() => open(o)}>
              {o.id}
            </button>
          </td>
          <td>
            {t("syntheticBuyer")} {o.buyer}
          </td>
          <td className="va-nowrap">{dateTime(o.created, locale)}</td>
          <td>
            <Badge locale={locale} value={o.mode} />
          </td>
          <td className="va-money">{money(o.goodsTotal, locale)}</td>
          <td>
            <Badge locale={locale} value={o.status} />
          </td>
          <td>
            <Badge locale={locale} value={o.payment} />
          </td>
          <td>
            <Button
              onClick={() => open(o)}
              aria-label={`${t("details")} ${o.id}`}
            >
              <Icon name="chevron" />
            </Button>
          </td>
        </tr>
      ))}
    </Table>
  );
}
export function OrdersScreen({
  locale,
  query,
  open,
}: {
  locale: Locale;
  query: string;
  open: (o: DemoOrder) => void;
}) {
  const [filter, setFilter] = useState<OrderFilter>("all");
  return (
    <>
      <PageTitle
        title={translate(locale, "orders")}
        subtitle={translate(locale, "demoWarning")}
      />
      <Card>
        <Filters locale={locale} value={filter} onChange={setFilter} />
        <OrderTable
          source={filterOrders(orders, filter, query, locale)}
          locale={locale}
          open={open}
        />
      </Card>
    </>
  );
}
export function OrderDetails({
  order: o,
  locale,
  onClose,
}: {
  order: DemoOrder;
  locale: Locale;
  onClose: () => void;
}) {
  const t = (key: MessageKey) => translate(locale, key);
  const lines = [
    [t("subtotal"), money(o.subtotal, locale)],
    [t("discount"), `−${money(o.discount, locale)}`],
    [t("goodsTotal"), money(o.goodsTotal, locale)],
    [`${t("first")} · ${o.percent}%`, money(o.first, locale)],
    [t("remaining"), money(o.goodsTotal - o.paidGoods, locale)],
    [
      t("cargo"),
      o.mode === "IN_STOCK"
        ? t("cargoNotUsed")
        : o.cargo === null
          ? t("cargoUnknown")
          : money(o.cargo, locale),
    ],
  ];
  return (
    <Drawer title={o.id} locale={locale} onClose={onClose}>
      <p className="va-notice">{t("snapshot")}</p>
      <div className="va-actions">
        <Badge locale={locale} value={o.mode} />
        <Badge locale={locale} value={o.status} />
      </div>
      <p>
        {t("syntheticBuyer")} {o.buyer} · {dateTime(o.created, locale)}
      </p>
      <Card title={t("goods")}>
        <div className="va-detail-pad">
          <h3>{o.item.name[locale]}</h3>
          <code>{o.item.sku}</code> × {o.item.quantity}
          <dl className="va-summary">
            {o.item.attributes.map((a) => (
              <div key={a.label}>
                <dt>{t(a.label)}</dt>
                <dd>{a.translated ? t(a.value as MessageKey) : a.value}</dd>
              </div>
            ))}
          </dl>
        </div>
      </Card>
      <dl className="va-summary va-totals">
        {lines.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      <p className="va-muted">{t("localOnly")}</p>
    </Drawer>
  );
}
export function DashboardScreen({
  locale,
  claims,
  products,
  navigate,
  openOrder,
  openClaim,
}: {
  locale: Locale;
  claims: DemoClaim[];
  products: DemoProduct[];
  navigate: (s: Section) => void;
  openOrder: (o: DemoOrder) => void;
  openClaim: (c: DemoClaim) => void;
}) {
  const t = (key: MessageKey) => translate(locale, key),
    pending = claims.filter((c) => c.status === "SUBMITTED"),
    low = products.filter((p) => p.stock < 5 && p.status === "ACTIVE");
  // Fixture totals describe the initial mock ledger. Reviewing a mock image does not create ledger entries.
  const kpis: {
    label: MessageKey;
    value: number | string;
    icon: string;
    section: Section;
  }[] = [
    {
      label: "allOrders",
      value: orders.length,
      icon: "orders",
      section: "orders",
    },
    { label: "newOrders", value: 2, icon: "clock", section: "orders" },
    {
      label: "reviewCount",
      value: pending.length,
      icon: "payments",
      section: "payments",
    },
    {
      label: "revenue",
      value: money(401600, locale),
      icon: "analytics",
      section: "analytics",
    },
    { label: "activePre", value: 2, icon: "products", section: "orders" },
    {
      label: "lowStock",
      value: low.length,
      icon: "stock",
      section: "products",
    },
  ];
  return (
    <>
      <PageTitle
        title={t("dashboardTitle")}
        subtitle={t("overview")}
        action={
          <span className="va-date">
            <Icon name="clock" size={16} />
            {t("today")}
          </span>
        }
      />
      <div className="va-stats">
        {kpis.map((k) => (
          <Stat
            key={k.label}
            label={t(k.label)}
            value={k.value}
            icon={k.icon}
            onClick={() => navigate(k.section)}
          />
        ))}
      </div>
      <Card
        title={t("recent")}
        action={
          <button className="va-text-button" onClick={() => navigate("orders")}>
            {t("seeAll")} →
          </button>
        }
      >
        <OrderTable
          source={orders.slice(0, 4)}
          locale={locale}
          open={openOrder}
        />
      </Card>
      <div className="va-dashboard-grid">
        <Card
          title={t("pendingPayments")}
          action={
            <button
              className="va-text-button"
              onClick={() => navigate("payments")}
            >
              {t("seeAll")} →
            </button>
          }
        >
          {pending.length ? (
            pending.map((c) => (
              <button
                key={c.id}
                className="va-list-row"
                onClick={() => openClaim(c)}
              >
                <span className="va-list-icon">
                  <Icon name="payments" />
                </span>
                <span>
                  <strong>{c.orderId}</strong>
                  <small>
                    {c.phase} · {t("syntheticBuyer")}{" "}
                    {orders.find((o) => o.id === c.orderId)?.buyer}
                  </small>
                </span>
                <b>{money(c.amount, locale)}</b>
                <Icon name="chevron" size={16} />
              </button>
            ))
          ) : (
            <Empty locale={locale} />
          )}
        </Card>
        <Card title={t("lowStock")}>
          {low.map((p) => (
            <button
              key={p.id}
              className="va-list-row"
              onClick={() => navigate("products")}
            >
              <img src={assets[p.image]} alt="" />
              <span>
                <strong>{p.name[locale]}</strong>
                <small>{p.sku}</small>
              </span>
              <b className="va-stock-low">{p.stock}</b>
            </button>
          ))}
        </Card>
        <Card title={t("events")}>
          <ol className="va-events">
            {(["eventReceipt", "eventStock", "eventOrder"] as const).map(
              (e, i) => (
                <li key={e}>
                  <i />
                  <div>
                    {t(e)}
                    <small>{["12:40", "12:10", "11:20"][i]} · DEMO</small>
                  </div>
                </li>
              ),
            )}
          </ol>
        </Card>
        <Card title={t("storeStatus")}>
          <div className="va-store-state">
            <span className="va-badge va-warning">{t("commerceOff")}</span>
            <code>COMMERCE_ENABLED=0</code>
            <p>
              <Icon name="staff" size={16} />
              {t("isolated")}
            </p>
            <small>{t("localOnly")}</small>
          </div>
        </Card>
      </div>
    </>
  );
}
export function ProductsScreen({
  locale,
  query,
  products,
  setProducts,
}: {
  locale: Locale;
  query: string;
  products: DemoProduct[];
  setProducts: (p: DemoProduct[]) => void;
}) {
  const [category, setCategory] = useState("all"),
    [sort, setSort] = useState<ProductSort>("nameSort"),
    [draft, setDraft] = useState<DemoProduct | null>(null),
    [error, setError] = useState(false),
    [tab, setTab] = useState<"product" | "variants" | "images">("product");
  const t = (key: MessageKey) => translate(locale, key),
    filtered = filterProducts(products, query, category, sort, locale);
  function edit(p: DemoProduct) {
    setDraft(structuredClone(p));
    setError(false);
    setTab("product");
  }
  return (
    <>
      <PageTitle
        title={t("products")}
        subtitle={t("demoWarning")}
        action={
          <Button
            primary
            onClick={() =>
              edit({
                ...structuredClone(initialProducts[0]!),
                id: `demo-new-${products.length}`,
                name: { ru: "", uz: "" },
                sku: "",
                stock: 0,
                status: "DRAFT",
              })
            }
          >
            <Icon name="plus" />
            {t("addProduct")}
          </Button>
        }
      />
      <Card>
        <div className="va-toolbar">
          <label>
            {t("category")}
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
            >
              {(["all", "stationery", "clothing", "care"] as const).map((c) => (
                <option key={c} value={c}>
                  {t(c)}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t("sort")}
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as ProductSort)}
            >
              {(["nameSort", "priceSort", "stockSort"] as const).map((s) => (
                <option key={s} value={s}>
                  {t(s)}
                </option>
              ))}
            </select>
          </label>
        </div>
        <Table
          locale={locale}
          count={filtered.length}
          headers={[
            t("product"),
            t("category"),
            t("price"),
            "SKU",
            t("quantity"),
            t("preorder"),
            t("publication"),
            t("actions"),
          ]}
        >
          {filtered.map((p) => (
            <tr key={p.id}>
              <td>
                <button className="va-product-cell" onClick={() => edit(p)}>
                  <img src={assets[p.image]} alt="" />
                  <span>
                    <strong>{p.name[locale]}</strong>
                    <small lang={locale === "ru" ? "uz" : "ru"}>
                      {p.name[locale === "ru" ? "uz" : "ru"]}
                    </small>
                  </span>
                </button>
              </td>
              <td>{t(p.category)}</td>
              <td className="va-money">{money(p.price, locale)}</td>
              <td>
                <code>{p.sku}</code>
              </td>
              <td>
                <span className={p.stock < 5 ? "va-stock-low" : ""}>
                  {p.stock}
                </span>
              </td>
              <td>{t(p.preorderEnabled ? "yes" : "no")}</td>
              <td>
                <Badge locale={locale} value={p.status} />
              </td>
              <td>
                <Button
                  onClick={() => edit(p)}
                  aria-label={`${t("edit")} ${p.name[locale]}`}
                >
                  <Icon name="chevron" />
                </Button>
              </td>
            </tr>
          ))}
        </Table>
      </Card>
      {draft && (
        <Drawer
          title={draft.name[locale] || t("addProduct")}
          locale={locale}
          onClose={() => setDraft(null)}
        >
          <p className="va-notice">{t("previewOnly")}</p>
          <div className="va-filters">
            {(["product", "variants", "images"] as const).map((v) => (
              <Button
                key={v}
                aria-pressed={tab === v}
                onClick={() => setTab(v)}
              >
                {t(v)}
              </Button>
            ))}
          </div>
          <form
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              try {
                setProducts(saveProduct(products, draft));
                setDraft(null);
              } catch {
                setError(true);
              }
            }}
          >
            {tab === "product" ? (
              <>
                <Input
                  label={t("nameRu")}
                  lang="ru"
                  value={draft.name.ru}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      name: { ...draft.name, ru: e.target.value },
                    })
                  }
                  maxLength={250}
                />
                <Input
                  label={t("nameUz")}
                  lang="uz"
                  value={draft.name.uz}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      name: { ...draft.name, uz: e.target.value },
                    })
                  }
                  maxLength={250}
                />
                <label className="va-field">
                  {t("category")}
                  <select
                    value={draft.category}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        category: e.target.value as DemoProduct["category"],
                      })
                    }
                  >
                    {(["stationery", "clothing", "care"] as const).map((c) => (
                      <option key={c} value={c}>
                        {t(c)}
                      </option>
                    ))}
                  </select>
                </label>
                <Input
                  label={t("price")}
                  type="number"
                  min={1}
                  step={1}
                  value={draft.price}
                  onChange={(e) =>
                    setDraft({ ...draft, price: e.target.valueAsNumber })
                  }
                />
                <label className="va-field">
                  {t("publication")}
                  <select
                    value={draft.status}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        status: e.target.value as DemoProduct["status"],
                      })
                    }
                  >
                    {(["ACTIVE", "DRAFT", "INACTIVE"] as const).map((s) => (
                      <option key={s} value={s}>
                        {t(s)}
                      </option>
                    ))}
                  </select>
                </label>
              </>
            ) : tab === "variants" ? (
              <>
                <Input
                  label="SKU"
                  value={draft.sku}
                  onChange={(e) => setDraft({ ...draft, sku: e.target.value })}
                  maxLength={64}
                />
                <Input
                  label={t("quantity")}
                  type="number"
                  min={0}
                  step={1}
                  value={draft.stock}
                  onChange={(e) =>
                    setDraft({ ...draft, stock: e.target.valueAsNumber })
                  }
                />
                <label className="va-check">
                  <input
                    type="checkbox"
                    checked={draft.preorderEnabled}
                    onChange={(e) =>
                      setDraft({ ...draft, preorderEnabled: e.target.checked })
                    }
                  />
                  {t("preorder")}
                </label>
                <p className="va-muted">
                  {t("price")}: {money(draft.price, locale)}
                </p>
                <dl className="va-summary">
                  {draft.attributes.map((a) => (
                    <div key={a.label}>
                      <dt>{t(a.label)}</dt>
                      <dd>
                        {a.translated ? t(a.value as MessageKey) : a.value}
                      </dd>
                    </div>
                  ))}
                </dl>
              </>
            ) : (
              <>
                <img
                  className="va-product-preview"
                  src={assets[draft.image]}
                  alt={draft.name[locale]}
                />
                <p className="va-muted">{t("uploadLater")}</p>
              </>
            )}
            {error && (
              <p className="va-error" role="alert">
                {t("invalidProduct")}
              </p>
            )}
            <div className="va-actions">
              <Button onClick={() => setDraft(null)}>{t("cancel")}</Button>
              <Button primary type="submit">
                {t("save")}
              </Button>
            </div>
          </form>
        </Drawer>
      )}
    </>
  );
}
export function PaymentsScreen({
  locale,
  claims,
  open,
}: {
  locale: Locale;
  claims: DemoClaim[];
  open: (c: DemoClaim) => void;
}) {
  const [filter, setFilter] = useState<"all" | DemoClaim["status"]>("all"),
    t = (key: MessageKey) => translate(locale, key),
    filtered = claims.filter((c) => filter === "all" || c.status === filter);
  return (
    <>
      <PageTitle title={t("payments")} subtitle={t("ownerOnly")} />
      <Card>
        <div className="va-filters">
          {(["all", "SUBMITTED", "APPROVED", "REJECTED"] as const).map((s) => (
            <Button
              key={s}
              aria-pressed={filter === s}
              onClick={() => setFilter(s)}
            >
              {t(s)}
            </Button>
          ))}
        </div>
        <Table
          locale={locale}
          count={filtered.length}
          headers={[
            t("order"),
            t("buyer"),
            t("phase"),
            t("amount"),
            t("date"),
            t("status"),
            t("attempt"),
            t("actions"),
          ]}
        >
          {filtered.map((c) => (
            <tr key={c.id}>
              <td>
                <button className="va-text-button" onClick={() => open(c)}>
                  {c.orderId}
                </button>
              </td>
              <td>
                {t("syntheticBuyer")}{" "}
                {orders.find((o) => o.id === c.orderId)?.buyer}
              </td>
              <td>
                <code>{c.phase}</code>
              </td>
              <td className="va-money">{money(c.amount, locale)}</td>
              <td className="va-nowrap">{dateTime(c.submitted, locale)}</td>
              <td>
                <Badge locale={locale} value={c.status} />
              </td>
              <td>{c.attempt} / 3</td>
              <td>
                <Button
                  onClick={() => open(c)}
                  aria-label={`${t("details")} ${c.orderId} ${c.phase}`}
                >
                  <Icon name="chevron" />
                </Button>
              </td>
            </tr>
          ))}
        </Table>
      </Card>
    </>
  );
}
export function PaymentDetails({
  claim,
  locale,
  onClose,
  decide,
  openOrder,
}: {
  claim: DemoClaim;
  locale: Locale;
  onClose: () => void;
  decide: (c: DemoClaim, d: "APPROVED" | "REJECTED") => void;
  openOrder: (o: DemoOrder) => void;
}) {
  const t = (key: MessageKey) => translate(locale, key),
    order = orders.find((o) => o.id === claim.orderId)!;
  return (
    <Drawer
      title={`${claim.orderId} · ${claim.phase}`}
      locale={locale}
      onClose={onClose}
    >
      <p className="va-notice">{t("ownerOnly")}</p>
      <Badge locale={locale} value={claim.status} />
      <dl className="va-summary">
        <div>
          <dt>{t("obligation")}</dt>
          <dd>{money(claim.amount, locale)}</dd>
        </div>
        <div>
          <dt>{t("date")}</dt>
          <dd>{dateTime(claim.submitted, locale)}</dd>
        </div>
        <div>
          <dt>{t("attempt")}</dt>
          <dd>{claim.attempt} / 3</dd>
        </div>
      </dl>
      <h3>{t("proof")}</h3>
      <img className="va-proof" src={proof} alt={t("proof")} />
      <h3>{t("decisions")}</h3>
      {claim.history.length ? (
        claim.history.map((d, i) => (
          <p key={i}>
            {t("demoDecision")} · <Badge locale={locale} value={d} />
          </p>
        ))
      ) : (
        <p className="va-muted">{t("noDecision")}</p>
      )}
      <Button onClick={() => openOrder(order)}>
        {t("orderLink")}
        <Icon name="chevron" />
      </Button>
      <div className="va-actions">
        <Button
          primary
          disabled={claim.status !== "SUBMITTED"}
          onClick={() => decide(claim, "APPROVED")}
        >
          {t("approve")}
        </Button>
        <Button
          disabled={claim.status !== "SUBMITTED"}
          onClick={() => decide(claim, "REJECTED")}
        >
          {t("reject")}
        </Button>
      </div>
      <p className="va-muted">{t("previewOnly")}</p>
    </Drawer>
  );
}
export function PromosScreen({ locale }: { locale: Locale }) {
  const [selected, setSelected] = useState<(typeof promos)[number] | null>(
      null,
    ),
    t = (key: MessageKey) => translate(locale, key);
  return (
    <>
      <PageTitle title={t("promos")} subtitle={t("promoNote")} />
      <Card>
        <Table
          locale={locale}
          count={promos.length}
          headers={[
            t("code"),
            t("promoType"),
            t("promoDiscount"),
            t("mode"),
            t("limit"),
            t("uses"),
            t("status"),
            t("expiry"),
            t("actions"),
          ]}
        >
          {promos.map((p) => (
            <tr key={p.code}>
              <td>
                <button
                  className="va-text-button"
                  onClick={() => setSelected(p)}
                >
                  {p.code}
                </button>
              </td>
              <td>
                <code>{p.type}</code>
              </td>
              <td>
                {typeof p.discount === "number"
                  ? money(p.discount, locale)
                  : p.discount}
              </td>
              <td>
                <code>{p.mode}</code>
              </td>
              <td>{p.limit}</td>
              <td>{p.uses}</td>
              <td>
                <Badge locale={locale} value="ACTIVE" />
              </td>
              <td>31.12.2026</td>
              <td>
                <Button
                  onClick={() => setSelected(p)}
                  aria-label={`${t("details")} ${p.code}`}
                >
                  <Icon name="chevron" />
                </Button>
              </td>
            </tr>
          ))}
        </Table>
      </Card>
      <p className="va-muted">{t("percentRule")}</p>
      {selected && (
        <Drawer
          title={selected.code}
          locale={locale}
          onClose={() => setSelected(null)}
        >
          <p className="va-notice">{t("promoNote")}</p>
          <h3>{t("rules")}</h3>
          <p>{t("percentRule")}</p>
          <Input label={t("code")} value={selected.code} readOnly />
          <Input label={t("promoType")} value={selected.type} readOnly />
          <Input
            label={t("promoDiscount")}
            value={String(selected.discount)}
            readOnly
          />
          <Input
            label={t("minPurchase")}
            value={money(selected.min, locale)}
            readOnly
          />
          <Input label={t("scope")} value={t("noScope")} readOnly />
          {selected.personal && (
            <Input label={t("personal")} value={selected.personal} readOnly />
          )}
          {selected.campaign && (
            <Input label={t("blogger")} value={selected.campaign} readOnly />
          )}
          <p className="va-muted">{t("previewOnly")}</p>
        </Drawer>
      )}
    </>
  );
}
