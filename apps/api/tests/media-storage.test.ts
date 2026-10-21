import { mkdtemp, rm, mkdir, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";
import Fastify from "fastify";

import type { AdminCatalogRepository } from "../src/modules/admin/catalog/repository.js";
import { AdminCatalogService } from "../src/modules/admin/catalog/service.js";
import type {
  AdminImageRecord,
  AdminProductRecord,
} from "../src/modules/admin/catalog/types.js";
import {
  ImageTooLargeError,
  ImageTypeMismatchError,
  InvalidStorageKeyError,
  MediaStorageError,
  UnsupportedImageTypeError,
} from "../src/modules/media/errors.js";
import { LocalStorageProvider } from "../src/modules/media/local-storage.js";
import { ImageStorageService } from "../src/modules/media/service.js";
import { registerLocalMediaRoute } from "../src/modules/media/static-route.js";
import type {
  StorageProvider,
  StorageWriteInput,
} from "../src/modules/media/types.js";

import { png } from "./fixtures/images.js";
const timestamp = new Date("2026-09-29T00:00:00.000Z");

class TrackingStorageProvider implements StorageProvider {
  public readonly uploaded: StorageWriteInput[] = [];
  public readonly deleted: string[] = [];
  public failUpload = false;
  public failDelete = false;

  public upload(input: StorageWriteInput): Promise<void> {
    if (this.failUpload) throw new MediaStorageError("upload failed");
    this.uploaded.push(input);
    return Promise.resolve();
  }

  public delete(key: string): Promise<void> {
    if (this.failDelete) throw new MediaStorageError("delete failed");
    this.deleted.push(key);
    return Promise.resolve();
  }

  public read(key: string): Promise<Buffer> {
    const upload = this.uploaded.find((item) => item.key === key);
    if (!upload) return Promise.reject(new Error("missing"));
    return Promise.resolve(upload.data);
  }

  public getPublicUrl(key: string): string {
    return `https://media.example/${key}`;
  }
}

function productRecord(): AdminProductRecord {
  const category = {
    id: "category-1",
    nameRu: "Худи",
    nameUz: "Hudi",
    slug: "hoodies",
    sortOrder: 0,
    isActive: true,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  return {
    id: "product-1",
    categoryId: category.id,
    nameRu: "Худи",
    nameUz: "Hudi",
    slug: "hoodie",
    descriptionRu: null,
    descriptionUz: null,
    sourceUrl: null,
    price: 850_000,
    currency: "UZS",
    status: "DRAFT",
    isFeatured: false,
    createdAt: timestamp,
    updatedAt: timestamp,
    category,
    images: [],
    variants: [],
  };
}

describe("image storage", () => {
  it("generates a safe key from detected content instead of the client filename", async () => {
    const provider = new TrackingStorageProvider();
    const service = new ImageStorageService(
      provider,
      1024,
      () => "123e4567-e89b-42d3-a456-426614174000",
    );

    const stored = await service.upload({
      data: png,
      declaredMimeType: "image/png",
    });

    expect(stored).toMatchObject({
      key: "products/123e4567-e89b-42d3-a456-426614174000.png",
      url: "https://media.example/products/123e4567-e89b-42d3-a456-426614174000.png",
      mimeType: "image/png",
      size: png.length,
    });
    expect(provider.uploaded[0]?.key).not.toContain("..");
  });

  it("rejects unsupported, spoofed and oversized image content", async () => {
    const service = new ImageStorageService(
      new TrackingStorageProvider(),
      png.length,
      () => "safe-id",
    );

    await expect(
      service.upload({
        data: Buffer.from("<svg/>"),
        declaredMimeType: "image/svg+xml",
      }),
    ).rejects.toBeInstanceOf(UnsupportedImageTypeError);
    await expect(
      service.upload({ data: png, declaredMimeType: "image/jpeg" }),
    ).rejects.toBeInstanceOf(ImageTypeMismatchError);
    await expect(
      service.upload({
        data: Buffer.concat([png, Buffer.from([0])]),
        declaredMimeType: "image/png",
      }),
    ).rejects.toBeInstanceOf(ImageTooLargeError);
  });

  it("prevents traversal and overwrites in local filesystem storage", async () => {
    const root = await mkdtemp(join(tmpdir(), "stenzo-media-"));
    const provider = new LocalStorageProvider(
      root,
      "http://localhost:3001/media",
    );
    try {
      await expect(
        provider.upload({
          key: "../outside.png",
          data: png,
          contentType: "image/png",
        }),
      ).rejects.toBeInstanceOf(InvalidStorageKeyError);
      await provider.upload({
        key: "products/safe.png",
        data: png,
        contentType: "image/png",
      });
      await expect(
        provider.upload({
          key: "products/safe.png",
          data: png,
          contentType: "image/png",
        }),
      ).rejects.toBeInstanceOf(MediaStorageError);
      await provider.delete("products/safe.png");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("serves only files beneath the configured local media route", async () => {
    const root = await mkdtemp(join(tmpdir(), "stenzo-media-public-"));
    const provider = new LocalStorageProvider(
      root,
      "http://localhost:3001/media",
    );
    const app = Fastify();
    try {
      await provider.upload({
        key: "products/public.png",
        data: png,
        contentType: "image/png",
      });
      registerLocalMediaRoute(app, root, "http://localhost:3001/media");
      const publicFile = await app.inject({
        method: "GET",
        url: "/media/products/public.png",
      });
      const traversal = await app.inject({
        method: "GET",
        url: "/media/%2e%2e/secret.txt",
      });

      expect(publicFile.statusCode).toBe(200);
      expect(publicFile.rawPayload).toEqual(png);
      expect(traversal.statusCode).toBe(404);
    } finally {
      await app.close();
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects storage directory links and never serves non-image files or linked private files", async () => {
    const root = await mkdtemp(join(tmpdir(), "stenzo-media-link-"));
    const outside = await mkdtemp(join(tmpdir(), "stenzo-private-link-"));
    const storage = new LocalStorageProvider(
      root,
      "http://localhost:3001/media",
    );
    const app = Fastify();
    try {
      await mkdir(join(root, "products"));
      await writeFile(join(outside, "private.png"), png);
      await writeFile(join(root, "secret.txt"), "private");
      await symlink(
        outside,
        join(root, "linked"),
        process.platform === "win32" ? "junction" : "dir",
      );
      await expect(storage.read("linked/private.png")).rejects.toBeInstanceOf(
        MediaStorageError,
      );
      await expect(
        storage.upload({
          key: "linked/new.png",
          data: png,
          contentType: "image/png",
        }),
      ).rejects.toBeInstanceOf(MediaStorageError);
      await expect(storage.delete("linked/private.png")).rejects.toBeInstanceOf(
        MediaStorageError,
      );
      registerLocalMediaRoute(app, root, "http://localhost:3001/media");
      expect((await app.inject("/media/linked/private.png")).statusCode).toBe(
        404,
      );
      expect((await app.inject("/media/secret.txt")).statusCode).toBe(404);
    } finally {
      await app.close();
      await rm(root, { recursive: true, force: true });
      await rm(outside, { recursive: true, force: true });
    }
  });

  it("removes an uploaded file when ProductImage creation fails", async () => {
    const provider = new TrackingStorageProvider();
    const storage = new ImageStorageService(provider, 1024, () => "safe-id");
    const databaseError = new Error("database failed");
    const createImage = vi.fn(() => Promise.reject(databaseError));
    const repository = {
      getProduct: () => Promise.resolve(productRecord()),
      createImage,
    } as unknown as AdminCatalogRepository;
    const service = new AdminCatalogService(repository, storage);

    await expect(
      service.uploadImage("admin", "product-1", {
        data: png,
        declaredMimeType: "image/png",
        sortOrder: 0,
        isPrimary: false,
      }),
    ).rejects.toBe(databaseError);
    expect(createImage).toHaveBeenCalledOnce();
    expect(provider.deleted).toEqual(["products/safe-id.png"]);
  });

  it("rejects corrupt product images before storage upload or ProductImage creation", async () => {
    const provider = new TrackingStorageProvider();
    const createImage = vi.fn();
    const repository = {
      getProduct: () => Promise.resolve(productRecord()),
      createImage,
    } as unknown as AdminCatalogRepository;
    const service = new AdminCatalogService(
      repository,
      new ImageStorageService(provider, 1024),
    );
    await expect(
      service.uploadImage("admin", "product-1", {
        data: png.subarray(0, 8),
        declaredMimeType: "image/png",
        sortOrder: 0,
        isPrimary: false,
      }),
    ).rejects.toBeInstanceOf(ImageTypeMismatchError);
    expect(provider.uploaded).toHaveLength(0);
    expect(provider.deleted).toHaveLength(0);
    expect(createImage).not.toHaveBeenCalled();
  });

  it("does not create database metadata when storage upload fails", async () => {
    const provider = new TrackingStorageProvider();
    provider.failUpload = true;
    const createImage = vi.fn();
    const repository = {
      getProduct: () => Promise.resolve(productRecord()),
      createImage,
    } as unknown as AdminCatalogRepository;
    const service = new AdminCatalogService(
      repository,
      new ImageStorageService(provider, 1024, () => "safe-id"),
    );

    await expect(
      service.uploadImage("admin", "product-1", {
        data: png,
        declaredMimeType: "image/png",
        sortOrder: 0,
        isPrimary: false,
      }),
    ).rejects.toBeInstanceOf(MediaStorageError);
    expect(createImage).not.toHaveBeenCalled();
  });

  it("surfaces storage deletion failures after the database record is removed", async () => {
    const provider = new TrackingStorageProvider();
    provider.failDelete = true;
    const deleted: AdminImageRecord = {
      id: "image-1",
      productId: "product-1",
      url: "https://media.example/products/safe-id.png",
      storageKey: "products/safe-id.png",
      sortOrder: 0,
      isPrimary: true,
      createdAt: timestamp,
    };
    const deleteImage = vi.fn(() => Promise.resolve(deleted));
    const repository = { deleteImage } as unknown as AdminCatalogRepository;
    const service = new AdminCatalogService(
      repository,
      new ImageStorageService(provider, 1024),
    );

    await expect(
      service.deleteImage("admin", "image-1"),
    ).rejects.toBeInstanceOf(MediaStorageError);
    expect(deleteImage).toHaveBeenCalledOnce();
  });
});
