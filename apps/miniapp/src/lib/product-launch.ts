import { productPathFromStartParam } from "@stenzo/shared";

export function productLaunchPath(
  webApp:
    | { initData?: string; initDataUnsafe?: { start_param?: string } }
    | undefined,
  search: string,
): string | null {
  // This is navigation to a public product only, never authentication/authorization.
  const signed = new URLSearchParams(webApp?.initData ?? "");
  if (signed.has("start_param"))
    return signed.getAll("start_param").length === 1
      ? productPathFromStartParam(signed.get("start_param"))
      : null;
  if (webApp?.initDataUnsafe?.start_param !== undefined)
    return productPathFromStartParam(webApp.initDataUnsafe.start_param);
  const query = new URLSearchParams(search);
  return query.getAll("tgWebAppStartParam").length === 1
    ? productPathFromStartParam(query.get("tgWebAppStartParam"))
    : null;
}
