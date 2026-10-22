import "server-only";
import { cookies } from "next/headers";
import { apiUrl } from "./server-api";

export async function getSession() {
  const token = (await cookies()).get("voyey_admin_session")?.value;
  if (!token) return null;
  try {
    const response = await fetch(apiUrl("auth/session"), {
      headers: { cookie: `voyey_admin_session=${encodeURIComponent(token)}` },
      cache: "no-store",
      signal: AbortSignal.timeout(5000),
    });
    return response.ok
      ? ((await response.json()) as {
          login: string;
          csrfToken: string;
          expiresAt: number;
        })
      : null;
  } catch {
    return null;
  }
}
