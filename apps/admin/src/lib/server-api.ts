import "server-only";

export function apiUrl(path: string) {
  if (process.env.VERCEL && !process.env.API_URL)
    throw new Error("Vercel requires API_URL");
  const base =
    process.env.API_URL || `http://127.0.0.1:${process.env.API_PORT || "3001"}`;
  const url = new URL(base);
  if (process.env.VERCEL && url.protocol !== "https:")
    throw new Error("Vercel requires HTTPS API_URL");
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.search ||
    url.hash ||
    url.username ||
    url.password
  )
    throw new Error("Invalid API_URL");
  return `${base.replace(/\/+$/, "")}/admin/${path}`;
}
