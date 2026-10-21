interface ApiProxyEnvironment {
  API_URL?: string;
  API_PORT?: string;
  VERCEL?: string;
}

export function apiRewrite(environment: ApiProxyEnvironment) {
  const configuredUrl = environment.API_URL?.trim();
  if (environment.VERCEL && !configuredUrl)
    throw new Error("Vercel requires API_URL");
  const port = environment.API_PORT?.trim() || "3001";
  if (!configuredUrl && (!/^\d+$/.test(port) || +port < 1 || +port > 65535)) {
    throw new Error("API_PORT must be a port between 1 and 65535");
  }

  const apiUrl = (configuredUrl || `http://127.0.0.1:${port}`).replace(
    /\/+$/,
    "",
  );
  const parsed = new URL(apiUrl);
  if (environment.VERCEL && parsed.protocol !== "https:")
    throw new Error("Vercel requires HTTPS API_URL");
  if (
    !["http:", "https:"].includes(parsed.protocol) ||
    parsed.search ||
    parsed.hash ||
    parsed.username ||
    parsed.password
  ) {
    throw new Error(
      "API_URL must be an HTTP(S) base URL without query or hash",
    );
  }

  return { source: "/api/:path*", destination: `${apiUrl}/:path*` };
}
