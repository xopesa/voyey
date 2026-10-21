import type { MessageKey } from "./i18n";
import { messages } from "./i18n";
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code?: MessageKey,
  ) {
    super("Admin request failed");
  }
}
export function errorKey(error: unknown): MessageKey {
  if (!(error instanceof ApiError)) return "error";
  if (error.code) return error.code;
  return (
    (
      {
        400: "invalid",
        401: "credentials",
        403: "access",
        404: "notFound",
        413: "imageTooLarge",
        415: "imageType",
        409: "conflict",
        429: "limit",
        502: "unavailable",
        503: "unavailable",
      } as Record<number, MessageKey>
    )[error.status] ?? "error"
  );
}
export async function api<T>(
  path: string,
  options: RequestInit = {},
  authenticated = true,
): Promise<T> {
  const response = await fetch(`/api/admin/${path}`, {
    ...options,
    credentials: "same-origin",
    cache: "no-store",
    headers: {
      ...(options.body && !(options.body instanceof FormData)
        ? { "Content-Type": "application/json" }
        : {}),
      ...options.headers,
    },
  });
  if (!response.ok) {
    if (response.status === 401 && authenticated)
      window.location.replace("/admin/login");
    let code: MessageKey | undefined;
    try {
      const result = await response.json();
      if (
        [400, 409].includes(response.status) &&
        typeof result.error === "string" &&
        Object.hasOwn(messages.ru, result.error)
      )
        code = result.error as MessageKey;
      if (
        response.status === 409 &&
        typeof result.error === "string" &&
        /sku/i.test(result.error)
      )
        code = "skuConflict";
    } catch {
      /* Status still provides a localized fallback. */
    }
    throw new ApiError(response.status, code);
  }
  return response.json() as Promise<T>;
}
