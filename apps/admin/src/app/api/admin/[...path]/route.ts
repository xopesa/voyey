import type { NextRequest } from "next/server";
import { apiUrl } from "../../../../lib/server-api";
import { createHmac } from "node:crypto";
import { isIP } from "node:net";

export const dynamic = "force-dynamic";

function adminClientIp(headers: Headers, vercel: boolean) {
  if (vercel)
    return headers.get("x-vercel-forwarded-for")?.split(",")[0]?.trim();
  // Trusted ingress overwrites X-Real-IP (Turon Nginx or the private Cloudflare Container Worker).
  // Turon also appends its TCP peer last in XFF. Never expose the Node server directly.
  return (
    headers.get("x-real-ip")?.trim() ||
    headers.get("x-forwarded-for")?.split(",").pop()?.trim()
  );
}
async function proxy(
  request: NextRequest,
  context: { params: Promise<{ path: string[] }> },
) {
  const path = (await context.params).path.join("/");
  const allowed =
    path === "dashboard" ||
    /^orders\/[A-Za-z0-9_-]+\/(?:lifecycle|cancel|stock-reviewed)$/.test(
      path,
    ) ||
    /^finance\/refunds(?:\/[A-Za-z0-9_-]+\/complete)?$/.test(path) ||
    /^finance(?:\/expenses(?:\/[A-Za-z0-9_-]+(?:\/void)?)?)?$/.test(path) ||
    /^orders\/[A-Za-z0-9_-]+\/(?:finance|items\/[A-Za-z0-9_-]+\/procurement-cost)$/.test(
      path,
    ) ||
    /^orders\/manual(?:\/preview)?$/.test(path) ||
    /^customers(?:\/[A-Za-z0-9_-]+(?:\/(?:orders|notes))?)?$/.test(path) ||
    /^marketing\/promo-codes(?:\/[A-Za-z0-9_-]+(?:\/(?:activate|deactivate))?)?$/.test(
      path,
    ) ||
    /^marketing\/banners(?:\/[A-Za-z0-9_-]+(?:\/(?:activate|deactivate|images\/upload))?)?$/.test(
      path,
    ) ||
    /^telegram\/admins(?:\/[A-Za-z0-9_-]+)?$/.test(path) ||
    /^(?:orders(?:\/[A-Za-z0-9_-]+(?:\/(?:status|request-final-payment))?)?|payments(?:\/[A-Za-z0-9_-]+(?:\/(?:proof|approve|reject))?)?)$/.test(
      path,
    ) ||
    /^(?:auth\/(?:login|logout|session)|catalog\/(?:upload-config|categories(?:\/[A-Za-z0-9_-]+(?:\/(?:activate|deactivate|archive|restore))?)?|products(?:\/[A-Za-z0-9_-]+(?:\/(?:activate|deactivate|archive|restore|variants(?:\/generate(?:-preview)?)?|images\/upload))?)?|(?:images|variants)\/[A-Za-z0-9_-]+(?:\/(?:activate|deactivate))?))$/.test(
      path,
    );
  if (!allowed) return Response.json({ error: "Not found" }, { status: 404 });
  const headers = new Headers();
  for (const name of [
    "content-type",
    "origin",
    "x-csrf-token",
    "idempotency-key",
    "x-stenzo-admin",
  ]) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  const token = request.cookies.get("stenzo_admin_session")?.value;
  if (token)
    headers.set("cookie", `stenzo_admin_session=${encodeURIComponent(token)}`);
  if (
    (process.env.VERCEL ||
      (process.env.NODE_ENV === "production" &&
        process.env.API_URL?.startsWith("https://"))) &&
    path === "auth/login"
  ) {
    const secret = process.env.ADMIN_PROXY_SECRET;
    const ip = adminClientIp(request.headers, Boolean(process.env.VERCEL));
    if (!secret || secret.length < 32 || !ip || !isIP(ip))
      return Response.json(
        { error: "Admin proxy unavailable" },
        { status: 503 },
      );
    const at = String(Date.now());
    headers.set("x-stenzo-client-ip", ip);
    headers.set("x-stenzo-client-at", at);
    headers.set(
      "x-stenzo-client-signature",
      createHmac("sha256", secret).update(`${at}:${ip}`).digest("hex"),
    );
  }
  try {
    const isUpload =
      request.method === "POST" && path.endsWith("/images/upload");
    const limit = isUpload
      ? Math.min(
          Number(process.env.MAX_IMAGE_UPLOAD_SIZE) || 5242880,
          20971520,
        ) + 65536
      : path.startsWith("auth/")
        ? 4096
        : 65536;
    // Bound memory while reading multipart bytes; preserve its original boundary.
    let body: Uint8Array | undefined;
    if (request.method !== "GET" && request.body) {
      const reader = request.body.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        size += chunk.value.byteLength;
        if (size > limit) {
          await reader.cancel();
          return Response.json({ error: "Request too large" }, { status: 413 });
        }
        chunks.push(chunk.value);
      }
      if (size) body = Buffer.concat(chunks);
    }
    if (!body) headers.delete("content-type");
    const query = request.nextUrl.search;
    const upstream = await fetch(apiUrl(path) + query, {
      method: request.method,
      headers,
      ...(body ? { body: body as BodyInit } : {}),
      cache: "no-store",
      redirect: "manual",
      signal: AbortSignal.timeout(isUpload ? 60000 : 10000),
    });
    const responseHeaders = new Headers({
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    });
    const isProof =
      /^payments\/[A-Za-z0-9_-]+\/proof$/.test(path) &&
      request.method === "GET";
    if (isProof && upstream.ok) {
      const contentType = upstream.headers.get("content-type")?.split(";")[0];
      if (
        !["image/jpeg", "image/png", "image/webp"].includes(contentType ?? "")
      ) {
        return Response.json(
          { error: "Unsupported proof response" },
          { status: 502 },
        );
      }
      responseHeaders.set("Content-Type", contentType!);
      responseHeaders.set("Cache-Control", "private, no-store");
      responseHeaders.set("X-Content-Type-Options", "nosniff");
      responseHeaders.set("Cross-Origin-Resource-Policy", "same-origin");
      responseHeaders.set(
        "Content-Security-Policy",
        "default-src 'none'; frame-ancestors 'self'",
      );
      // Preserve private binary media without ever converting it to a public storage URL.
      return new Response(upstream.body, {
        status: upstream.status,
        headers: responseHeaders,
      });
    }
    for (const cookie of upstream.headers.getSetCookie())
      responseHeaders.append("Set-Cookie", cookie);
    return new Response(await upstream.text(), {
      status: upstream.status,
      headers: responseHeaders,
    });
  } catch {
    return Response.json(
      { error: "API unavailable" },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}
export const GET = proxy;
export const POST = proxy;
export const PATCH = proxy;
export const DELETE = proxy;
