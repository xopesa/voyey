import { CustomerNotes } from "./components/customers/CustomerNotes";
import { ManualOrder } from "./components/customers/ManualOrder";
import { Expenses } from "./components/finance/Expenses";
import { FinanceDashboard } from "./components/finance/FinanceDashboard";
import { Refunds } from "./components/finance/Refunds";
import { createRoot } from "react-dom/client";
import { useEffect, useState } from "react";
import { usePathname, useSearchParams } from "../../miniapp/src/spa/navigation";
import { Preferences } from "./components/Preferences";
import { Categories } from "./components/Categories";
import { ProductsList } from "./components/products/ProductsList";
import { ProductEditor } from "./components/products/ProductEditor";
import { OrdersList } from "./components/orders/OrdersList";
import { OrderDetail } from "./components/orders/OrderDetail";
import { Login } from "./components/Login";
import { TelegramSettings } from "./components/TelegramSettings";
import {
  CustomersList,
  CustomerDetail,
} from "./components/customers/Customers";
import { Dashboard } from "./components/dashboard/Dashboard";
import { PromoCodeManager } from "./components/marketing/PromoCodes";
import { MarketingHome, BannerManager } from "./components/marketing/Banners";
import "./app/globals.css";
export function Routes() {
  const path = usePathname(),
    search = useSearchParams();
  const [session, setSession] = useState<{ csrfToken: string } | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/admin/auth/session", {
      credentials: "same-origin",
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        if (response.ok) setSession(await response.json());
        else setSession(null);
      })
      .catch(() => setSession(null))
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [path]);
  if (loading) return <p role="status">STENZO…</p>;
  if (!session || path === "/login") return <Login />;
  const props = { csrfToken: session.csrfToken };
  const product = /^\/products\/([^/]+)$/.exec(path),
    order = /^\/orders\/([^/]+)$/.exec(path);
  const customer = /^\/customers\/([^/]+)$/.exec(path);
  const manualCustomer = /^\/customers\/([^/]+)\/orders\/new$/.exec(path);
  return path === "/finance/refunds" ? (
    <Refunds {...props} />
  ) : path === "/finance" ? (
    <FinanceDashboard {...props} />
  ) : path === "/finance/expenses" ? (
    <Expenses {...props} orderPublicId={search.get("order") ?? undefined} />
  ) : path === "/orders/new" || manualCustomer ? (
    <ManualOrder
      {...props}
      customerId={
        manualCustomer ? decodeURIComponent(manualCustomer[1]!) : undefined
      }
    />
  ) : customer ? (
    <CustomerDetail {...props} customerId={decodeURIComponent(customer[1]!)}>
      <CustomerNotes {...props} customerId={decodeURIComponent(customer[1]!)} />
    </CustomerDetail>
  ) : path === "/customers" ? (
    <CustomersList {...props} />
  ) : path === "/products/new" ? (
    <ProductEditor {...props} />
  ) : product ? (
    <ProductEditor
      key={product[1]}
      {...props}
      productId={decodeURIComponent(product[1]!)}
    />
  ) : order ? (
    <OrderDetail
      key={order[1]}
      {...props}
      publicId={decodeURIComponent(order[1]!)}
      paymentId={search.get("payment") ?? undefined}
    />
  ) : path === "/marketing/promo-codes" ? (
    <PromoCodeManager {...props} />
  ) : path === "/marketing/banners" ? (
    <BannerManager {...props} />
  ) : path === "/marketing" ? (
    <MarketingHome {...props} />
  ) : path === "/products" ? (
    <ProductsList {...props} />
  ) : path === "/orders" ? (
    <OrdersList {...props} />
  ) : path === "/telegram" ? (
    <TelegramSettings {...props} />
  ) : path === "/categories" ? (
    <Categories {...props} />
  ) : path === "/" ? (
    <Dashboard {...props} />
  ) : (
    <p role="alert">404</p>
  );
}
try {
  document.documentElement.lang =
    localStorage.getItem("stenzo.locale") === "uz" ? "uz" : "ru";
  const saved = localStorage.getItem("stenzo.theme");
  document.documentElement.dataset.theme =
    saved === "light" || saved === "dark"
      ? saved
      : matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light";
} catch {
  /* Preferences remain available in memory. */
}
createRoot(document.getElementById("root")!).render(
  <Preferences>
    <Routes />
  </Preferences>,
);
