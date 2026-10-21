import { createHmac, timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";
import type { FastifyRequest } from "fastify";
import { env } from "../../config/env.js";
import { HttpError } from "../auth/errors.js";

// The Next.js admin proxy signs the platform-provided IP. Never trust arbitrary X-Forwarded-For.
export function adminLoginIp(request: FastifyRequest): string {
  if (!process.env.VERCEL && env.NODE_ENV !== "production") return request.ip;
  const ip = request.headers["x-stenzo-client-ip"];
  const at = request.headers["x-stenzo-client-at"];
  const signature = request.headers["x-stenzo-client-signature"];
  if (
    typeof ip !== "string" ||
    !isIP(ip) ||
    typeof at !== "string" ||
    !/^\d+$/.test(at) ||
    Math.abs(Date.now() - Number(at)) > 30_000 ||
    typeof signature !== "string" ||
    !/^[a-f0-9]{64}$/.test(signature) ||
    !env.ADMIN_PROXY_SECRET
  )
    throw new HttpError(403, "Invalid admin proxy request");
  const expected = createHmac("sha256", env.ADMIN_PROXY_SECRET)
    .update(`${at}:${ip}`)
    .digest();
  if (!timingSafeEqual(expected, Buffer.from(signature, "hex")))
    throw new HttpError(403, "Invalid admin proxy request");
  return ip;
}
