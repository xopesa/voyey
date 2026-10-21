"use client";
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import {
  addCartItem,
  getCart,
  updateCartItem,
  deleteCartItem,
  clearCart,
} from "../../lib/api-client";
import { readAccessToken } from "../../lib/auth-storage";
import { CartResource, type CartState } from "../../lib/cart-resource";
import { useTelegramSession } from "../TelegramSession";

const transport = {
  add: addCartItem,
  get: getCart,
  update: updateCartItem,
  remove: deleteCartItem,
  clear: clearCart,
};
const CartContext = createContext<{
  resource: CartResource;
  state: CartState;
} | null>(null);
export function CartProvider({ children }: { children: ReactNode }) {
  const { status } = useTelegramSession();
  // A session change drops the old snapshot and invalidates in-flight replies.
  const resource = useMemo(
    () =>
      new CartResource(transport, () =>
        status === "authenticated" ? readAccessToken() : null,
      ),
    [status],
  );
  const state = useSyncExternalStore(
    resource.subscribe,
    resource.snapshot,
    resource.snapshot,
  );
  useEffect(() => {
    if (status !== "authenticated") {
      if (status !== "loading") resource.sessionFailure();
      return resource.cancel;
    }
    void resource.load();
    const resume = () => {
      if (document.visibilityState === "visible") void resource.load();
    };
    const pageshow = (event: PageTransitionEvent) => {
      if (event.persisted) void resource.load();
    };
    document.addEventListener("visibilitychange", resume);
    window.addEventListener("pageshow", pageshow);
    return () => {
      resource.cancel();
      document.removeEventListener("visibilitychange", resume);
      window.removeEventListener("pageshow", pageshow);
    };
  }, [resource, status]);
  return (
    <CartContext.Provider value={{ resource, state }}>
      {children}
    </CartContext.Provider>
  );
}
export function useCart() {
  const context = useContext(CartContext);
  if (!context) throw new Error("CartProvider is required");
  return context;
}
