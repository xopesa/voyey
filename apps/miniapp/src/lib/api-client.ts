export interface PublicUser {
  id: string;
  telegramId: string;
  username: string | null;
  firstName: string | null;
  lastName: string | null;
  languageCode: string | null;
  preferredLocale: "uz" | "ru";
  status: "ACTIVE" | "BLOCKED" | "DELETED";
  createdAt: string;
  updatedAt: string;
}

export interface TelegramAuthResponse {
  accessToken: string;
  user: PublicUser;
}

export class ApiRequestError extends Error {
  public constructor(
    public readonly status: number,
    public readonly detail?: string,
    public readonly code?: string,
  ) {
    super("STENZO API request failed");
    this.name = "ApiRequestError";
  }
}

async function requestJson<T>(
  path: string,
  init: RequestInit = {},
  accessToken?: string,
  checkoutError = false,
): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("Accept", "application/json");
  if (typeof init.body === "string")
    headers.set("Content-Type", "application/json");
  if (accessToken) headers.set("Authorization", `Bearer ${accessToken}`);

  const response = await fetch(`/api${path}`, {
    ...init,
    cache: "no-store",
    headers,
  });
  if (!response.ok) {
    let detail: string | undefined;
    let code: string | undefined;
    if (checkoutError) {
      try {
        const payload: unknown = await response.json();
        if (payload && typeof payload === "object") {
          const error = payload as Record<string, unknown>;
          detail =
            typeof error.error === "string"
              ? error.error
              : typeof error.message === "string"
                ? error.message
                : undefined;
          if (
            typeof error.code === "string" &&
            /^[A-Z][A-Z0-9_]{0,63}$/.test(error.code)
          )
            code = error.code;
        }
      } catch {
        /* HTTP status remains available. */
      }
    }
    throw new ApiRequestError(response.status, detail, code);
  }
  return (await response.json()) as T;
}

export function authenticateTelegram(
  initData: string,
  signal?: AbortSignal,
): Promise<TelegramAuthResponse> {
  return requestJson<TelegramAuthResponse>("/auth/telegram", {
    method: "POST",
    body: JSON.stringify({ initData }),
    signal,
  });
}

export async function getHomeBanners(
  signal?: AbortSignal,
): Promise<PublicBanner[]> {
  return (
    await requestJson<{ banners: PublicBanner[] }>("/home/banners", { signal })
  ).banners;
}

export function getCurrentUser(
  accessToken: string,
  signal?: AbortSignal,
): Promise<{ user: PublicUser }> {
  return requestJson<{ user: PublicUser }>("/me", { signal }, accessToken);
}

export function updateUserLocale(
  locale: "uz" | "ru",
  accessToken: string,
): Promise<{ user: PublicUser }> {
  return requestJson(
    "/me/preferences",
    {
      method: "PATCH",
      body: JSON.stringify({ locale }),
    },
    accessToken,
  );
}

// Catalog endpoints are public; the existing Telegram/JWT flow stays independent.
export async function getCatalogCategories(
  signal?: AbortSignal,
): Promise<CatalogCategory[]> {
  const result = await requestJson<{ categories: CatalogCategory[] }>(
    "/catalog/categories",
    { signal },
  );
  if (
    !Array.isArray(result.categories) ||
    !result.categories.every(isCatalogCategory)
  )
    throw new Error("Invalid catalog categories response");
  return result.categories;
}

export async function getCatalogProducts(
  query: CatalogQuery = {},
  signal?: AbortSignal,
): Promise<CatalogProductsResponse> {
  const result = await requestJson<CatalogProductsResponse>(
    `/catalog/products${catalogQueryString(query)}`,
    { signal },
  );
  if (
    !Array.isArray(result.products) ||
    !result.products.every(isCatalogProduct) ||
    (result.nextCursor !== null && typeof result.nextCursor !== "string")
  )
    throw new Error("Invalid catalog products response");
  return result;
}
import {
  catalogQueryString,
  isCatalogCategory,
  isCatalogProduct,
  type CatalogCategory,
  type CatalogProductsResponse,
  type CatalogQuery,
} from "./catalog";
import {
  isProductDetails,
  validCartInput,
  cartConfirmsItem,
  type ProductDetails,
  type CartItemInput,
} from "./product";

export async function getCatalogProduct(
  slug: string,
  signal?: AbortSignal,
): Promise<ProductDetails> {
  const result = await requestJson<{ product: unknown }>(
    `/catalog/products/${encodeURIComponent(slug)}`,
    { signal },
  );
  if (!isProductDetails(result.product))
    throw new Error("Invalid product response");
  return result.product;
}

export async function addCartItem(
  input: CartItemInput,
  accessToken: string,
  signal?: AbortSignal,
): Promise<Cart> {
  if (!validCartInput(input) || !accessToken)
    throw new Error("Invalid cart request");
  const result = await requestJson<unknown>(
    "/cart/items",
    { method: "POST", body: JSON.stringify(input), signal },
    accessToken,
  );
  if (
    !result ||
    typeof result !== "object" ||
    !("cart" in result) ||
    !isCart(result.cart) ||
    !cartConfirmsItem(result, input)
  )
    throw new Error("Cart response did not confirm the saved item");
  return result.cart;
}

import {
  isCart,
  validCartPatch,
  cartPatchConfirmed,
  type Cart,
  type CartItemPatch,
} from "./cart";

async function requestCart(
  path: string,
  init: RequestInit,
  accessToken: string,
): Promise<Cart> {
  if (!accessToken) throw new ApiRequestError(401);
  const result = await requestJson<{ cart: unknown }>(path, init, accessToken);
  if (!isCart(result.cart)) throw new Error("Invalid cart response");
  return result.cart;
}
export function getCart(accessToken: string, signal?: AbortSignal) {
  return requestCart("/cart", { signal }, accessToken);
}
export async function updateCartItem(
  id: string,
  input: CartItemPatch,
  accessToken: string,
  signal?: AbortSignal,
) {
  if (!id || !validCartPatch(input)) throw new Error("Invalid cart patch");
  const cart = await requestCart(
    `/cart/items/${encodeURIComponent(id)}`,
    { method: "PATCH", body: JSON.stringify(input), signal },
    accessToken,
  );
  if (!cartPatchConfirmed(cart, id, input))
    throw new Error("Cart update was not confirmed");
  return cart;
}
export async function deleteCartItem(
  id: string,
  accessToken: string,
  signal?: AbortSignal,
) {
  if (!id) throw new Error("Invalid cart item id");
  const cart = await requestCart(
    `/cart/items/${encodeURIComponent(id)}`,
    { method: "DELETE", signal },
    accessToken,
  );
  if (cart.items.some((item) => item.id === id))
    throw new Error("Cart removal was not confirmed");
  return cart;
}
export async function clearCart(accessToken: string, signal?: AbortSignal) {
  const cart = await requestCart(
    "/cart",
    { method: "DELETE", signal },
    accessToken,
  );
  if (cart.items.length > 0) throw new Error("Cart clear was not confirmed");
  return cart;
}

import {
  isCheckoutOrder,
  recipientErrors,
  recipientPayload,
  type CheckoutInput,
} from "./checkout";
export async function submitCheckout(
  recipient: CheckoutInput,
  key: string,
  accessToken: string,
  signal?: AbortSignal,
) {
  if (!accessToken) throw new ApiRequestError(401);
  const draft = {
    ...recipient,
    apartment: recipient.apartment ?? "",
    comment: recipient.comment ?? "",
  };
  if (
    Object.keys(recipientErrors(draft)).length ||
    !/^[A-Za-z0-9._:-]{16,200}$/.test(key)
  )
    throw new ApiRequestError(400);
  const result = await requestJson<{ order: unknown }>(
    "/checkout",
    {
      method: "POST",
      headers: { "Idempotency-Key": key },
      body: JSON.stringify({
        ...recipientPayload(draft),
        ...(recipient.promoCode ? { promoCode: recipient.promoCode } : {}),
      }),
      signal,
    },
    accessToken,
    true,
  );
  if (!isCheckoutOrder(result.order)) throw Error("Invalid checkout response");
  return result.order;
}
export async function getCheckoutOrder(
  publicId: string,
  accessToken: string,
  signal?: AbortSignal,
) {
  if (!accessToken) throw new ApiRequestError(401);
  const result = await requestJson<{ order: unknown }>(
    `/orders/${encodeURIComponent(publicId)}`,
    { signal },
    accessToken,
  );
  if (!isCheckoutOrder(result.order) || result.order.publicId !== publicId)
    throw Error("Invalid order response");
  return result.order;
}

import {
  isPaymentOrder,
  isPaymentInstructions,
  isPaymentAttempt,
} from "./payment";
export async function getPaymentOrder(
  publicId: string,
  token: string,
  signal?: AbortSignal,
) {
  if (!token) throw new ApiRequestError(401);
  const result = await requestJson<{ order: unknown }>(
    `/orders/${encodeURIComponent(publicId)}`,
    { signal },
    token,
  );
  if (!isPaymentOrder(result.order) || result.order.publicId !== publicId)
    throw Error("Invalid payment order response");
  return result.order;
}
export async function getPaymentInstructions(
  publicId: string,
  token: string,
  signal?: AbortSignal,
) {
  if (!token) throw new ApiRequestError(401);
  const result = await requestJson<{ paymentInstructions: unknown }>(
    `/orders/${encodeURIComponent(publicId)}/payment-instructions`,
    { signal },
    token,
  );
  if (
    !isPaymentInstructions(result.paymentInstructions) ||
    result.paymentInstructions.orderPublicId !== publicId
  )
    throw Error("Invalid payment instructions response");
  return result.paymentInstructions;
}
export async function submitPaymentProof(
  publicId: string,
  file: File,
  key: string,
  token: string,
  signal?: AbortSignal,
) {
  if (!token) throw new ApiRequestError(401);
  if (!/^[A-Za-z0-9._:-]{16,200}$/.test(key)) throw new ApiRequestError(400);
  const body = new FormData();
  body.append("file", file);
  const result = await requestJson<{ payment: unknown }>(
    `/orders/${encodeURIComponent(publicId)}/payments`,
    { method: "POST", body, signal, headers: { "Idempotency-Key": key } },
    token,
    true,
  );
  if (
    !isPaymentAttempt(result.payment) ||
    result.payment.orderPublicId !== publicId
  )
    throw Error("Payment submission was not confirmed");
  return result.payment;
}

import { isCustomerOrder, type OrdersPage } from "./orders";
export async function getUserOrders(
  token: string,
  cursor?: string,
  signal?: AbortSignal,
): Promise<OrdersPage> {
  if (!token) throw new ApiRequestError(401);
  const params = new URLSearchParams({ limit: "12" });
  if (cursor) params.set("cursor", cursor);
  const result = await requestJson<OrdersPage>(
    `/orders?${params}`,
    { signal },
    token,
  );
  if (
    !Array.isArray(result.orders) ||
    !result.orders.every(isCustomerOrder) ||
    (result.nextCursor !== null && typeof result.nextCursor !== "string")
  )
    throw Error("Invalid orders response");
  return result;
}
export async function getUserOrder(
  publicId: string,
  token: string,
  signal?: AbortSignal,
) {
  const order = await getPaymentOrder(publicId, token, signal);
  if (!isCustomerOrder(order)) throw Error("Invalid customer order response");
  return order;
}
import type { PublicBanner } from "@stenzo/shared";

export async function validatePromoCode(
  code: string,
  accessToken: string,
  signal?: AbortSignal,
): Promise<import("@stenzo/shared").PromoCartQuote> {
  if (!accessToken) throw new ApiRequestError(401);
  const quote = await requestJson<import("@stenzo/shared").PromoCartQuote>(
    "/promo-codes/validate",
    { method: "POST", body: JSON.stringify({ code }), signal },
    accessToken,
  );
  if (
    !quote ||
    typeof quote.valid !== "boolean" ||
    (quote.cartVersion !== null && typeof quote.cartVersion !== "string") ||
    (quote.valid && !quote.cartVersion) ||
    (!quote.valid &&
      ![
        "PROMO_INVALID",
        "PROMO_INACTIVE",
        "PROMO_NOT_STARTED",
        "PROMO_EXPIRED",
        "PROMO_MINIMUM",
        "PROMO_LIMIT",
        "PROMO_USER_LIMIT",
        "PROMO_AMOUNT",
        "PROMO_EMPTY_CART",
      ].includes(quote.reason)) ||
    (quote.valid &&
      (typeof quote.code !== "string" ||
        quote.code.length < 3 ||
        quote.code.length > 32 ||
        !/^[A-Z0-9]+(?:-[A-Z0-9]+)*$/.test(quote.code) ||
        ![quote.subtotal, quote.discountAmount, quote.total].every(
          (n) => Number.isSafeInteger(n) && n > 0,
        ) ||
        quote.total + quote.discountAmount !== quote.subtotal))
  )
    throw new Error("Invalid promo quote");
  return quote;
}
