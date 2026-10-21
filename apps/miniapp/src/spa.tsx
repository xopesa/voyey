import { createRoot } from "react-dom/client";
import { usePathname } from "./spa/navigation";
import { CartShell } from "./components/cart/CartShell";
import { CartProvider } from "./components/cart/CartProvider";
import { resolveMiniAppRoute } from "./lib/routes";
import { PreferencesProvider } from "./components/PreferencesProvider";
import { TelegramSessionProvider } from "./components/TelegramSession";
import {
  applyPreferences,
  readPreferences,
  preferenceKeys,
} from "./lib/preferences";
import Home from "./app/page";
import Catalog from "./app/catalog/page";
import Cart from "./app/cart/page";
import Checkout from "./app/checkout/page";
import Orders from "./app/orders/page";
import Profile from "./app/profile/page";
import { ProductDetail } from "./components/product/ProductDetail";
import { OrderDetailContent } from "./components/orders/OrderDetailContent";
import { PaymentPageContent } from "./components/payment/PaymentPageContent";
import "./app/globals.css";
import "./styles/catalog.css";
import "./styles/product-detail.css";
import "./styles/cart.css";
import "./styles/checkout.css";
import "./styles/payment.css";
import "./styles/orders.css";
import "./spa/font.css";
export function Routes() {
  const path = usePathname();
  const route = resolveMiniAppRoute(path);
  return (
    <CartShell>
      {route.kind === "product" ? (
        <ProductDetail key={route.slug} slug={route.slug} />
      ) : route.kind === "payment" ? (
        <PaymentPageContent key={route.publicId} publicId={route.publicId} />
      ) : route.kind === "order" ? (
        <OrderDetailContent key={route.publicId} publicId={route.publicId} />
      ) : path === "/catalog" ? (
        <Catalog />
      ) : path === "/cart" ? (
        <Cart />
      ) : path === "/checkout" ? (
        <Checkout />
      ) : path === "/orders" ? (
        <Orders />
      ) : path === "/profile" ? (
        <Profile />
      ) : path === "/" ? (
        <Home />
      ) : (
        <p role="alert">404</p>
      )}
    </CartShell>
  );
}
// Preferences script is fixed application source, not server/user-provided markup.
applyPreferences(readPreferences(preferenceKeys));
createRoot(document.getElementById("root")!).render(
  <TelegramSessionProvider>
    <PreferencesProvider>
      <CartProvider>
        <Routes />
      </CartProvider>
    </PreferencesProvider>
  </TelegramSessionProvider>,
);
