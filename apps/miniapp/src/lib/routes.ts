// Both public catalog slug and order publicId API schemas allow 1..100 chars.
const MAX_ROUTE_SEGMENT = 100;
export function safeDecodeURIComponent(value: string): string | null {
  // Bound input before UTF-8 decoding (at most four %xx bytes per code point).
  if (!value || value.length > MAX_ROUTE_SEGMENT * 12) return null;
  try {
    const decoded = decodeURIComponent(value);
    return decoded.length <= MAX_ROUTE_SEGMENT && decoded.trim().length > 0
      ? decoded
      : null;
  } catch {
    return null;
  }
}
export type MiniAppRoute =
  | { kind: "product"; slug: string }
  | { kind: "order" | "payment"; publicId: string }
  | { kind: "page"; path: string }
  | { kind: "not-found" };
export function resolveMiniAppRoute(path: string): MiniAppRoute {
  if (path.length > MAX_ROUTE_SEGMENT * 12 + 32) return { kind: "not-found" };
  const product = /^\/catalog\/([^/]+)$/.exec(path);
  const order = /^\/orders\/([^/]+)(\/payment)?$/.exec(path);
  if (product || order) {
    const value = safeDecodeURIComponent((product ?? order)![1]!);
    if (value === null) return { kind: "not-found" };
    return product
      ? { kind: "product", slug: value }
      : { kind: order![2] ? "payment" : "order", publicId: value };
  }
  return [
    "/",
    "/catalog",
    "/cart",
    "/checkout",
    "/orders",
    "/profile",
  ].includes(path)
    ? { kind: "page", path }
    : { kind: "not-found" };
}
