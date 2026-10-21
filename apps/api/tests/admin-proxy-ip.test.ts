import { createHmac } from "node:crypto";
import type { FastifyRequest } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("../src/config/env.js", () => ({
  env: {
    ADMIN_PROXY_SECRET: "test-admin-proxy-secret-at-least-32-characters",
    get NODE_ENV() {
      return process.env.NODE_ENV;
    },
  },
}));
import { adminLoginIp } from "../src/modules/admin/proxy-ip.js";
afterEach(() => vi.unstubAllEnvs());
const request = (headers: Record<string, string>) =>
  ({ headers, ip: "127.0.0.1" }) as FastifyRequest;
describe("trusted admin proxy IP", () => {
  it("preserves local direct login behavior", () => {
    vi.stubEnv("VERCEL", "");
    expect(adminLoginIp(request({ "x-forwarded-for": "1.2.3.4" }))).toBe(
      "127.0.0.1",
    );
  });
  it("requires a fresh signed platform IP in Vercel; rejects spoofing/replay", () => {
    vi.stubEnv("VERCEL", "1");
    const ip = "203.0.113.15",
      at = String(Date.now());
    const headers = {
      "x-stenzo-client-ip": ip,
      "x-stenzo-client-at": at,
      "x-stenzo-client-signature": createHmac(
        "sha256",
        "test-admin-proxy-secret-at-least-32-characters",
      )
        .update(`${at}:${ip}`)
        .digest("hex"),
    };
    expect(adminLoginIp(request(headers))).toBe(ip);
    for (const altered of [
      {},
      { ...headers, "x-stenzo-client-ip": "203.0.113.16" },
      { ...headers, "x-stenzo-client-at": String(Date.now() - 60000) },
      { ...headers, "x-stenzo-client-signature": "bad" },
    ])
      expect(() => adminLoginIp(request(altered))).toThrow(
        "Invalid admin proxy request",
      );
  });
  it("requires the same signature for ISPmanager production logins", () => {
    vi.stubEnv("VERCEL", "");
    vi.stubEnv("NODE_ENV", "production");
    const ip = "203.0.113.20",
      at = String(Date.now());
    expect(
      adminLoginIp(
        request({
          "x-stenzo-client-ip": ip,
          "x-stenzo-client-at": at,
          "x-stenzo-client-signature": createHmac(
            "sha256",
            "test-admin-proxy-secret-at-least-32-characters",
          )
            .update(`${at}:${ip}`)
            .digest("hex"),
        }),
      ),
    ).toBe(ip);
    expect(() =>
      adminLoginIp(request({ "x-real-ip": ip, "x-forwarded-for": ip })),
    ).toThrow("Invalid admin proxy request");
  });
});
