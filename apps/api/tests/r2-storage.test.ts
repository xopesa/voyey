import Fastify from "fastify";
import { beforeEach, describe, expect, it, vi } from "vitest";

const sdk = vi.hoisted(() => ({ send: vi.fn(), configs: [] as unknown[] }));
vi.mock("@aws-sdk/client-s3", async (original) => ({
  ...(await original<typeof import("@aws-sdk/client-s3")>()),
  S3Client: class {
    send = sdk.send;
    constructor(config: unknown) {
      sdk.configs.push(config);
    }
  },
}));
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import {
  R2PrivateStorageProvider,
  R2PublicStorageProvider,
} from "../src/modules/media/r2-storage.js";
import { registerPublicMediaRoute } from "../src/modules/media/static-route.js";

const config = {
  accountId: "0".repeat(32),
  accessKeyId: "test-only-access",
  secretAccessKey: "test-only-secret",
  bucket: "public-test",
};
const publicStore = () =>
  new R2PublicStorageProvider(config, "https://api.example/media");
const privateStore = () =>
  new R2PrivateStorageProvider({ ...config, bucket: "private-test" });

describe("R2 storage boundary", () => {
  beforeEach(() => {
    sdk.send.mockReset();
    sdk.configs.length = 0;
  });
  it("writes products and proofs to separate buckets with atomic no-overwrite", async () => {
    const pub = publicStore();
    const priv = privateStore();
    sdk.send.mockResolvedValue({});
    for (const [provider, key, bucket, cache] of [
      [pub, "products/a.png", "public-test", "public, max-age=3600"],
      [priv, "payment-proofs/a.png", "private-test", "private, no-store"],
    ] as const) {
      await provider.upload({
        key,
        data: Buffer.from("image"),
        contentType: "image/png",
      });
      const command = sdk.send.mock.lastCall![0];
      expect(command).toBeInstanceOf(PutObjectCommand);
      expect(command.input).toMatchObject({
        Bucket: bucket,
        Key: key,
        IfNoneMatch: "*",
        CacheControl: cache,
        ContentType: "image/png",
      });
      expect(command.input).not.toHaveProperty("ACL");
    }
    expect(sdk.configs[0]).toMatchObject({
      region: "auto",
      endpoint: `https://${config.accountId}.r2.cloudflarestorage.com`,
    });
    expect(pub.getPublicUrl("products/a.png")).toBe(
      "https://api.example/media/products/a.png",
    );
    expect(priv).not.toHaveProperty("getPublicUrl");
  });
  it("reads private bytes only with the private bucket credentials and supports deletion", async () => {
    const provider = privateStore();
    sdk.send.mockResolvedValueOnce({
      Body: { transformToByteArray: async () => new Uint8Array([1, 2, 3]) },
    });
    expect(await provider.read("payment-proofs/a.png")).toEqual(
      Buffer.from([1, 2, 3]),
    );
    expect(sdk.send.mock.lastCall![0]).toBeInstanceOf(GetObjectCommand);
    expect(sdk.send.mock.lastCall![0].input).toEqual({
      Bucket: "private-test",
      Key: "payment-proofs/a.png",
    });
    sdk.send.mockResolvedValueOnce({});
    await provider.delete("payment-proofs/a.png");
    expect(sdk.send.mock.lastCall![0]).toBeInstanceOf(DeleteObjectCommand);
  });
  it("rejects traversal, unsupported types and cross-namespace reads before an SDK call", async () => {
    const pub = publicStore();
    const priv = privateStore();
    for (const key of [
      "../secret.png",
      "products/../secret.png",
      "products/nested/a.png",
      "products/a.svg",
      "payment-proofs/a.png",
      "products/a.png?x=y",
    ])
      await expect(pub.read(key)).rejects.toThrow("Invalid storage key");
    await expect(priv.read("products/a.png")).rejects.toThrow(
      "Invalid storage key",
    );
    expect(sdk.send).not.toHaveBeenCalled();
    for (const url of [
      "http://media.example",
      "https://user:pass@media.example",
      "https://media.example/?token=x",
    ])
      expect(() => new R2PublicStorageProvider(config, url)).toThrow();
  });
  it("sanitizes credential-bearing SDK errors and handles a missing body", async () => {
    const provider = privateStore();
    for (const operation of [
      () => provider.read("payment-proofs/a.png"),
      () => provider.delete("payment-proofs/a.png"),
      () =>
        provider.upload({
          key: "payment-proofs/a.png",
          data: Buffer.alloc(1),
          contentType: "image/png",
        }),
    ]) {
      sdk.send.mockRejectedValueOnce(
        new Error("credential-bearing diagnostic"),
      );
      try {
        await operation();
        expect.fail("must fail");
      } catch (error) {
        expect(String(error)).not.toContain("credential-bearing");
        expect(error).not.toHaveProperty("cause");
      }
    }
    sdk.send.mockResolvedValueOnce({});
    await expect(provider.read("payment-proofs/a.png")).rejects.toThrow(
      "Unable to read stored image",
    );
  });
  it("keeps legacy /media/products links while denying proofs on the public route", async () => {
    const app = Fastify();
    registerPublicMediaRoute(app, publicStore(), "https://api.example/media");
    sdk.send.mockResolvedValueOnce({
      Body: { transformToByteArray: async () => new Uint8Array([1, 2, 3]) },
    });
    try {
      const image = await app.inject("/media/products/a.png");
      expect(image.statusCode).toBe(200);
      expect(image.headers["content-type"]).toContain("image/png");
      expect(image.headers["cache-control"]).toBe("public, max-age=3600");
      expect((await app.inject("/media/payment-proofs/a.png")).statusCode).toBe(
        404,
      );
      expect(sdk.send).toHaveBeenCalledTimes(1);
    } finally {
      await app.close();
    }
  });
});
