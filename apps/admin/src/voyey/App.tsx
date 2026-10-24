import { useEffect, useState, useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import { AnimatePresence, MotionConfig, motion } from "motion/react";
import {
  initialClaims,
  initialProducts,
  readRoute,
  reviewDemoClaim,
  routeHref,
  type DemoClaim,
  type DemoOrder,
  type Section,
} from "./model";
import { translate, type Locale } from "./messages";
import {
  DashboardScreen,
  OrderDetails,
  OrdersScreen,
  PaymentDetails,
  PaymentsScreen,
  ProductsScreen,
  PromosScreen,
  PageTitle,
} from "./screens";
import {
  VoyeyAdminButton as Button,
  VoyeyAdminConfirmDialog,
  VoyeyAdminEmptyState,
  VoyeyAdminHeader,
  VoyeyAdminLogin,
  VoyeyAdminModal,
  VoyeyAdminSidebar,
  useAdminMotion,
  transition,
} from "./components";
import "./styles.css";

const subscribe = (notify: () => void) => {
  window.addEventListener("popstate", notify);
  return () => window.removeEventListener("popstate", notify);
};
const routeSnapshot = () => readRoute(window.location.search);
const localeKey = "voyey.admin.demo.locale";
export function VoyeyAdminShell({
  initialScreen,
}: {
  initialScreen?: Section | "login";
}) {
  const route = useSyncExternalStore(
      subscribe,
      routeSnapshot,
      () => initialScreen ?? "login",
    ),
    reduced = useAdminMotion();
  const [locale, setLocale] = useState<Locale>(() => {
    try {
      return localStorage.getItem(localeKey) === "uz" ? "uz" : "ru";
    } catch {
      return "ru";
    }
  });
  const [collapsed, setCollapsed] = useState(false),
    [mobile, setMobile] = useState(false),
    [query, setQuery] = useState("");
  const [products, setProducts] = useState(() =>
      structuredClone(initialProducts),
    ),
    [claims, setClaims] = useState(() => structuredClone(initialClaims));
  const [order, setOrder] = useState<DemoOrder | null>(null),
    [claimId, setClaimId] = useState<string | null>(null),
    [info, setInfo] = useState<"notifications" | "profile" | null>(null),
    [decision, setDecision] = useState<{
      claim: DemoClaim;
      value: "APPROVED" | "REJECTED";
    } | null>(null);
  const t = (key: Parameters<typeof translate>[1]) => translate(locale, key),
    claim = claims.find((c) => c.id === claimId);
  useEffect(() => {
    document.documentElement.lang = locale;
    try {
      localStorage.setItem(localeKey, locale);
    } catch {
      /* preferences are optional */
    }
  }, [locale]);
  function navigate(screen: Section | "login") {
    history.pushState(null, "", routeHref(screen));
    window.dispatchEvent(new PopStateEvent("popstate"));
    setMobile(false);
    setQuery("");
    setOrder(null);
    setClaimId(null);
    setInfo(null);
    setDecision(null);
    window.scrollTo({ top: 0, behavior: "instant" });
  }
  function exit() {
    setProducts(structuredClone(initialProducts));
    setClaims(structuredClone(initialClaims));
    navigate("login");
  }
  if (route === "login")
    return (
      <VoyeyAdminLogin
        locale={locale}
        setLocale={setLocale}
        openDemo={() => navigate("dashboard")}
      />
    );
  const sidebarProps = {
    locale,
    section: route,
    navigate,
    collapsed,
    pendingCount: claims.filter((c) => c.status === "SUBMITTED").length,
    toggle: () => setCollapsed(!collapsed),
    exit,
  };
  return (
    <div className="va-shell">
      <a className="va-skip" href="#va-main">
        {t("overview")}
      </a>
      <div className="va-desktop-sidebar">
        <VoyeyAdminSidebar {...sidebarProps} />
      </div>
      <div className="va-workspace">
        <VoyeyAdminHeader
          locale={locale}
          setLocale={setLocale}
          section={route}
          openMenu={() => setMobile(true)}
          notify={() => setInfo("notifications")}
          profile={() => setInfo("profile")}
          search={query}
          setSearch={setQuery}
        />
        <div className="va-demo-banner">
          <span className="va-badge">DEMO</span>
          {t("demoWarning")}
        </div>
        <main id="va-main" tabIndex={-1}>
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={route}
              initial={{ opacity: 0, y: reduced ? 0 : 5 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={transition(reduced)}
            >
              {route === "dashboard" ? (
                <DashboardScreen
                  locale={locale}
                  claims={claims}
                  products={products}
                  navigate={navigate}
                  openOrder={setOrder}
                  openClaim={(c) => setClaimId(c.id)}
                />
              ) : route === "orders" ? (
                <OrdersScreen locale={locale} query={query} open={setOrder} />
              ) : route === "products" ? (
                <ProductsScreen
                  locale={locale}
                  query={query}
                  products={products}
                  setProducts={setProducts}
                />
              ) : route === "payments" ? (
                <PaymentsScreen
                  locale={locale}
                  claims={claims}
                  open={(c) => setClaimId(c.id)}
                />
              ) : route === "promos" ? (
                <PromosScreen locale={locale} />
              ) : (
                <>
                  <PageTitle title={t(route)} />
                  <div className="va-card">
                    <VoyeyAdminEmptyState
                      locale={locale}
                      title={t("inDevelopment")}
                    >
                      <span>{t("futureSection")}</span>
                      <Button onClick={() => navigate("dashboard")}>
                        {t("backHome")}
                      </Button>
                    </VoyeyAdminEmptyState>
                  </div>
                </>
              )}
            </motion.div>
          </AnimatePresence>
        </main>
        <footer className="va-footer">VOYEY ADMIN · {t("localOnly")}</footer>
      </div>
      {mobile && (
        <VoyeyAdminModal
          title={t("adminPanel")}
          locale={locale}
          onClose={() => setMobile(false)}
          drawer
          side="left"
        >
          <VoyeyAdminSidebar {...sidebarProps} collapsed={false} mobile />
        </VoyeyAdminModal>
      )}
      {order && (
        <OrderDetails
          order={order}
          locale={locale}
          onClose={() => setOrder(null)}
        />
      )}
      {claim && (
        <PaymentDetails
          claim={claim}
          locale={locale}
          onClose={() => setClaimId(null)}
          decide={(c, value) => setDecision({ claim: c, value })}
          openOrder={(o) => {
            setClaimId(null);
            setOrder(o);
          }}
        />
      )}
      {decision && (
        <VoyeyAdminConfirmDialog
          locale={locale}
          onClose={() => setDecision(null)}
          onConfirm={() => {
            setClaims(
              reviewDemoClaim(claims, decision.claim.id, decision.value),
            );
            setDecision(null);
          }}
        >
          {t("previewOnly")} · {t(decision.value)}
        </VoyeyAdminConfirmDialog>
      )}
      {info && (
        <VoyeyAdminModal
          title={t(info)}
          locale={locale}
          onClose={() => setInfo(null)}
        >
          <p>{t(info === "notifications" ? "noNotifications" : "viewer")}</p>
          {info === "profile" && (
            <>
              <p>{t("ownerOnly")}</p>
              <Button onClick={exit}>{t("exit")}</Button>
            </>
          )}
        </VoyeyAdminModal>
      )}
    </div>
  );
}
export function mountDemo() {
  createRoot(document.getElementById("root")!).render(
    <MotionConfig reducedMotion="user">
      <VoyeyAdminShell />
    </MotionConfig>,
  );
}
