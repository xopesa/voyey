import {
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
  type InputHTMLAttributes,
  type FormEvent,
} from "react";
import {
  LayoutGroup,
  motion,
  useReducedMotion,
  type HTMLMotionProps,
} from "motion/react";
import { assets } from "../../../miniapp/src/voyey/assets";
import { sections, type Section } from "./model";
import { translate, type Locale, type MessageKey } from "./messages";

export const useAdminMotion = () => !!useReducedMotion();
export const transition = (reduced: boolean) => ({
  duration: reduced ? 0.08 : 0.22,
  ease: [0.22, 0.8, 0.28, 1] as [number, number, number, number],
});
const paths: Record<string, string> = {
  dashboard: "M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z",
  orders: "M6 3h12v18l-3-2-3 2-3-2-3 2z M9 7h6 M9 11h6",
  products: "m3 7 9-4 9 4v10l-9 4-9-4z M3 7l9 4 9-4 M12 11v10",
  categories: "M3 4h7v7H3z M14 4h7v7h-7z M3 15h7v6H3z M14 15h7v6h-7z",
  stock: "M3 21V7l9-4 9 4v14 M8 21v-9h8v9 M3 9h18",
  payments: "M3 5h18v14H3z M3 9h18 M7 15h4",
  refunds: "M8 4 3 9l5 5 M3 9h11a6 6 0 0 1 0 12",
  promos: "M3 3h9l9 9-9 9-9-9z M7 7h.01",
  campaigns: "m3 10 15-6v16L3 14z M7 15l2 6h3l-2-5 M21 9v6",
  customers:
    "M16 21v-3a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v3 M9 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8 M17 4a4 4 0 0 1 0 7 M22 21v-3a4 4 0 0 0-3-4",
  staff: "m12 2 9 4v6c0 5-9 10-9 10S3 17 3 12V6z m-4 10 3 3 5-6",
  analytics: "M4 3v18h17 M8 16v-5 M13 16V7 M18 16v-3",
  settings:
    "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8 M12 2v3 M12 19v3 M2 12h3 M19 12h3 M5 5l2 2 M17 17l2 2 M5 19l2-2 M17 7l2-2",
  search: "m21 21-5-5 M10 3a7 7 0 1 0 0 14 7 7 0 0 0 0-14",
  bell: "M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9 M10 21h4",
  chevron: "m9 6 6 6-6 6",
  menu: "M3 6h18 M3 12h18 M3 18h18",
  close: "m6 6 12 12 M6 18 18 6",
  plus: "M12 4v16 M4 12h16",
  exit: "M9 4H3v16h6 M9 12h12 m-4-4 4 4-4 4",
  eye: "M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7z M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6",
  clock: "M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20 M12 6v6l4 2",
  check: "m5 12 4 4L19 6",
};
export function Icon({ name, size = 20 }: { name: string; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[name] ?? paths.products} />
    </svg>
  );
}
export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <span className={compact ? "va-logo va-logo-compact" : "va-logo"}>
      <img src={compact ? assets.symbol : assets.logo} alt="VOYEY" />
    </span>
  );
}
export function VoyeyAdminButton({
  children,
  className = "",
  primary = false,
  ...props
}: HTMLMotionProps<"button"> & { primary?: boolean }) {
  const reduced = useAdminMotion();
  return (
    <motion.button
      type="button"
      {...props}
      className={`va-button ${primary ? "va-primary" : ""} ${className}`}
      whileTap={reduced || props.disabled ? undefined : { scale: 0.98 }}
      transition={transition(reduced)}
    >
      {children}
    </motion.button>
  );
}
export function VoyeyAdminInput({
  label,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  const id = useId();
  return (
    <label className="va-field" htmlFor={id}>
      <span>{label}</span>
      <input id={id} {...props} />
    </label>
  );
}
export function VoyeyAdminCard({
  title,
  action,
  children,
  className = "",
}: {
  title?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`va-card ${className}`}>
      {title && (
        <div className="va-card-heading">
          <h2>{title}</h2>
          {action}
        </div>
      )}
      {children}
    </section>
  );
}
export function VoyeyAdminEmptyState({
  locale,
  title,
  children,
}: {
  locale: Locale;
  title?: string;
  children?: ReactNode;
}) {
  return (
    <div className="va-empty">
      <span className="va-empty-icon">
        <Icon name="search" size={28} />
      </span>
      <h2>{title ?? translate(locale, "empty")}</h2>
      <p>{children ?? translate(locale, "emptyHint")}</p>
    </div>
  );
}
export function VoyeyAdminTable({
  headers,
  children,
  count,
  locale,
  state = "ready",
  retry,
}: {
  headers: string[];
  children?: ReactNode;
  count: number;
  locale: Locale;
  state?: "ready" | "loading" | "error";
  retry?: () => void;
}) {
  if (state !== "ready")
    return (
      <div className="va-empty" role={state === "error" ? "alert" : "status"}>
        {translate(locale, state === "error" ? "loadError" : "loading")}
        {state === "error" && retry && (
          <VoyeyAdminButton onClick={retry}>
            {translate(locale, "retry")}
          </VoyeyAdminButton>
        )}
      </div>
    );
  if (!count) return <VoyeyAdminEmptyState locale={locale} />;
  return (
    <>
      <div
        className="va-table-scroll"
        role="region"
        aria-label={headers.join(", ")}
        tabIndex={0}
      >
        <table className="va-table">
          <thead>
            <tr>
              {headers.map((h) => (
                <th key={h} scope="col">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>{children}</tbody>
        </table>
      </div>
      <div className="va-table-footer">
        {count} {translate(locale, "rows")} · DEMO
      </div>
    </>
  );
}
export function VoyeyAdminStatusBadge({
  value,
  locale,
}: {
  value: MessageKey | "IN_STOCK" | "PREORDER";
  locale: Locale;
}) {
  const positive = ["APPROVED", "PAID_FULL", "ACTIVE", "IN_STOCK"].includes(
    value,
  );
  const warning = [
    "SUBMITTED",
    "PREPAYMENT_SUBMITTED",
    "FINAL_PAYMENT_SUBMITTED",
    "PREORDER",
    "AWAITING_FINAL_PAYMENT",
  ].includes(value);
  const negative = ["REJECTED", "CANCELLED"].includes(value);
  return (
    <span
      className={`va-badge ${positive ? "va-success" : warning ? "va-warning" : negative ? "va-danger" : ""}`}
      title={value}
    >
      {translate(
        locale,
        value === "IN_STOCK"
          ? "inStock"
          : value === "PREORDER"
            ? "preorder"
            : value,
      )}
    </span>
  );
}
export function VoyeyAdminStatCard({
  label,
  value,
  icon,
  onClick,
}: {
  label: string;
  value: string | number;
  icon: string;
  onClick: () => void;
}) {
  return (
    <button className="va-stat va-card" onClick={onClick}>
      <span className="va-stat-top">
        {label}
        <span className="va-stat-icon">
          <Icon name={icon} />
        </span>
      </span>
      <strong>{value}</strong>
      <small>
        DEMO <span aria-hidden="true">↗</span>
      </small>
    </button>
  );
}
export function VoyeyAdminModal({
  title,
  locale,
  onClose,
  children,
  drawer = false,
  side = "right",
}: {
  title: string;
  locale: Locale;
  onClose: () => void;
  children: ReactNode;
  drawer?: boolean;
  side?: "left" | "right";
}) {
  const ref = useRef<HTMLDialogElement>(null),
    id = useId(),
    reduced = useAdminMotion();
  useEffect(() => {
    const node = ref.current!,
      prior = document.activeElement as HTMLElement | null;
    node.showModal();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      node.close();
      document.body.style.overflow = overflow;
      prior?.focus();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className={
        drawer
          ? `va-dialog va-drawer ${side === "left" ? "va-nav-drawer" : ""}`
          : "va-dialog"
      }
      aria-labelledby={id}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === ref.current) {
          const b = ref.current.getBoundingClientRect();
          if (
            e.clientX < b.left ||
            e.clientX > b.right ||
            e.clientY < b.top ||
            e.clientY > b.bottom
          )
            onClose();
        }
      }}
    >
      <motion.div
        className="va-dialog-content"
        initial={
          reduced
            ? { opacity: 0 }
            : drawer
              ? { opacity: 0.7, x: side === "left" ? -24 : 24 }
              : { opacity: 0, y: 8 }
        }
        animate={{ opacity: 1, x: 0, y: 0 }}
        transition={transition(reduced)}
      >
        <div className="va-dialog-heading">
          <h2 id={id}>{title}</h2>
          <VoyeyAdminButton
            aria-label={translate(locale, "close")}
            onClick={onClose}
          >
            <Icon name="close" />
          </VoyeyAdminButton>
        </div>
        {children}
      </motion.div>
    </dialog>
  );
}
export function VoyeyAdminDrawer(props: Parameters<typeof VoyeyAdminModal>[0]) {
  return <VoyeyAdminModal {...props} drawer />;
}
export function VoyeyAdminConfirmDialog({
  locale,
  onClose,
  onConfirm,
  children,
}: {
  locale: Locale;
  onClose: () => void;
  onConfirm: () => void;
  children: ReactNode;
}) {
  return (
    <VoyeyAdminModal
      title={translate(locale, "demoConfirm")}
      locale={locale}
      onClose={onClose}
    >
      <p>{children}</p>
      <div className="va-actions">
        <VoyeyAdminButton onClick={onClose}>
          {translate(locale, "cancel")}
        </VoyeyAdminButton>
        <VoyeyAdminButton primary onClick={onConfirm}>
          {translate(locale, "confirm")}
        </VoyeyAdminButton>
      </div>
    </VoyeyAdminModal>
  );
}
export function Language({
  locale,
  setLocale,
}: {
  locale: Locale;
  setLocale: (locale: Locale) => void;
}) {
  return (
    <div className="va-language" role="group" aria-label="RU / UZ">
      {(["ru", "uz"] as const).map((l) => (
        <button
          key={l}
          lang={l}
          aria-pressed={locale === l}
          onClick={() => setLocale(l)}
        >
          {l.toUpperCase()}
        </button>
      ))}
    </div>
  );
}
export function VoyeyAdminSidebar({
  locale,
  section,
  navigate,
  collapsed,
  toggle,
  exit,
  mobile = false,
  pendingCount = 2,
}: {
  locale: Locale;
  section: Section;
  navigate: (s: Section) => void;
  collapsed: boolean;
  toggle: () => void;
  exit: () => void;
  mobile?: boolean;
  pendingCount?: number;
}) {
  const reduced = useAdminMotion(),
    id = useId();
  return (
    <motion.aside
      className={`va-sidebar ${collapsed ? "va-collapsed" : ""} ${mobile ? "va-sidebar-mobile" : ""}`}
      initial={false}
      animate={{ width: collapsed ? 80 : 252 }}
      transition={transition(reduced)}
      aria-label={translate(locale, "adminPanel")}
    >
      <div className="va-sidebar-brand">
        <Logo compact={collapsed} />
        {!collapsed && <span className="va-overline">ADMIN PANEL</span>}
      </div>
      <nav>
        <LayoutGroup id={`va-nav-${id}`}>
          {sections.map((s) => (
            <button
              key={s}
              onClick={() => navigate(s)}
              aria-current={section === s ? "page" : undefined}
              title={collapsed ? translate(locale, s) : undefined}
            >
              {section === s && (
                <motion.span
                  className="va-active-indicator"
                  layoutId={reduced ? undefined : "active"}
                  transition={transition(reduced)}
                />
              )}
              <Icon name={s} />
              <span className={collapsed ? "va-sr-only" : ""}>
                {translate(locale, s)}
              </span>
              {s === "payments" && !collapsed && (
                <small className="va-nav-count">{pendingCount}</small>
              )}
            </button>
          ))}
        </LayoutGroup>
      </nav>
      <div className="va-sidebar-bottom">
        <div className="va-principal">
          <span className="va-avatar">V</span>
          {!collapsed && (
            <span>
              <strong>{translate(locale, "owner")}</strong>
              <small>{translate(locale, "viewer")}</small>
            </span>
          )}
        </div>
        <VoyeyAdminButton
          onClick={exit}
          title={translate(locale, "exit")}
          aria-label={translate(locale, "exit")}
        >
          <Icon name="exit" />
          {!collapsed && translate(locale, "exit")}
        </VoyeyAdminButton>
        {!mobile && (
          <VoyeyAdminButton
            onClick={toggle}
            aria-label={translate(locale, collapsed ? "expand" : "collapse")}
            aria-expanded={!collapsed}
          >
            <span className={collapsed ? "" : "va-reverse"}>
              <Icon name="chevron" />
            </span>
            {!collapsed && translate(locale, "collapse")}
          </VoyeyAdminButton>
        )}
      </div>
    </motion.aside>
  );
}
export function VoyeyAdminHeader({
  locale,
  setLocale,
  section,
  openMenu,
  notify,
  profile,
  search,
  setSearch,
}: {
  locale: Locale;
  setLocale: (l: Locale) => void;
  section: Section;
  openMenu: () => void;
  notify: () => void;
  profile: () => void;
  search: string;
  setSearch: (q: string) => void;
}) {
  const searchable = ["orders", "products"].includes(section);
  return (
    <header className="va-header">
      <div className="va-header-start">
        <VoyeyAdminButton
          className="va-mobile-toggle"
          onClick={openMenu}
          aria-label={translate(locale, "menu")}
        >
          <Icon name="menu" />
        </VoyeyAdminButton>
        <span className="va-breadcrumb">
          VOYEY <span>/</span> <strong>{translate(locale, section)}</strong>
        </span>
      </div>
      <div className="va-header-controls">
        {searchable && (
          <label className="va-header-search">
            <Icon name="search" />
            <span className="va-sr-only">
              {translate(
                locale,
                section === "products" ? "productSearch" : "search",
              )}
            </span>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={translate(
                locale,
                section === "products" ? "productSearch" : "search",
              )}
            />
          </label>
        )}
        <Language locale={locale} setLocale={setLocale} />
        <VoyeyAdminButton
          onClick={notify}
          aria-label={translate(locale, "notifications")}
        >
          <Icon name="bell" />
          <i className="va-dot" />
        </VoyeyAdminButton>
        <button
          className="va-avatar"
          onClick={profile}
          aria-label={translate(locale, "profile")}
        >
          V
        </button>
      </div>
    </header>
  );
}
export function VoyeyAdminLogin({
  locale,
  setLocale,
  openDemo,
}: {
  locale: Locale;
  setLocale: (l: Locale) => void;
  openDemo: () => void;
}) {
  const [login, setLogin] = useState(""),
    [password, setPassword] = useState(""),
    [show, setShow] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<MessageKey | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    if (!login.trim() || !password) {
      setError("emptyLogin");
      return;
    }
    // No authentication attempt, API, persistence, credential log or successful branch.
    setPassword("");
    setShow(false);
    setBusy(true);
    setError(null);
    timer.current = setTimeout(() => {
      setBusy(false);
      setError("authUnavailable");
    }, 350);
  }
  return (
    <div className="va-login">
      <div className="va-login-language">
        <Language locale={locale} setLocale={setLocale} />
      </div>
      <div className="va-login-story">
        <Logo />
        <span className="va-overline">VOYEY ADMIN</span>
        <h1>{translate(locale, "loginIntro")}</h1>
        <p>{translate(locale, "loginNotice")}</p>
        <div className="va-login-decoration">
          <Icon name="staff" size={40} />
          <span>{translate(locale, "viewer")}</span>
        </div>
      </div>
      <main className="va-login-form">
        <section className="va-card">
          <div className="va-login-mobile-logo">
            <Logo />
          </div>
          <span className="va-overline">VOYEY ADMIN</span>
          <h2>{translate(locale, "loginTitle")}</h2>
          <p className="va-muted">{translate(locale, "loginNotice")}</p>
          <form onSubmit={submit} noValidate>
            <VoyeyAdminInput
              label={translate(locale, "login")}
              name="username"
              autoComplete="off"
              value={login}
              maxLength={100}
              disabled={busy}
              onChange={(e) => setLogin(e.target.value)}
              required
              aria-invalid={error === "emptyLogin" && !login.trim()}
            />
            <div className="va-password">
              <VoyeyAdminInput
                label={translate(locale, "password")}
                name="password"
                type={show ? "text" : "password"}
                autoComplete="off"
                value={password}
                maxLength={1024}
                disabled={busy}
                onChange={(e) => setPassword(e.target.value)}
                required
                aria-invalid={error === "emptyLogin" && !password}
              />
              <button
                type="button"
                aria-label={translate(locale, show ? "hide" : "show")}
                aria-pressed={show}
                onClick={() => setShow(!show)}
              >
                <Icon name="eye" />
              </button>
            </div>
            {error && (
              <p className="va-error" role="alert">
                {translate(locale, error)}
              </p>
            )}
            <VoyeyAdminButton
              primary
              type="submit"
              disabled={busy}
              aria-busy={busy}
            >
              {translate(locale, busy ? "busy" : "signIn")}
              <Icon name="chevron" />
            </VoyeyAdminButton>
          </form>
          <p className="va-login-stepup">
            <Icon name="staff" size={17} />
            {translate(locale, "stepUp")}
          </p>
          <div className="va-login-demo">
            <span className="va-overline">DEMO</span>
            <VoyeyAdminButton onClick={openDemo}>
              {translate(locale, "demoOpen")}
            </VoyeyAdminButton>
          </div>
        </section>
      </main>
    </div>
  );
}
