import { describe, expect, it, vi } from "vitest";
const sdk = vi.hoisted(() => ({ put: vi.fn(), del: vi.fn(), get: vi.fn() }));
vi.mock("@vercel/blob", () => sdk);
import {
  VercelBlobPrivateStorageProvider,
  VercelBlobPublicStorageProvider,
} from "../src/modules/media/blob-storage.js";

describe("Vercel Blob storage boundary", () => {
  it("writes public product images with stable UUID keys and no overwrite", async () => {
    const provider = new VercelBlobPublicStorageProvider(
      "test-public-token",
      "https://test.public.blob.vercel-storage.com",
    );
    const key = "products/test-image.png";
    sdk.put.mockResolvedValueOnce({
      pathname: key,
      url: provider.getPublicUrl(key),
    });
    await provider.upload({
      key,
      data: Buffer.from("test"),
      contentType: "image/png",
    });
    expect(sdk.put).toHaveBeenLastCalledWith(
      key,
      expect.any(Buffer),
      expect.objectContaining({
        access: "public",
        token: "test-public-token",
        allowOverwrite: false,
        addRandomSuffix: false,
      }),
    );
    expect(provider.getPublicUrl(key)).toBe(
      `https://test.public.blob.vercel-storage.com/${key}`,
    );
  });
  it("keeps proofs private and reads authenticated bytes without exposing a URL", async () => {
    const provider = new VercelBlobPrivateStorageProvider("test-private-token");
    const key = "payment-proofs/test-proof.png";
    sdk.put.mockResolvedValueOnce({
      pathname: key,
      url: `https://test.private.blob.vercel-storage.com/${key}`,
    });
    await provider.upload({
      key,
      data: Buffer.from("proof"),
      contentType: "image/png",
    });
    expect(sdk.put).toHaveBeenLastCalledWith(
      key,
      expect.any(Buffer),
      expect.objectContaining({
        access: "private",
        token: "test-private-token",
      }),
    );
    sdk.get.mockResolvedValueOnce({
      statusCode: 200,
      stream: new Response("proof").body,
    });
    expect(await provider.read(key)).toEqual(Buffer.from("proof"));
    expect(sdk.get).toHaveBeenLastCalledWith(key, {
      access: "private",
      token: "test-private-token",
      useCache: false,
    });
    expect(provider).not.toHaveProperty("getPublicUrl");
    await provider.delete(key);
    expect(sdk.del).toHaveBeenLastCalledWith(key, {
      token: "test-private-token",
    });
  });
  it("rejects cross-namespace keys, traversal and private hosts in a public provider", async () => {
    const publicStore = new VercelBlobPublicStorageProvider(
      "test",
      "https://test.public.blob.vercel-storage.com",
    );
    const privateStore = new VercelBlobPrivateStorageProvider("test");
    for (const key of [
      "../file.png",
      "products/../secret.png",
      "https://attacker.example/a.png",
      "products/a/b.png",
      "products/test.svg",
    ])
      await expect(publicStore.delete(key)).rejects.toThrow(
        "Invalid storage key",
      );
    await expect(
      publicStore.read("payment-proofs/proof.png"),
    ).rejects.toThrow();
    await expect(privateStore.read("products/product.png")).rejects.toThrow();
    expect(
      () =>
        new VercelBlobPublicStorageProvider(
          "test",
          "https://test.private.blob.vercel-storage.com",
        ),
    ).toThrow();
  });
  it("sanitizes SDK errors and rejects mismatched store responses", async () => {
    const provider = new VercelBlobPrivateStorageProvider("test-private-token");
    sdk.put.mockRejectedValueOnce(new Error("SDK included credential"));
    await expect(
      provider.upload({
        key: "payment-proofs/a.png",
        data: Buffer.alloc(1),
        contentType: "image/png",
      }),
    ).rejects.toThrow("Unable to store uploaded image");
    sdk.put.mockResolvedValueOnce({
      pathname: "payment-proofs/a.png",
      url: "https://test.public.blob.vercel-storage.com/payment-proofs/a.png",
    });
    await expect(
      provider.upload({
        key: "payment-proofs/a.png",
        data: Buffer.alloc(1),
        contentType: "image/png",
      }),
    ).rejects.toThrow("Unable to store uploaded image");
    sdk.get.mockResolvedValueOnce(null);
    await expect(provider.read("payment-proofs/a.png")).rejects.toThrow(
      "Unable to read stored image",
    );
  });
});
