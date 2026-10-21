import React, { useEffect } from "react";
import { useTelegramSession } from "../../../src/components/TelegramSession";
import { isCart, cartPatchConfirmed } from "../../../src/lib/cart";
export default function Image({ fill, unoptimized, sizes, ...props }) {
  return (
    <img
      {...props}
      style={{
        ...props.style,
        ...(fill
          ? { position: "absolute", inset: 0, width: "100%", height: "100%" }
          : {}),
      }}
    />
  );
}
function navigate(href) {
  document.getElementById("fixture-result").textContent = `Navigation: ${href}`;
}
export function Link({ href, children, ...props }) {
  return (
    <a
      {...props}
      href={href}
      onClick={(event) => {
        event.preventDefault();
        navigate(href);
      }}
    >
      {children}
    </a>
  );
}
export function usePathname() {
  return "/cart";
}
export function useRouter() {
  return { push: navigate, back: () => navigate("BACK") };
}
export function readAccessToken() {
  return window.cartFixtureControl.session === "authenticated"
    ? "fixture-only-token"
    : null;
}
export function TelegramBootstrap() {
  const { setStatus } = useTelegramSession();
  useEffect(() => {
    setStatus("authenticated");
  }, [setStatus]);
  return <span>TEST SESSION · no real Telegram authentication</span>;
}
class FixtureError extends Error {
  constructor(status) {
    super("Fixture error");
    this.status = status;
  }
}
async function request(type, signal, details = {}) {
  document.getElementById("fixture-result").textContent =
    `Pending ${type}: ${JSON.stringify(details)}`;
  await new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, 700);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(Error("Aborted"));
      },
      { once: true },
    );
  });
  const state = window.cartFixtureControl;
  if (
    state.mode === "401" ||
    state.mode === "500" ||
    (state.mode === "409" && type === "PATCH")
  )
    throw new FixtureError(Number(state.mode));
  const cart = structuredClone(state.cart);
  if (state.mode !== "unconfirmed" && type === "PATCH") {
    const item = cart.items.find((item) => item.id === details.id);
    Object.assign(item, details.patch);
    item.lineTotal = item.unitPrice * item.quantity;
    item.isAvailable =
      item.variant.stock === null || item.quantity <= item.variant.stock;
  }
  if (state.mode !== "unconfirmed" && type === "DELETE ITEM")
    cart.items = cart.items.filter((item) => item.id !== details.id);
  if (state.mode !== "unconfirmed" && type === "DELETE CART") cart.items = [];
  if (typeof cart.subtotal === "number")
    cart.subtotal = cart.items.reduce((sum, item) => sum + item.lineTotal, 0);
  if (!isCart(cart)) throw Error("Invalid fixture response");
  if (type === "PATCH" && !cartPatchConfirmed(cart, details.id, details.patch))
    throw Error("Unconfirmed patch");
  if (
    type === "DELETE ITEM" &&
    cart.items.some((item) => item.id === details.id)
  )
    throw Error("Unconfirmed remove");
  if (type === "DELETE CART" && cart.items.length > 0)
    throw Error("Unconfirmed clear");
  state.cart = cart;
  document.getElementById("fixture-result").textContent =
    `Confirmed ${type}: ${JSON.stringify(details)}`;
  return cart;
}
export const getCart = (token, signal) => request("GET", signal);
export const updateCartItem = (id, patch, token, signal) =>
  request("PATCH", signal, { id, patch });
export const deleteCartItem = (id, token, signal) =>
  request("DELETE ITEM", signal, { id });
export const clearCart = (token, signal) => request("DELETE CART", signal);

// Test-only locale API adapter: never contacts a server or database.
export async function updateUserLocale(locale) {
  return { user: { preferredLocale: locale } };
}
