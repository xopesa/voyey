import { catalogHref } from "./catalog";

export function productReturnHref(value: string | null) {
  if (value === "/") return "/";
  if (!value || !/^\/catalog(?:\?|$)/.test(value)) return "/catalog";
  const query = new URLSearchParams(value.split("?")[1]);
  return catalogHref({
    search: query.get("search") ?? "",
    category: query.get("category") ?? "",
  });
}

export function productHref(slug: string, from = "/catalog") {
  return `/catalog/${encodeURIComponent(slug)}?from=${encodeURIComponent(productReturnHref(from))}`;
}

const key = "voyey.product-return";
export function rememberProductReturn(slug: string, href: string) {
  try {
    sessionStorage.setItem(
      key,
      JSON.stringify({
        slug,
        href: productReturnHref(href),
        historyLength: history.length,
        scroll: document.querySelector(".app-shell__scroll")?.scrollTop ?? 0,
      }),
    );
  } catch {
    /* Navigation also works when browser storage is unavailable. */
  }
}

export function readProductReturn() {
  try {
    const value = JSON.parse(sessionStorage.getItem(key) ?? "null");
    if (
      value &&
      typeof value.slug === "string" &&
      typeof value.href === "string" &&
      Number.isInteger(value.historyLength) &&
      Number.isFinite(value.scroll)
    )
      return value as {
        slug: string;
        href: string;
        historyLength: number;
        scroll: number;
      };
  } catch {
    /* No stored navigation state. */
  }
  return null;
}

export function clearProductReturn() {
  try {
    sessionStorage.removeItem(key);
  } catch {
    /* Storage is optional. */
  }
}
