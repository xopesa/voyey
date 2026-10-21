import React from "react";
import { cartConfirmsItem } from "../../../src/lib/product";
import { isCart } from "../../../src/lib/cart";
import { CartResource } from "../../../src/lib/cart-resource";
let confirmedCart = {
  id: "fixture-cart",
  items: [],
  subtotal: 0,
  currency: "UZS",
  updatedAt: "2026-10-17T00:00:00Z",
};
const resource = new CartResource(
  {
    add: addCartItem,
    get: async () => confirmedCart,
    update: async () => confirmedCart,
    remove: async () => confirmedCart,
    clear: async () => confirmedCart,
  },
  readAccessToken,
);
export function useCart() {
  const state = React.useSyncExternalStore(
    resource.subscribe,
    resource.snapshot,
    resource.snapshot,
  );
  return { state, resource };
}
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
export function Link({ href, children, onClick, ...props }) {
  return (
    <a
      {...props}
      href={href}
      onClick={(e) => {
        onClick?.(e);
        if (!e.defaultPrevented) {
          e.preventDefault();
          navigate(href);
        }
      }}
    >
      {children}
    </a>
  );
}
function navigate(href) {
  window.fixtureControl.navigation = href;
  document.getElementById("fixture-result").textContent = `Navigation: ${href}`;
}
export function usePathname() {
  return "/catalog/fixture-only";
}
export function useRouter() {
  return { push: navigate, back: () => navigate("BACK"), replace: navigate };
}
export function readAccessToken() {
  return window.fixtureControl.token ? "fixture-only-token" : null;
}
export function TelegramBootstrap() {
  return <span>TEST SESSION · no Telegram authentication</span>;
}
export class ApiRequestError extends Error {
  constructor(status) {
    super("Fixture response");
    this.status = status;
  }
}
export async function addCartItem(input, token, signal) {
  window.fixtureControl.calls.push(input);
  document.getElementById("fixture-result").textContent =
    `Pending: ${JSON.stringify(input)}`;
  await new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, 400);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(Error("Aborted"));
      },
      { once: true },
    );
  });
  const mode = window.fixtureControl.response;
  if (mode === "401" || mode === "409") throw new ApiRequestError(Number(mode));
  if (mode === "network") throw Error("Test network failure");
  const response = {
    cart: {
      ...confirmedCart,
      subtotal: input.quantity * 125000,
      items:
        mode === "invalid"
          ? []
          : [
              {
                ...input,
                id: "fixture-line",
                unitPrice: 125000,
                lineTotal: input.quantity * 125000,
                currency: "UZS",
                isAvailable: true,
                product: {
                  id: input.productId,
                  nameRu: "Test",
                  nameUz: "Sinov",
                  slug: "fixture-only",
                  imageUrl: null,
                },
                variant: {
                  id: input.variantId,
                  sku: "FIXTURE",
                  size: "M",
                  color: null,
                  stock: null,
                },
              },
            ],
    },
  };
  if (!isCart(response.cart) || !cartConfirmsItem(response, input))
    throw Error("Invalid fixture confirmation");
  document.getElementById("fixture-result").textContent =
    `Confirmed: ${JSON.stringify(input)}`;
  confirmedCart = response.cart;
  return confirmedCart;
}

// Test-only locale API adapter: never contacts a server or database.
export async function updateUserLocale(locale) {
  return { user: { preferredLocale: locale } };
}
