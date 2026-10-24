import { useEffect, useRef, useState, useId, type ReactNode } from "react";
import {
  AnimatePresence,
  LayoutGroup,
  motion,
  useIsPresent,
  type HTMLMotionProps,
} from "motion/react";
import { motionTokens, useVoyeyMotion, useVoyeyTransition } from "./motion";
import type { SaleMode } from "@stenzo/shared";
import { assets } from "./assets";
import { modes, type DemoState } from "./domain";
import type { DemoProduct, DemoVariant } from "./fixtures";
import {
  localizedText,
  translator,
  type Locale,
  type Translator,
} from "./messages";

export type IconName =
  | "home"
  | "search"
  | "heart"
  | "cart"
  | "profile"
  | "bell"
  | "back"
  | "arrow"
  | "close"
  | "plus"
  | "minus"
  | "filter"
  | "chevron"
  | "trash"
  | "card"
  | "check"
  | "clock"
  | "bag"
  | "receipt"
  | "download"
  | "share";
const paths: Record<IconName, string> = {
  receipt: "M5 3h14v18l-3-2-4 2-4-2-3 2ZM8 7h8M8 11h8M8 15h5",
  download: "M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5",
  share: "M12 15V3m-5 5 5-5 5 5M5 12v9h14v-9",
  home: "m3 10 9-7 9 7v10H15v-7H9v7H3Z",
  search: "M20 20l-5-5m2-5a7 7 0 1 1-14 0 7 7 0 0 1 14 0",
  heart:
    "M20.8 4.8a5.4 5.4 0 0 0-7.6 0L12 6l-1.2-1.2a5.4 5.4 0 1 0-7.6 7.6L12 21l8.8-8.6a5.4 5.4 0 0 0 0-7.6Z",
  cart: "M2 3h3l2.5 12h11l3-9H6M9 20h.01M18 20h.01",
  profile:
    "M20 21v-2a6 6 0 0 0-6-6h-4a6 6 0 0 0-6 6v2M16 6a4 4 0 1 1-8 0 4 4 0 0 1 8 0",
  bell: "M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4",
  back: "m14 5-7 7 7 7",
  arrow: "M4 12h16m-6-6 6 6-6 6",
  close: "m6 6 12 12M18 6 6 18",
  plus: "M12 5v14M5 12h14",
  minus: "M5 12h14",
  filter: "M4 6h16M4 12h16M4 18h16M8 3v6m8 0v6m-6 0v6",
  chevron: "m9 5 7 7-7 7",
  trash: "M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7",
  card: "M3 4h18v16H3ZM3 9h18M6 15h4",
  check: "m5 12 4 4L19 6",
  clock: "M12 7v5l3 2m6-2a9 9 0 1 1-18 0 9 9 0 0 1 18 0",
  bag: "M5 7h14l2 14H3ZM8 8V6a4 4 0 0 1 8 0v2",
};
export function VoyeyIcon({
  name,
  size = 21,
}: {
  name: IconName;
  size?: number;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[name]} />
    </svg>
  );
}
export function VoyeyButton({
  children,
  secondary = false,
  loading = false,
  ...props
}: Omit<HTMLMotionProps<"button">, "children"> & {
  children?: ReactNode;
  secondary?: boolean;
  loading?: boolean;
}) {
  const { reduced } = useVoyeyMotion(),
    transition = useVoyeyTransition(motionTokens.tap);
  return (
    <motion.button
      whileTap={reduced ? undefined : { scale: 0.98 }}
      transition={transition}
      {...props}
      type={props.type ?? "button"}
      disabled={props.disabled || loading}
      aria-busy={loading || undefined}
      className={`vy-button ${secondary ? "vy-secondary" : ""} ${props.className ?? ""}`}
    >
      {loading ? (
        <motion.span
          className="vy-spinner"
          animate={{ rotate: reduced ? 0 : 360 }}
          transition={{
            duration: 0.7,
            repeat: reduced ? 0 : Infinity,
            ease: "linear",
          }}
        />
      ) : (
        children
      )}
    </motion.button>
  );
}
export function VoyeyIconButton({
  icon,
  label,
  active = false,
  ...props
}: Omit<HTMLMotionProps<"button">, "children"> & {
  children?: ReactNode;
  icon: IconName;
  label: string;
  active?: boolean;
}) {
  const { reduced } = useVoyeyMotion(),
    transition = useVoyeyTransition(motionTokens.tap);
  return (
    <motion.button
      whileTap={reduced ? undefined : { scale: 0.96 }}
      animate={{
        color: icon === "heart" ? (active ? "#d31532" : "#526078") : undefined,
      }}
      transition={transition}
      {...props}
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={props["aria-pressed"]}
      className={`vy-icon-button ${active ? "is-active" : ""} ${props.className ?? ""}`}
    >
      <VoyeyIcon name={icon} />
      {props.children}
    </motion.button>
  );
}
export function VoyeyGlassSurface({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={`vy-glass ${className}`}>{children}</div>;
}
export function VoyeyLogo({ symbol = false }: { symbol?: boolean }) {
  return (
    <span className={symbol ? "vy-symbol" : "vy-logo"}>
      <img src={symbol ? assets.symbol : assets.logo} alt="VOYEY" />
    </span>
  );
}
export function VoyeyPrice({
  amount,
  locale,
  large = false,
}: {
  amount: number;
  locale: Locale;
  large?: boolean;
}) {
  return (
    <motion.span
      key={amount}
      initial={{ opacity: 0.55 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.16 }}
      className={`vy-price ${large ? "vy-price-large" : ""}`}
    >
      {new Intl.NumberFormat(locale === "ru" ? "ru-RU" : "uz-UZ").format(
        amount,
      )}{" "}
      <span className="vy-currency">{translator(locale)("unit")}</span>
    </motion.span>
  );
}
export function VoyeySaleModeBadge({
  mode,
  t,
}: {
  mode: SaleMode | null;
  t: Translator;
}) {
  return (
    <span
      className={`vy-badge ${mode === "PREORDER" ? "vy-preorder" : mode === null ? "vy-unavailable" : ""}`}
    >
      {t(
        mode === "IN_STOCK"
          ? "inStock"
          : mode === "PREORDER"
            ? "preorder"
            : "unavailable",
      )}
    </span>
  );
}
export function VoyeySearchBar({
  value,
  onChange,
  onSubmit,
  placeholder,
  t,
}: {
  value: string;
  onChange: (s: string) => void;
  onSubmit?: () => void;
  placeholder?: string;
  t: Translator;
}) {
  return (
    <form
      className="vy-search vy-glass"
      role="search"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit?.();
      }}
    >
      <VoyeyIcon name="search" size={19} />
      <input
        type="search"
        maxLength={200}
        aria-label={t("search")}
        placeholder={placeholder ?? t("searchPlaceholder")}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      {value && (
        <VoyeyIconButton
          icon="close"
          label={t("reset")}
          onClick={() => onChange("")}
        />
      )}
    </form>
  );
}
export function VoyeyCategoryChip({
  children,
  selected,
  onClick,
}: {
  children: ReactNode;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      className={`vy-chip ${selected ? "is-selected" : ""}`}
      type="button"
      aria-pressed={selected}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
export function VoyeyQuantityControl({
  value,
  onChange,
  max = 99,
  t,
}: {
  value: number;
  onChange: (n: number) => void;
  max?: number;
  t: Translator;
}) {
  const { reduced } = useVoyeyMotion();
  return (
    <div
      className="vy-quantity vy-glass"
      role="group"
      aria-label={t("quantity")}
    >
      <VoyeyIconButton
        icon="minus"
        label={t("decrease")}
        disabled={value <= 1}
        onClick={() => onChange(value - 1)}
      />
      <output aria-live="polite">
        <AnimatePresence initial={false} mode="popLayout">
          <motion.span
            key={value}
            initial={{ opacity: 0, y: reduced ? 0 : 3 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: reduced ? 0 : -3 }}
            transition={{ duration: reduced ? 0.08 : motionTokens.tap }}
          >
            {value}
          </motion.span>
        </AnimatePresence>
      </output>
      <VoyeyIconButton
        icon="plus"
        label={t("increase")}
        disabled={value >= max}
        onClick={() => onChange(value + 1)}
      />
    </div>
  );
}
export function VoyeyModeToggle({
  mode,
  onChange,
  t,
  counts,
  available,
}: {
  mode: SaleMode;
  onChange: (m: SaleMode) => void;
  t: Translator;
  counts?: Record<SaleMode, number>;
  available?: Record<SaleMode, boolean>;
}) {
  const id = useId(),
    { reduced } = useVoyeyMotion();
  return (
    <LayoutGroup id={id}>
      <div
        className="vy-segmented vy-motion-segmented"
        role="group"
        aria-label={t("saleMode")}
      >
        {(["IN_STOCK", "PREORDER"] as const).map((m) => (
          <button
            type="button"
            key={m}
            disabled={available && !available[m]}
            aria-pressed={mode === m}
            className={mode === m ? "is-selected" : ""}
            onClick={() => onChange(m)}
          >
            {mode === m && (
              <motion.span
                aria-hidden="true"
                className="vy-mode-indicator"
                layoutId={reduced ? undefined : "mode"}
                transition={{
                  type: "spring",
                  duration: motionTokens.tab,
                  bounce: 0.03,
                }}
              />
            )}
            <span className="vy-segment-label">
              {t(m === "IN_STOCK" ? "inStock" : "preorder")}
              {counts ? ` (${counts[m]})` : ""}
            </span>
          </button>
        ))}
      </div>
    </LayoutGroup>
  );
}
export function VoyeyProductCard({
  product,
  state,
  locale,
  t,
  onOpen,
  onFavorite,
  onAdd,
  preferredMode,
}: {
  product: DemoProduct;
  state: DemoState;
  locale: Locale;
  t: Translator;
  onOpen: () => void;
  onFavorite: () => void;
  onAdd: () => void;
  preferredMode?: SaleMode;
}) {
  const { reduced } = useVoyeyMotion();
  const name = localizedText(locale, {
      ru: product.nameRu,
      uz: product.nameUz,
    }),
    stock = product.variants.some((v) => modes(v, state.stock).IN_STOCK),
    pre = product.variants.some((v) => modes(v, state.stock).PREORDER),
    fav = state.favorites.includes(product.id);
  return (
    <motion.article
      className="vy-product-card"
      initial={{ opacity: 0.3 }}
      animate={{ opacity: 1 }}
      whileTap={reduced ? undefined : { scale: 0.99 }}
      transition={{ duration: reduced ? 0.08 : 0.18 }}
    >
      <div className="vy-card-image">
        <button
          className="vy-image-link"
          type="button"
          onClick={onOpen}
          aria-label={name}
        >
          <img
            src={assets[product.image]}
            alt={name}
            loading="lazy"
            width="600"
            height="600"
          />
        </button>
        <VoyeySaleModeBadge
          mode={preferredMode ?? (stock ? "IN_STOCK" : pre ? "PREORDER" : null)}
          t={t}
        />
        <VoyeyIconButton
          className="vy-card-heart"
          icon="heart"
          active={fav}
          aria-pressed={fav}
          label={t(fav ? "favoriteRemove" : "favoriteAdd")}
          onClick={onFavorite}
        />
      </div>
      <div className="vy-card-body">
        <div className="vy-card-price">
          <VoyeyPrice amount={product.price} locale={locale} />
          <VoyeyIconButton
            className="vy-add-icon"
            icon="cart"
            label={`${t("addShort")}: ${name}`}
            disabled={!stock && !pre}
            onClick={onAdd}
          />
        </div>
        <button className="vy-product-name" onClick={onOpen}>
          {name}
        </button>
      </div>
    </motion.article>
  );
}
export function VoyeyBottomNav({
  active,
  onChange,
  count,
  t,
}: {
  active: string;
  onChange: (s: string) => void;
  count: number;
  t: Translator;
}) {
  const { reduced } = useVoyeyMotion(),
    instanceId = useId();
  return (
    <LayoutGroup id="voyey-navigation">
      <nav
        className="vy-bottom-nav vy-glass"
        aria-label="VOYEY"
        data-nav-instance={instanceId}
      >
        {(["home", "catalog", "favorites", "cart", "profile"] as const).map(
          (key) => (
            <motion.button
              whileTap={reduced ? undefined : { scale: 0.98 }}
              animate={{ color: active === key ? "#d31532" : "#657085" }}
              transition={{ duration: reduced ? 0.08 : motionTokens.tab }}
              type="button"
              key={key}
              aria-current={active === key ? "page" : undefined}
              onClick={() => onChange(key)}
              className={active === key ? "is-active" : ""}
            >
              {active === key && (
                <motion.span
                  className="vy-nav-indicator"
                  aria-hidden="true"
                  layoutId={reduced ? undefined : "active"}
                  transition={{
                    type: "spring",
                    duration: motionTokens.tab,
                    bounce: 0.03,
                  }}
                />
              )}
              <span className="vy-nav-icon">
                <VoyeyIcon
                  name={
                    key === "catalog"
                      ? "search"
                      : key === "favorites"
                        ? "heart"
                        : key
                  }
                />
                {key === "cart" && count > 0 && (
                  <span className="vy-count">{count}</span>
                )}
              </span>
              <span>{t(key)}</span>
            </motion.button>
          ),
        )}
      </nav>
    </LayoutGroup>
  );
}
export function VoyeyProductGallery({
  product,
  t,
  onBack,
  favorite,
  onFavorite,
  locale,
}: {
  product: DemoProduct;
  t: Translator;
  onBack: () => void;
  favorite: boolean;
  onFavorite: () => void;
  locale: Locale;
}) {
  const [photo, setPhoto] = useState(0);
  const name = localizedText(locale, {
    ru: product.nameRu,
    uz: product.nameUz,
  });
  return (
    <section className="vy-gallery" aria-label={t("gallery")}>
      <div className={`vy-main-photo vy-photo-${photo}`}>
        <AnimatePresence initial={false}>
          <motion.img
            key={photo}
            src={assets[product.image]}
            alt={name}
            width="800"
            height="800"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            style={{
              scale: photo === 0 ? 1 : photo === 1 ? 1.4 : 1.8,
              transformOrigin: photo === 1 ? "60% 40%" : "40% 70%",
            }}
          />
        </AnimatePresence>
        <div className="vy-gallery-actions">
          <VoyeyIconButton icon="back" label={t("back")} onClick={onBack} />
          <VoyeyIconButton
            icon="heart"
            active={favorite}
            aria-pressed={favorite}
            label={t(favorite ? "favoriteRemove" : "favoriteAdd")}
            onClick={onFavorite}
          />
        </div>
        <span className="vy-photo-counter">{photo + 1}/3</span>
      </div>
      <div className="vy-thumbnails">
        {[0, 1, 2].map((i) => (
          <button
            type="button"
            key={i}
            aria-label={t("photo", { n: i + 1 })}
            aria-pressed={photo === i}
            className={`${photo === i ? "is-selected" : ""} vy-thumb-${i}`}
            onClick={() => setPhoto(i)}
          >
            <img src={assets[product.image]} alt="" />
          </button>
        ))}
      </div>
    </section>
  );
}
export function VoyeyVariantSelector({
  variants,
  selected,
  onChange,
  t,
  locale,
}: {
  variants: DemoVariant[];
  selected: DemoVariant;
  onChange: (v: DemoVariant) => void;
  t: Translator;
  locale: Locale;
}) {
  return (
    <div className="vy-variants">
      <p className="vy-field-heading">
        {t(selected.color ? "color" : selected.size ? "size" : "variant")}{" "}
        <span>
          {localizedText(locale, { ru: selected.nameRu, uz: selected.nameUz })}
        </span>
      </p>
      <div className="vy-variant-options">
        {variants.map((v) => (
          <button
            key={v.id}
            type="button"
            aria-pressed={v.id === selected.id}
            aria-label={localizedText(locale, { ru: v.nameRu, uz: v.nameUz })}
            onClick={() => onChange(v)}
            className={`vy-variant ${v.id === selected.id ? "is-selected" : ""}`}
          >
            {v.colorHex && (
              <span
                className="vy-swatch"
                style={{ backgroundColor: v.colorHex }}
              />
            )}
            {v.size ||
              (!v.colorHex
                ? localizedText(locale, { ru: v.nameRu, uz: v.nameUz })
                : "")}
          </button>
        ))}
      </div>
    </div>
  );
}
export function VoyeyPromoInput({
  input,
  onChange,
  onApply,
  applied,
  error,
  t,
}: {
  input: string;
  onChange: (v: string) => void;
  onApply: () => void;
  applied: boolean;
  error: string | null;
  t: Translator;
}) {
  return (
    <div className="vy-promo">
      <div className="vy-promo-field">
        <input
          aria-label={t("promo")}
          value={input}
          placeholder={t("promo")}
          maxLength={32}
          autoCapitalize="characters"
          onChange={(e) => onChange(e.target.value)}
        />
        <VoyeyButton secondary onClick={onApply} disabled={!input.trim()}>
          {t("apply")}
        </VoyeyButton>
      </div>
      {error && (
        <p className="vy-error" role="alert">
          {error}
        </p>
      )}
      {applied && (
        <p className="vy-success" role="status">
          <VoyeyIcon name="check" size={15} />
          {t("promoSuccess")}
        </p>
      )}
      <details className="vy-promo-help">
        <summary>{t("promoPreliminary")}</summary>
        <p>{t("promoDemo")}</p>
      </details>
    </div>
  );
}
export function VoyeyCheckoutSummary({
  subtotal,
  discount,
  goodsTotal,
  mode,
  locale,
  t,
  percent = 100,
}: {
  subtotal: number;
  discount: number;
  goodsTotal: number;
  mode: SaleMode;
  locale: Locale;
  t: Translator;
  percent?: 50 | 100;
}) {
  const first =
    percent === 100
      ? goodsTotal
      : Math.floor(goodsTotal / 2) + (goodsTotal % 2);
  return (
    <div className="vy-summary">
      <div>
        <span>{t("goods")}</span>
        <VoyeyPrice amount={subtotal} locale={locale} />
      </div>
      <div>
        <span>{t("discount")}</span>
        <span>
          {discount > 0 ? "− " : ""}
          <VoyeyPrice amount={discount} locale={locale} />
        </span>
      </div>
      {mode === "PREORDER" && (
        <div>
          <span>{t("cargo")}</span>
          <span>{t("cargoLater")}</span>
        </div>
      )}
      <div className="vy-total">
        <strong>{t("total")}</strong>
        <VoyeyPrice amount={goodsTotal} locale={locale} />
      </div>
      {percent === 50 && (
        <div className="vy-first">
          <strong>{t("prepayment")}</strong>
          <VoyeyPrice amount={first} locale={locale} />
        </div>
      )}
    </div>
  );
}
export function VoyeyEmptyState({
  title,
  text,
  onBrowse,
  t,
  icon = "bag",
}: {
  title: string;
  text: string;
  onBrowse?: () => void;
  t: Translator;
  icon?: IconName;
}) {
  return (
    <section className="vy-empty">
      <span className="vy-empty-icon">
        <VoyeyIcon name={icon} size={34} />
      </span>
      <h2>{title}</h2>
      <p>{text}</p>
      {onBrowse && (
        <VoyeyButton onClick={onBrowse}>
          {t("openCatalog")}
          <VoyeyIcon name="arrow" size={18} />
        </VoyeyButton>
      )}
    </section>
  );
}
export function VoyeyDialog({
  title,
  children,
  onClose,
  t,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  t: Translator;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const { reduced } = useVoyeyMotion(),
    present = useIsPresent();
  useEffect(() => {
    const previous = document.activeElement;
    ref.current?.showModal();
    const dialog = ref.current;
    return () => {
      dialog?.close();
      if (previous instanceof HTMLElement && previous.isConnected)
        previous.focus({ preventScroll: true });
    };
  }, []);
  return (
    <motion.dialog
      initial={{ opacity: 0, y: reduced ? 0 : 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: reduced ? 0 : 8 }}
      transition={{
        duration: reduced ? 0.08 : motionTokens.dialog,
        ease: motionTokens.ease,
      }}
      ref={ref}
      className="vy-dialog"
      aria-label={title}
      onCancel={(e) => {
        e.preventDefault();
        if (present) onClose();
      }}
      onClick={(e) => {
        if (present && e.target === e.currentTarget) onClose();
      }}
    >
      <div className="vy-dialog-head">
        <h2>{title}</h2>
        <VoyeyIconButton icon="close" label={t("close")} onClick={onClose} />
      </div>
      {children}
    </motion.dialog>
  );
}
