import React, { useEffect, useSyncExternalStore } from "react";
import { useTelegramSession } from "../../../src/components/TelegramSession";
import { isCart, cartPatchConfirmed } from "../../../src/lib/cart";
import { isCheckoutOrder, checkoutCartIssue } from "../../../src/lib/checkout";
export { default } from "../cart-preview/mocks.jsx";
const listeners = new Set();
function navigate(path) {
  window.checkoutFixtureControl.path = path;
  listeners.forEach((listener) => listener());
  document.getElementById("fixture-result").textContent = `Navigation: ${path}`;
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
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => window.checkoutFixtureControl.path,
  );
}
export function useRouter() {
  return { push: navigate, replace: navigate, back: () => navigate("/cart") };
}
export function readAccessToken() {
  return window.checkoutFixtureControl.session === "authenticated"
    ? "fixture-token"
    : null;
}
export function TelegramBootstrap() {
  const { setStatus } = useTelegramSession();
  useEffect(() => setStatus("authenticated"), [setStatus]);
  return <span>TEST SESSION · no real Telegram authentication</span>;
}
export class ApiRequestError extends Error {
  constructor(status, detail) {
    super("Fixture error");
    this.status = status;
    this.detail = detail;
  }
}
async function wait(type, signal, details = {}) {
  document.getElementById("fixture-result").textContent =
    `Pending ${type}: ${JSON.stringify(details)}`;
  await new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, 650);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(Error("Aborted"));
      },
      { once: true },
    );
  });
  const mode = window.checkoutFixtureControl.mode;
  if (mode === "401") throw new ApiRequestError(401);
  if (mode === "500") throw new ApiRequestError(500);
}
export async function getCart(token, signal) {
  await wait("GET cart", signal);
  const cart = structuredClone(window.checkoutFixtureControl.cart);
  if (!isCart(cart)) throw Error("Malformed");
  return cart;
}
export async function updateCartItem(id, patch, token, signal) {
  await wait("PATCH", signal, { id, patch });
  const control = window.checkoutFixtureControl;
  const item = control.cart.items.find((item) => item.id === id);
  Object.assign(item, patch);
  if (patch.quantity) {
    item.lineTotal = item.unitPrice * item.quantity;
    control.cart.subtotal = control.cart.items.reduce(
      (total, item) => total + item.lineTotal,
      0,
    );
  }
  const cart = structuredClone(control.cart);
  if (!cartPatchConfirmed(cart, id, patch)) throw Error("Unconfirmed");
  return cart;
}
export async function deleteCartItem(id, token, signal) {
  await wait("DELETE", signal);
  const control = window.checkoutFixtureControl;
  control.cart.items = control.cart.items.filter((item) => item.id !== id);
  control.cart.subtotal = control.cart.items.reduce(
    (total, item) => total + item.lineTotal,
    0,
  );
  return structuredClone(control.cart);
}
export async function clearCart(token, signal) {
  await wait("DELETE cart", signal);
  window.checkoutFixtureControl.cart.items = [];
  window.checkoutFixtureControl.cart.subtotal = 0;
  return structuredClone(window.checkoutFixtureControl.cart);
}
export async function submitCheckout(recipient, key, token, signal) {
  await wait("POST checkout", signal, { key });
  const control = window.checkoutFixtureControl;
  control.postCount++;
  if (control.orders.has(key)) return structuredClone(control.orders.get(key));
  if (control.mode === "variant") {
    control.cart.items[0].isAvailable = false;
    throw new ApiRequestError(409, "Product variant is unavailable");
  }
  if (control.mode === "stock") {
    control.cart.items[0].variant.stock = 0;
    control.cart.items[0].isAvailable = false;
    throw new ApiRequestError(
      409,
      "Requested quantity exceeds available stock (0)",
    );
  }
  if (control.mode === "product") {
    control.cart.items[0].isAvailable = false;
    throw new ApiRequestError(409, "Product is unavailable");
  }
  const issue = checkoutCartIssue(control.cart);
  if (issue)
    throw new ApiRequestError(
      409,
      issue === "empty"
        ? "Cart is empty"
        : "Every cart item requires height (100–250 cm) and weight (30–300 kg)",
    );
  const cart = control.cart,
    total = cart.subtotal;
  const order = {
    publicId: `STZ-FIXTURE-${String(control.orders.size + 1).padStart(6, "0")}`,
    currency: "UZS",
    status: "AWAITING_PREPAYMENT",
    total,
    requiredPrepayment: Math.ceil(total / 2),
    remainingAmount: Math.floor(total / 2),
    items: cart.items.map((item) => ({
      productNameRu: item.product.nameRu,
      productNameUz: item.product.nameUz,
      quantity: item.quantity,
      size: item.variant.size,
      color: item.variant.color,
      unitPrice: item.unitPrice,
      lineTotal: item.lineTotal,
      heightCm: item.heightCm,
      weightKg: item.weightKg,
    })),
  };
  if (!isCheckoutOrder(order)) throw Error("Malformed fixture order");
  control.orders.set(key, order);
  control.cart = { ...cart, items: [], subtotal: 0 };
  if (control.mode === "lost") throw Error("Lost reply after fixture commit");
  return structuredClone(order);
}
export async function getCheckoutOrder(publicId, token, signal) {
  await wait("GET order", signal, { publicId });
  const order = [...window.checkoutFixtureControl.orders.values()].find(
    (order) => order.publicId === publicId,
  );
  if (!order) throw new ApiRequestError(404);
  return structuredClone(order);
}

// Test-only locale API adapter: never contacts a server or database.
export async function updateUserLocale(locale) {
  return { user: { preferredLocale: locale } };
}
