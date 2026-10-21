import { describe, expect, it } from "vitest";
import {
  validateCloudflareStorage,
  type StorageEnvironment,
} from "../src/config/cloudflare.js";

const configured: StorageEnvironment = {
  STORAGE_DRIVER: "r2",
  STORAGE_PUBLIC_BASE_URL: "https://api.example/media",
  DATABASE_URL:
    "postgresql://test:test@localhost/test?sslmode=require&sslaccept=strict",
  CLOUDFLARE_CONTAINER: "1",
  R2_ACCOUNT_ID: "0".repeat(32),
  R2_ACCESS_KEY_ID: "test-only",
  R2_SECRET_ACCESS_KEY: "test-only",
  R2_PUBLIC_BUCKET: "products-test",
  R2_PRIVATE_BUCKET: "proofs-test",
};
describe("Cloudflare runtime configuration boundary", () => {
  it("accepts R2 with separate buckets and verified PostgreSQL TLS", () => {
    expect(() => validateCloudflareStorage(configured)).not.toThrow();
  });
  it("keeps local/Turon defaults and Vercel storage modes compatible", () => {
    for (const driver of ["local", "vercel-blob"] as const)
      expect(() =>
        validateCloudflareStorage({
          ...configured,
          CLOUDFLARE_CONTAINER: undefined,
          STORAGE_DRIVER: driver,
          DATABASE_URL: "unused-local-connection",
        }),
      ).not.toThrow();
  });
  it("rejects ephemeral storage, missing credentials, same buckets and insecure public URLs", () => {
    for (const delta of [
      { STORAGE_DRIVER: "local" as const },
      { R2_ACCESS_KEY_ID: undefined },
      { R2_PRIVATE_BUCKET: configured.R2_PUBLIC_BUCKET },
      { STORAGE_PUBLIC_BASE_URL: "http://api.example/media" },
    ])
      expect(() =>
        validateCloudflareStorage({ ...configured, ...delta }),
      ).toThrow();
  });
  it("rejects unverified/disabled PostgreSQL TLS without exposing a URL", () => {
    for (const DATABASE_URL of [
      "postgresql://test:test@localhost/test",
      "postgresql://test:test@localhost/test?sslmode=disable",
      "postgresql://test:test@localhost/test?sslmode=require&sslaccept=accept_invalid_certs",
      "credential-bearing-invalid-url",
    ]) {
      try {
        validateCloudflareStorage({ ...configured, DATABASE_URL });
        expect.fail("must fail");
      } catch (error) {
        expect(String(error)).toContain("requires PostgreSQL TLS");
        expect(String(error)).not.toContain(DATABASE_URL);
      }
    }
  });
});
