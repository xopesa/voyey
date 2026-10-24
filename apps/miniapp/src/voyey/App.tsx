import { useEffect, useState, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import type { SaleMode } from "@stenzo/shared";
import { useRouter, useSearchParams } from "../spa/navigation";
import { assets } from "./assets";
import {
  categories,
  products,
  type DemoProduct,
  type DemoVariant,
} from "./fixtures";
import {
  addToCart,
  applyPromo,
  changeQuantity,
  checkout,
  deadline,
  defaultFilters,
  DemoError,
  filterProducts,
  initialState,
  item,
  modes,
  removeRow,
  reviewReceipt,
  submitReceipt,
  summary,
  type CatalogFilters,
  type DemoOrder,
  type DemoState,
  type Recipient,
} from "./domain";
import {
  localizedText,
  translator,
  type Locale,
  type Translator,
  type UiKey,
} from "./messages";
import {
  VoyeyBottomNav,
  VoyeyButton,
  VoyeyCategoryChip,
  VoyeyCheckoutSummary,
  VoyeyDialog,
  VoyeyEmptyState,
  VoyeyGlassSurface,
  VoyeyIcon,
  VoyeyIconButton,
  VoyeyLogo,
  VoyeyModeToggle,
  VoyeyPrice,
  VoyeyProductCard,
  VoyeyProductGallery,
  VoyeyPromoInput,
  VoyeyQuantityControl,
  VoyeySaleModeBadge,
  VoyeySearchBar,
  VoyeyVariantSelector,
} from "./components";
import "./styles.css";

const title = (p: DemoProduct, locale: Locale) =>
  localizedText(locale, { ru: p.nameRu, uz: p.nameUz });
function App() {
  const router = useRouter(),
    params = useSearchParams(),
    screen = params.get("screen") ?? "home";
  const [state, setState] = useState(initialState),
    [locale, setLocale] = useState<Locale>(() => {
      try {
        return localStorage.getItem("voyey.ui01.locale") === "uz" ? "uz" : "ru";
      } catch {
        return "ru";
      }
    }),
    [filters, setFilters] = useState<CatalogFilters>({ ...defaultFilters }),
    [modal, setModal] = useState<
      "filters" | "notifications" | "contact" | null
    >(null),
    [toast, setToast] = useState<UiKey | "">(""),
    [keyboard, setKeyboard] = useState(false),
    [slide, setSlide] = useState(0),
    [clockOffset, setClockOffset] = useState(0);
  const t = translator(locale),
    mode: SaleMode =
      params.get("mode") === "PREORDER" ? "PREORDER" : "IN_STOCK";
  const go = (s: string, extra: Record<string, string> = {}) => {
    router.push(
      `/voyey-demo.html?${new URLSearchParams({ screen: s, ...extra })}`,
    );
    window.scrollTo(0, 0);
  };
  useEffect(() => {
    document.documentElement.lang = locale;
    try {
      localStorage.setItem("voyey.ui01.locale", locale);
    } catch {
      /* Storage can be unavailable in embedded browsers. */
    }
  }, [locale]);
  useEffect(() => {
    const viewport = window.visualViewport;
    const update = () =>
      setKeyboard(!!viewport && window.innerHeight - viewport.height > 140);
    viewport?.addEventListener("resize", update);
    return () => viewport?.removeEventListener("resize", update);
  }, []);
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(""), 4500);
    return () => clearTimeout(id);
  }, [toast]);
  const fail = (e: unknown) =>
    setToast(e instanceof DemoError ? `error.${e.code}` : "error.variant");
  const run = (fn: () => DemoState) => {
    try {
      setState(fn());
    } catch (e) {
      fail(e);
    }
  };
  const favorite = (id: string) =>
    setState((s) => ({
      ...s,
      favorites: s.favorites.includes(id)
        ? s.favorites.filter((x) => x !== id)
        : [...s.favorites, id],
    }));
  const quickAdd = (p: DemoProduct) => {
    if (p.category.requiresBuyerMeasurements) {
      go("product", { product: p.id });
      return;
    }
    const preferred =
      screen === "catalog" && filters.mode !== "ALL" ? filters.mode : null;
    const v = preferred
      ? p.variants.find(
          (v) =>
            (!filters.size || v.size === filters.size) &&
            modes(v, state.stock)[preferred],
        )
      : (p.variants.find((v) => modes(v, state.stock).IN_STOCK) ??
        p.variants.find((v) => modes(v, state.stock).PREORDER));
    if (!v) return;
    try {
      setState(
        addToCart(
          state,
          p.id,
          v.id,
          preferred ??
            (modes(v, state.stock).IN_STOCK ? "IN_STOCK" : "PREORDER"),
          1,
        ),
      );
      setToast("added");
    } catch (e) {
      fail(e);
    }
  };
  const cards = (list: DemoProduct[]) =>
    list.length ? (
      <div className="vy-grid">
        {list.map((p) => (
          <VoyeyProductCard
            key={p.id}
            product={p}
            state={state}
            locale={locale}
            t={t}
            preferredMode={
              screen === "catalog" && filters.mode !== "ALL"
                ? filters.mode
                : undefined
            }
            onOpen={() => go("product", { product: p.id })}
            onFavorite={() => favorite(p.id)}
            onAdd={() => quickAdd(p)}
          />
        ))}
      </div>
    ) : (
      <VoyeyEmptyState
        title={t("emptySearch")}
        text={t("emptySearchText")}
        t={t}
      />
    );
  const browse = () => {
    setFilters({ ...defaultFilters });
    go("catalog");
  };
  const counts = {
    IN_STOCK: state.cart
      .filter((r) => r.saleMode === "IN_STOCK")
      .reduce((n, r) => n + r.quantity, 0),
    PREORDER: state.cart
      .filter((r) => r.saleMode === "PREORDER")
      .reduce((n, r) => n + r.quantity, 0),
  };
  const search = (
    <VoyeySearchBar
      t={t}
      value={filters.query}
      onChange={(query) => setFilters((f) => ({ ...f, query }))}
      onSubmit={() => go("catalog")}
      placeholder={screen === "catalog" ? t("searchCatalog") : undefined}
    />
  );
  const categoryChips = (
    <div className="vy-chip-rail">
      <VoyeyCategoryChip
        selected={!filters.category}
        onClick={() => setFilters((f) => ({ ...f, category: "" }))}
      >
        {t("all")}
      </VoyeyCategoryChip>
      {categories.map((c) => (
        <VoyeyCategoryChip
          key={c.id}
          selected={filters.category === c.id}
          onClick={() => setFilters((f) => ({ ...f, category: c.id }))}
        >
          {localizedText(locale, { ru: c.nameRu, uz: c.nameUz })}
        </VoyeyCategoryChip>
      ))}
    </div>
  );
  const selectedProduct = products.find((p) => p.id === params.get("product"));
  const order = state.orders.find((o) => o.id === params.get("order"));
  let content: ReactNode;
  if (screen === "home")
    content = (
      <>
        {search}
        <section className={`vy-hero vy-hero-${slide}`}>
          <img
            src={assets[(["notebook", "pouch", "hoodie"] as const)[slide]!]}
            alt=""
          />
          <div className="vy-hero-copy">
            <h1>
              {t(
                slide === 0
                  ? "heroLead"
                  : slide === 1
                    ? "hero2Lead"
                    : "hero3Lead",
              )}{" "}
              <em>
                {t(
                  slide === 0
                    ? "heroAccent"
                    : slide === 1
                      ? "hero2Accent"
                      : "hero3Accent",
                )}
              </em>
            </h1>
            <p>
              {t(
                slide === 0
                  ? "heroText"
                  : slide === 1
                    ? "hero2Text"
                    : "hero3Text",
              )}
            </p>
            <VoyeyButton
              secondary
              onClick={() => {
                setFilters({
                  ...defaultFilters,
                  category:
                    slide === 0
                      ? "stationery"
                      : slide === 1
                        ? "home"
                        : "clothing",
                });
                go("catalog");
              }}
            >
              {t("openCatalog")}
              <VoyeyIcon name="arrow" size={17} />
            </VoyeyButton>
          </div>
          <div className="vy-dots">
            {[0, 1, 2].map((i) => (
              <button
                key={i}
                aria-label={t("slide", { n: i + 1 })}
                aria-pressed={i === slide}
                onClick={() => setSlide(i)}
              />
            ))}
          </div>
        </section>
        <div className="vy-categories">
          {categories.map((c) => (
            <button
              key={c.id}
              onClick={() => {
                setFilters({ ...defaultFilters, category: c.id });
                go("catalog");
              }}
            >
              <img src={assets[c.image]} alt="" />
              {localizedText(locale, { ru: c.nameRu, uz: c.nameUz })}
            </button>
          ))}
        </div>
        {(["popular", "new"] as const).map((key) => (
          <section className="vy-section" key={key}>
            <div className="vy-section-title">
              <h2>{t(key)}</h2>
              <button
                className="vy-text-button"
                onClick={() => {
                  setFilters({ ...defaultFilters, sort: key });
                  go("catalog");
                }}
              >
                {t("seeAll")}
                <VoyeyIcon name="arrow" size={15} />
              </button>
            </div>
            {cards(
              [...products]
                .sort((a, b) =>
                  key === "popular"
                    ? b.popularity - a.popularity
                    : a.newRank - b.newRank,
                )
                .slice(0, 4),
            )}
          </section>
        ))}
      </>
    );
  else if (screen === "catalog")
    content = (
      <>
        {search}
        {categoryChips}
        <div className="vy-toolbar">
          <label>
            {t("sort")}
            <select
              aria-label={t("sort")}
              value={filters.sort}
              onChange={(e) =>
                setFilters((f) => ({
                  ...f,
                  sort: e.target.value as CatalogFilters["sort"],
                }))
              }
            >
              {(["popular", "new", "priceAsc", "priceDesc"] as const).map(
                (v, i) => (
                  <option key={v} value={v}>
                    {t(
                      (
                        [
                          "sortPopular",
                          "sortNew",
                          "sortLow",
                          "sortHigh",
                        ] as const
                      )[i]!,
                    )}
                  </option>
                ),
              )}
            </select>
          </label>
          <VoyeyButton secondary onClick={() => setModal("filters")}>
            <VoyeyIcon name="filter" size={17} />
            {t("filters")}
          </VoyeyButton>
        </div>
        <p className="vy-caption" role="status">
          {t("results", { n: filterProducts(filters, state.stock).length })}
        </p>
        {cards(filterProducts(filters, state.stock))}
      </>
    );
  else if (screen === "product" && selectedProduct)
    content = (
      <Product
        key={selectedProduct.id}
        product={selectedProduct}
        state={state}
        locale={locale}
        t={t}
        onBack={() => go("catalog")}
        onFavorite={() => favorite(selectedProduct.id)}
        onAdd={(v, m, q, h, w) => {
          try {
            setState(addToCart(state, selectedProduct.id, v.id, m, q, h, w));
            setToast("added");
          } catch (e) {
            fail(e);
          }
        }}
      />
    );
  else if (screen === "favorites")
    content = state.favorites.length ? (
      cards(products.filter((p) => state.favorites.includes(p.id)))
    ) : (
      <VoyeyEmptyState
        icon="heart"
        title={t("emptyFavorites")}
        text={t("emptyFavoritesText")}
        onBrowse={browse}
        t={t}
      />
    );
  else if (screen === "cart") {
    const s = summary(state, mode),
      promo = state.promos[mode];
    content = (
      <div className="vy-narrow">
        <VoyeyModeToggle
          mode={mode}
          onChange={(m) => go("cart", { mode: m })}
          counts={counts}
          t={t}
        />
        {!s.rows.length ? (
          <VoyeyEmptyState
            title={t(state.cart.length ? "emptyTab" : "emptyCart")}
            text={t(state.cart.length ? "emptyTabText" : "emptyCartText")}
            onBrowse={browse}
            t={t}
          />
        ) : (
          <>
            <div className="vy-cart-rows">
              {s.rows.map((r) => {
                const { p, v } = item(r);
                return (
                  <article className="vy-cart-row" key={r.id}>
                    <button
                      className="vy-row-image"
                      onClick={() => go("product", { product: p.id })}
                    >
                      <img src={assets[p.image]} alt={title(p, locale)} />
                    </button>
                    <div className="vy-row-info">
                      <button
                        className="vy-product-name"
                        onClick={() => go("product", { product: p.id })}
                      >
                        {title(p, locale)}
                      </button>
                      <p className="vy-caption">
                        {localizedText(locale, { ru: v.nameRu, uz: v.nameUz })}
                      </p>
                      <VoyeyPrice amount={p.price} locale={locale} />
                      <VoyeyQuantityControl
                        value={r.quantity}
                        max={Math.min(
                          99 -
                            state.cart
                              .filter(
                                (x) =>
                                  x.variantId === r.variantId && x.id !== r.id,
                              )
                              .reduce((n, x) => n + x.quantity, 0),
                          mode === "IN_STOCK" ? (state.stock[v.id] ?? 0) : 99,
                        )}
                        onChange={(n) => run(() => changeQuantity(state, r, n))}
                        t={t}
                      />
                    </div>
                    <VoyeyIconButton
                      icon="trash"
                      label={`${t("remove")}: ${title(p, locale)}`}
                      onClick={() => setState(removeRow(state, r.id))}
                    />
                  </article>
                );
              })}
            </div>
            <VoyeyGlassSurface className="vy-cart-summary">
              <VoyeyPromoInput
                input={promo.input}
                applied={!!promo.applied}
                error={promo.error ? t(`error.${promo.error}`) : null}
                t={t}
                onChange={(input) =>
                  setState((s) => ({
                    ...s,
                    promos: {
                      ...s.promos,
                      [mode]: { input, applied: null, error: null },
                    },
                  }))
                }
                onApply={() => {
                  try {
                    setState(applyPromo(state, mode, promo.input));
                  } catch (e) {
                    setState((s) => ({
                      ...s,
                      promos: {
                        ...s.promos,
                        [mode]: {
                          ...promo,
                          applied: null,
                          error: e instanceof DemoError ? e.code : "promo",
                        },
                      },
                    }));
                  }
                }}
              />
              <VoyeyCheckoutSummary {...s} mode={mode} locale={locale} t={t} />
              <VoyeyButton
                className="vy-full"
                onClick={() => go("checkout", { mode })}
              >
                {t("checkout")}
                <VoyeyIcon name="arrow" size={18} />
              </VoyeyButton>
            </VoyeyGlassSurface>
          </>
        )}
      </div>
    );
  } else if (screen === "checkout")
    content = (
      <Checkout
        state={state}
        mode={mode}
        locale={locale}
        t={t}
        onEdit={() => go("cart", { mode })}
        onSubmit={(recipient, delivery, percent, terms) => {
          try {
            const result = checkout(
              state,
              mode,
              recipient,
              delivery,
              percent,
              terms,
              Date.now() + clockOffset,
            );
            setState(result.state);
            go("payment", { order: result.order.id });
          } catch (e) {
            fail(e);
          }
        }}
      />
    );
  else if (screen === "payment" && order)
    content = (
      <Payment
        key={order.id}
        order={order}
        locale={locale}
        t={t}
        offset={clockOffset}
        onOffset={setClockOffset}
        onChange={(updated) =>
          setState((s) => ({
            ...s,
            orders: s.orders.map((o) => (o.id === updated.id ? updated : o)),
          }))
        }
        onError={fail}
      />
    );
  else if (screen === "profile")
    content = (
      <div className="vy-narrow vy-profile">
        <VoyeyLogo symbol />
        <h1>{t("profileTitle")}</h1>
        <p>{t("profileText")}</p>
        <section className="vy-panel">
          <h2>{t("language")}</h2>
          <div className="vy-segmented">
            {(["ru", "uz"] as const).map((l) => (
              <button
                key={l}
                aria-pressed={locale === l}
                className={locale === l ? "is-selected" : ""}
                onClick={() => setLocale(l)}
              >
                {t(l === "ru" ? "russian" : "uzbek")}
              </button>
            ))}
          </div>
        </section>
        <section className="vy-panel">
          <h2>{t("orders")}</h2>
          {!state.orders.length ? (
            <p className="vy-caption">{t("noOrders")}</p>
          ) : (
            state.orders.map((o) => (
              <button
                key={o.id}
                className="vy-order-link"
                onClick={() => go("payment", { order: o.id })}
              >
                <span>
                  {t("demoOrder", { id: o.id })}
                  <small>
                    {t(o.saleMode === "IN_STOCK" ? "inStock" : "preorder")}
                  </small>
                </span>
                <VoyeyIcon name="chevron" />
              </button>
            ))
          )}
        </section>
        <VoyeyButton secondary onClick={() => setModal("contact")}>
          {t("contact")}
        </VoyeyButton>
        <VoyeyButton
          secondary
          onClick={() => {
            setState(initialState());
            setClockOffset(0);
            setToast("resetDone");
          }}
        >
          {t("resetDemo")}
        </VoyeyButton>
      </div>
    );
  else
    content = (
      <VoyeyEmptyState
        title={t("emptyCart")}
        text={t("demoTerms")}
        onBrowse={browse}
        t={t}
      />
    );
  const pageTitle = t(
    screen === "checkout"
      ? "checkoutTitle"
      : screen === "payment"
        ? "paymentTitle"
        : screen === "catalog"
          ? "catalog"
          : screen === "cart"
            ? "cart"
            : screen === "favorites"
              ? "favorites"
              : "profile",
  );
  return (
    <div className="voyey-demo" data-keyboard={keyboard} data-screen={screen}>
      <div className="vy-shell">
        {screen !== "product" && (
          <header
            className={`vy-header ${screen === "home" ? "vy-home-header" : ""}`}
          >
            {screen === "home" ? (
              <VoyeyLogo />
            ) : (
              <>
                <VoyeyIconButton
                  icon="back"
                  label={t("back")}
                  onClick={() =>
                    go(
                      screen === "checkout" ? "cart" : "home",
                      screen === "checkout" ? { mode } : {},
                    )
                  }
                />
                <h1>{pageTitle}</h1>
              </>
            )}
            <div className="vy-header-actions">
              <VoyeyIconButton
                icon="search"
                label={t("search")}
                onClick={() => go("catalog")}
              />
              {screen === "home" && (
                <>
                  <VoyeyIconButton
                    icon="bell"
                    label={t("notifications")}
                    onClick={() => setModal("notifications")}
                  />
                  <VoyeyIconButton
                    icon="cart"
                    label={t("cart")}
                    onClick={() => go("cart")}
                  >
                    <span className="vy-count">
                      {counts.IN_STOCK + counts.PREORDER}
                    </span>
                  </VoyeyIconButton>
                </>
              )}
            </div>
          </header>
        )}
        <p className="vy-demo-label">{t("demo")}</p>
        <main id="vy-main">{content}</main>
      </div>
      <VoyeyBottomNav
        active={
          screen === "product"
            ? "catalog"
            : ["checkout", "payment"].includes(screen)
              ? "cart"
              : screen
        }
        onChange={go}
        count={counts.IN_STOCK + counts.PREORDER}
        t={t}
      />
      {toast && (
        <div className="vy-toast" role="status">
          {t(toast)}
        </div>
      )}
      {modal && (
        <VoyeyDialog
          title={t(
            modal === "filters"
              ? "filters"
              : modal === "notifications"
                ? "notificationsTitle"
                : "contact",
          )}
          onClose={() => setModal(null)}
          t={t}
        >
          {modal === "filters" ? (
            <FilterForm
              filters={filters}
              onApply={(f) => {
                setFilters(f);
                setModal(null);
              }}
              locale={locale}
              t={t}
            />
          ) : (
            <p>
              {t(
                modal === "notifications" ? "notificationsText" : "contactText",
              )}
            </p>
          )}
        </VoyeyDialog>
      )}
    </div>
  );
}

function FilterForm({
  filters,
  onApply,
  locale,
  t,
}: {
  filters: CatalogFilters;
  onApply: (f: CatalogFilters) => void;
  locale: Locale;
  t: Translator;
}) {
  const [f, set] = useState({ ...filters });
  return (
    <form
      className="vy-form"
      onSubmit={(e) => {
        e.preventDefault();
        onApply(f);
      }}
    >
      <label>
        {t("category")}
        <select
          value={f.category}
          onChange={(e) => set({ ...f, category: e.target.value })}
        >
          <option value="">{t("all")}</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {localizedText(locale, { ru: c.nameRu, uz: c.nameUz })}
            </option>
          ))}
        </select>
      </label>
      <label>
        {t("saleMode")}
        <select
          value={f.mode}
          onChange={(e) =>
            set({ ...f, mode: e.target.value as CatalogFilters["mode"] })
          }
        >
          <option value="ALL">{t("all")}</option>
          <option value="IN_STOCK">{t("inStock")}</option>
          <option value="PREORDER">{t("preorder")}</option>
        </select>
      </label>
      <fieldset>
        <legend>{t("priceRange")}</legend>
        <div className="vy-field-pair">
          <label>
            {t("from")}
            <input
              type="number"
              min="0"
              max={f.max}
              value={f.min}
              onChange={(e) => set({ ...f, min: Number(e.target.value) })}
            />
          </label>
          <label>
            {t("to")}
            <input
              type="number"
              min={f.min}
              max="100000000"
              value={f.max}
              onChange={(e) => set({ ...f, max: Number(e.target.value) })}
            />
          </label>
        </div>
      </fieldset>
      <label>
        {t("size")}
        <select
          value={f.size}
          onChange={(e) => set({ ...f, size: e.target.value })}
        >
          <option value="">{t("anySize")}</option>
          {[
            ...new Set(
              products.flatMap((p) =>
                p.variants.map((v) => v.size).filter(Boolean),
              ),
            ),
          ].map((size) => (
            <option key={size!}>{size}</option>
          ))}
        </select>
      </label>
      <VoyeyButton type="submit">{t("applyFilters")}</VoyeyButton>
      <VoyeyButton secondary onClick={() => set({ ...defaultFilters })}>
        {t("reset")}
      </VoyeyButton>
    </form>
  );
}

function Product({
  product: p,
  state,
  locale,
  t,
  onBack,
  onFavorite,
  onAdd,
}: {
  product: DemoProduct;
  state: DemoState;
  locale: Locale;
  t: Translator;
  onBack: () => void;
  onFavorite: () => void;
  onAdd: (
    v: DemoVariant,
    m: SaleMode,
    q: number,
    h: number | null,
    w: number | null,
  ) => void;
}) {
  const [v, setVariant] = useState(p.variants[0]!),
    [mode, setMode] = useState<SaleMode>(
      modes(v, state.stock).IN_STOCK ? "IN_STOCK" : "PREORDER",
    ),
    [q, setQ] = useState(1),
    [height, setHeight] = useState(""),
    [weight, setWeight] = useState("");
  const available = modes(v, state.stock),
    actualMode = available[mode]
      ? mode
      : available.IN_STOCK
        ? "IN_STOCK"
        : "PREORDER",
    attrs = { ...p.attributes, ...v.attributes };
  const max = Math.max(
    1,
    Math.min(
      99 -
        state.cart
          .filter((r) => r.variantId === v.id)
          .reduce((n, r) => n + r.quantity, 0),
      actualMode === "IN_STOCK" ? (state.stock[v.id] ?? 0) : 99,
    ),
  );
  return (
    <div className="vy-product-detail">
      <VoyeyProductGallery
        product={p}
        t={t}
        onBack={onBack}
        favorite={state.favorites.includes(p.id)}
        onFavorite={onFavorite}
        locale={locale}
      />
      <div className="vy-product-info">
        <div className="vy-title-badge">
          <h1>{title(p, locale)}</h1>
          <VoyeySaleModeBadge
            mode={available[actualMode] ? actualMode : null}
            t={t}
          />
        </div>
        <VoyeyPrice amount={p.price} locale={locale} large />
        <VoyeyVariantSelector
          variants={p.variants}
          selected={v}
          onChange={(next) => {
            setVariant(next);
            setQ(1);
          }}
          t={t}
          locale={locale}
        />
        <VoyeyModeToggle
          mode={actualMode}
          onChange={(m) => {
            setMode(m);
            setQ(1);
          }}
          available={available}
          t={t}
        />
        <p className="vy-caption">
          {t(actualMode === "IN_STOCK" ? "stockHint" : "preorderHint", {
            n: state.stock[v.id] ?? 0,
          })}
        </p>
        {p.category.requiresBuyerMeasurements && (
          <fieldset className="vy-measurements">
            <legend>{t("measurements")}</legend>
            <div className="vy-field-pair">
              <label>
                {t("height")}
                <input
                  type="number"
                  min="50"
                  max="250"
                  inputMode="numeric"
                  value={height}
                  onChange={(e) => setHeight(e.target.value)}
                />
              </label>
              <label>
                {t("weight")}
                <input
                  type="number"
                  min="10"
                  max="300"
                  inputMode="decimal"
                  value={weight}
                  onChange={(e) => setWeight(e.target.value)}
                />
              </label>
            </div>
          </fieldset>
        )}
        <details className="vy-accordion" open>
          <summary>{t("features")}</summary>
          <dl>
            {Object.entries(attrs).map(([key, value]) => (
              <div key={key}>
                <dt>
                  {localizedText(
                    locale,
                    p.attributeLabels[key] ?? { ru: key, uz: key },
                  )}
                </dt>
                <dd>
                  {value === "Paper"
                    ? t("materialPaper")
                    : value === "Cotton"
                      ? t("materialCotton")
                      : value === "Fabric"
                        ? t("materialFabric")
                        : String(value)}
                </dd>
              </div>
            ))}
          </dl>
        </details>
        <details className="vy-accordion">
          <summary>{t("description")}</summary>
          <p>
            {localizedText(locale, {
              ru: p.descriptionRu,
              uz: p.descriptionUz,
            })}
          </p>
        </details>
        <details className="vy-accordion">
          <summary>{t("deliveryReturns")}</summary>
          <p>{t("deliveryText")}</p>
        </details>
        <p className="vy-caption">{t("photoSource")}</p>
      </div>
      <div className="vy-buy-bar vy-glass">
        <VoyeyQuantityControl
          value={Math.min(q, max)}
          max={max}
          onChange={setQ}
          t={t}
        />
        <VoyeyButton
          disabled={!available[actualMode]}
          onClick={() =>
            onAdd(
              v,
              actualMode,
              Math.min(q, max),
              height ? Number(height) : null,
              weight ? Number(weight) : null,
            )
          }
        >
          <VoyeyIcon name="cart" size={20} />
          {t("add")}
        </VoyeyButton>
      </div>
    </div>
  );
}

function Checkout({
  state,
  mode,
  locale,
  t,
  onEdit,
  onSubmit,
}: {
  state: DemoState;
  mode: SaleMode;
  locale: Locale;
  t: Translator;
  onEdit: () => void;
  onSubmit: (
    r: Recipient,
    d: "pickup" | "local",
    p: 50 | 100,
    terms: boolean,
  ) => void;
}) {
  const [recipient, setRecipient] = useState<Recipient>({
      fullName: "",
      phone: "",
      city: "",
      address: "",
      apartment: null,
      comment: null,
    }),
    [delivery, setDelivery] = useState<"pickup" | "local">("pickup"),
    [percent, setPercent] = useState<50 | 100>(50),
    [terms, setTerms] = useState(false),
    s = summary(state, mode);
  if (!s.rows.length)
    return (
      <VoyeyEmptyState title={t("emptyTab")} text={t("emptyTabText")} t={t} />
    );
  return (
    <form
      className="vy-checkout vy-narrow vy-form"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(
          recipient,
          delivery,
          mode === "IN_STOCK" ? 100 : percent,
          terms,
        );
      }}
    >
      <section className="vy-panel">
        <div className="vy-section-title">
          <h2>
            {t("selectedGoods", {
              mode: t(mode === "IN_STOCK" ? "inStock" : "preorder"),
            })}
          </h2>
          <button type="button" className="vy-text-button" onClick={onEdit}>
            {t("edit")}
          </button>
        </div>
        {s.rows.map((r) => (
          <div key={r.id} className="vy-checkout-line">
            <span>
              {title(item(r).p, locale)} × {r.quantity}
            </span>
            <VoyeyPrice amount={item(r).p.price * r.quantity} locale={locale} />
          </div>
        ))}
      </section>
      <fieldset className="vy-panel">
        <legend>{t("delivery")}</legend>
        <div className="vy-field-pair">
          {(["pickup", "local"] as const).map((d) => (
            <label className="vy-radio" key={d}>
              <input
                type="radio"
                name="delivery"
                checked={delivery === d}
                onChange={() => setDelivery(d)}
              />
              {t(d === "pickup" ? "pickup" : "localDelivery")}
            </label>
          ))}
        </div>
        <p className="vy-caption">
          {t(delivery === "pickup" ? "pickupHint" : "localHint")}
        </p>
      </fieldset>
      <fieldset className="vy-panel vy-form">
        <legend>{t("recipient")}</legend>
        <p className="vy-caption">{t("contactHint")}</p>
        {(["fullName", "phone", "city", "address", "comment"] as const).map(
          (key) => (
            <label key={key}>
              {t(key)}
              <input
                required={key !== "comment"}
                type={key === "phone" ? "tel" : "text"}
                autoComplete="off"
                maxLength={key === "comment" ? 500 : 200}
                value={recipient[key] ?? ""}
                onChange={(e) =>
                  setRecipient({ ...recipient, [key]: e.target.value })
                }
              />
            </label>
          ),
        )}
      </fieldset>
      <fieldset className="vy-panel">
        <legend>{t("paymentMethod")}</legend>
        <div className="vy-payment-option">
          <VoyeyIcon name="card" />
          <strong>{t("manualCard")}</strong>
          <VoyeyIcon name="check" size={18} />
        </div>
        <p className="vy-caption">{t("manualHint")}</p>
        {mode === "PREORDER" && (
          <>
            <div className="vy-segmented">
              {([50, 100] as const).map((p) => (
                <button
                  type="button"
                  key={p}
                  aria-pressed={percent === p}
                  className={percent === p ? "is-selected" : ""}
                  onClick={() => setPercent(p)}
                >
                  {t(p === 50 ? "fifty" : "hundred")}
                </button>
              ))}
            </div>
            <p className="vy-caption">{t("cargoHint")}</p>
          </>
        )}
      </fieldset>
      <VoyeyCheckoutSummary
        {...s}
        mode={mode}
        locale={locale}
        t={t}
        percent={mode === "IN_STOCK" ? 100 : percent}
      />
      <label className="vy-terms">
        <input
          type="checkbox"
          checked={terms}
          onChange={(e) => setTerms(e.target.checked)}
        />
        <span>
          {t("terms")}
          <small>{t("demoTerms")}</small>
        </span>
      </label>
      <VoyeyButton type="submit" className="vy-full">
        {t("goPayment")}
        <VoyeyIcon name="arrow" size={18} />
      </VoyeyButton>
    </form>
  );
}

function Payment({
  order: o,
  locale,
  t,
  offset,
  onOffset,
  onChange,
  onError,
}: {
  order: DemoOrder;
  locale: Locale;
  t: Translator;
  offset: number;
  onOffset: (n: number) => void;
  onChange: (o: DemoOrder) => void;
  onError: (e: unknown) => void;
}) {
  const [now, setNow] = useState(Date.now()),
    [file, setFile] = useState<{
      name: string;
      type: string;
      size: number;
      key: string;
    } | null>(null),
    [preview, setPreview] = useState<string | null>(null);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  useEffect(
    () => () => {
      if (preview) URL.revokeObjectURL(preview);
    },
    [preview],
  );
  const time = now + offset,
    pending = o.claims.some((c) => c.status === "SUBMITTED"),
    paid = o.claims.some((c) => c.status === "APPROVED"),
    expired = time >= deadline(o),
    exhausted = o.claims.length >= 3,
    remaining = Math.max(0, Math.ceil((deadline(o) - time) / 1000)),
    timer = [
      Math.floor(remaining / 3600),
      Math.floor((remaining % 3600) / 60),
      remaining % 60,
    ]
      .map((n) => String(n).padStart(2, "0"))
      .join(":"),
    blocked = pending || paid || expired || exhausted;
  const selectFile = async (f: File | undefined) => {
    if (!f) return;
    try {
      if (
        !["image/png", "image/jpeg", "image/webp"].includes(f.type) ||
        f.size > 5 * 1024 * 1024 ||
        f.size <= 0
      )
        throw new DemoError("file");
      const bitmap = await createImageBitmap(f);
      bitmap.close();
      setPreview(URL.createObjectURL(f));
      setFile({
        name: f.name,
        type: f.type,
        size: f.size,
        key: crypto.randomUUID(),
      });
    } catch {
      onError(new DemoError("file"));
    }
  };
  return (
    <div className="vy-payment vy-narrow">
      <p className="vy-eyebrow">{t("demoOrder", { id: o.id })}</p>
      <h2>{t("due")}</h2>
      <VoyeyPrice amount={o.firstAmount} locale={locale} large />
      <VoyeySaleModeBadge mode={o.saleMode} t={t} />
      <VoyeyGlassSurface className="vy-timer">
        <VoyeyIcon name="clock" />
        <span>
          {t(o.extensionAt ? "extension" : "window")}
          <strong aria-label={t("timeLeft")}>{timer}</strong>
          <small>
            {t("deadline", {
              time: new Intl.DateTimeFormat(
                locale === "ru" ? "ru-RU" : "uz-UZ",
                { dateStyle: "short", timeStyle: "short" },
              ).format(deadline(o)),
            })}
          </small>
        </span>
      </VoyeyGlassSurface>
      <p className="vy-caption">{t("paymentDemo")}</p>
      <div className="vy-panel">
        <VoyeyIcon name="card" />
        <h3>{t("bankDisabled")}</h3>
        <p>{t("manualHint")}</p>
      </div>
      {pending || paid ? (
        <div
          className={`vy-payment-status ${paid ? "vy-success" : ""}`}
          role="status"
        >
          <VoyeyIcon name={paid ? "check" : "clock"} />
          <h3>{t(paid ? "approved" : "pending")}</h3>
          <p>{t(paid ? "approvedHint" : "pendingHint")}</p>
        </div>
      ) : (
        <>
          {o.claims.length > 0 && <p className="vy-error">{t("rejected")}</p>}
          {expired && (
            <p className="vy-error" role="alert">
              {t("expired")}
            </p>
          )}
          {exhausted && <p className="vy-error">{t("exhausted")}</p>}
        </>
      )}
      <p>{t("attempts", { n: o.claims.length })}</p>
      <div className="vy-form">
        <label className={`vy-file ${blocked ? "is-disabled" : ""}`}>
          {t("chooseReceipt")}
          <input
            aria-label={t("chooseReceipt")}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            disabled={blocked}
            onChange={(e) => {
              void selectFile(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
        </label>
        <p className="vy-caption">{t("fileHint")}</p>
        {preview && (
          <img
            className="vy-receipt-preview"
            src={preview}
            alt={t("chooseReceipt")}
          />
        )}
        <VoyeyButton
          secondary
          disabled={blocked}
          onClick={() => {
            setPreview(null);
            setFile({
              name: "demo-receipt.png",
              type: "image/png",
              size: 100,
              key: crypto.randomUUID(),
            });
          }}
        >
          {t("testReceipt")}
        </VoyeyButton>
        {file && <p className="vy-caption">{file.name}</p>}
        <VoyeyButton
          disabled={blocked || !file}
          onClick={() => {
            if (!file) return;
            try {
              onChange(submitReceipt(o, file.key, file, time));
              setFile(null);
              setPreview(null);
            } catch (e) {
              onError(e);
            }
          }}
        >
          {t("submitReceipt")}
        </VoyeyButton>
      </div>
      {o.remaining > 0 && (
        <p>
          {t("remainder")}: <VoyeyPrice amount={o.remaining} locale={locale} />
        </p>
      )}
      {o.saleMode === "PREORDER" && (
        <p className="vy-caption">{t("cargoHint")}</p>
      )}
      <details className="vy-simulator">
        <summary>{t("simulator")}</summary>
        <p>{t("simulatorHint")}</p>
        <div className="vy-form">
          <VoyeyButton secondary onClick={() => onOffset(offset + 86400000)}>
            {t("simulateDay")}
          </VoyeyButton>
          <VoyeyButton
            secondary
            disabled={!pending}
            onClick={() => onChange(reviewReceipt(o, "APPROVED", time))}
          >
            {t("simulateApprove")}
          </VoyeyButton>
          <VoyeyButton
            secondary
            disabled={!pending}
            onClick={() => onChange(reviewReceipt(o, "REJECTED", time))}
          >
            {t("simulateReject")}
          </VoyeyButton>
          <VoyeyButton
            secondary
            onClick={() => onOffset(deadline(o) - Date.now() + 1000)}
          >
            {t("simulateEnd")}
          </VoyeyButton>
        </div>
      </details>
    </div>
  );
}
export function mountDemo() {
  const root = document.getElementById("root");
  if (root) createRoot(root).render(<App />);
}
