import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import { healthRoutes } from "../src/modules/health/route.js";
import { trustedProxyPeers } from "../src/config/reverse-proxy.js";

describe("deployment readiness and reverse proxy", () => {
  it("keeps liveness independent from the database and sanitizes failed readiness", async () => {
    let available = false;
    const app = Fastify();
    await app.register(healthRoutes, {
      checkDatabase: async () => {
        if (!available) throw new Error("private connection diagnostics");
      },
    });
    try {
      expect((await app.inject("/health")).statusCode).toBe(200);
      const failed = await app.inject("/ready");
      expect(failed.statusCode).toBe(503);
      expect(failed.json()).toEqual({
        status: "unavailable",
        service: "stenzo-api",
      });
      expect(failed.headers["cache-control"]).toBe("no-store");
      available = true;
      expect((await app.inject("/ready")).statusCode).toBe(200);
    } finally {
      await app.close();
    }
  });
  it("trusts only configured proxy peers, including HTTPS scheme", async () => {
    for (const value of [
      "true",
      "1",
      "*",
      "0.0.0.0/0",
      "::/0",
      "127.0.0.1/33",
      "bad",
      "127.0.0.1,",
    ])
      expect(() => trustedProxyPeers(value)).toThrow();
    expect(trustedProxyPeers()).toBe(false);
    const app = Fastify({ trustProxy: trustedProxyPeers("127.0.0.1,::1") });
    app.get("/", async (req) => ({ ip: req.ip, protocol: req.protocol }));
    const headers = {
      "x-forwarded-for": "203.0.113.10",
      "x-forwarded-proto": "https",
    };
    try {
      expect(
        (
          await app.inject({ url: "/", remoteAddress: "127.0.0.1", headers })
        ).json(),
      ).toEqual({ ip: "203.0.113.10", protocol: "https" });
      expect(
        (
          await app.inject({ url: "/", remoteAddress: "198.51.100.5", headers })
        ).json(),
      ).toEqual({ ip: "198.51.100.5", protocol: "http" });
    } finally {
      await app.close();
    }
  });
});
