import { randomUUID } from "node:crypto";

import {
  imageExtensionByMimeType,
  validateImageUpload,
} from "./image-validation.js";
import type {
  ImageUploadInput,
  PublicStorageProvider,
  StorageProvider,
  StoredImage,
  StoredPrivateImage,
} from "./types.js";

export class ImageStorageService {
  public constructor(
    private readonly provider: PublicStorageProvider,
    private readonly maxUploadBytes: number,
    private readonly createId: () => string = randomUUID,
  ) {}

  public async upload(input: ImageUploadInput): Promise<StoredImage> {
    const detectedMimeType = validateImageUpload(
      input.data,
      input.declaredMimeType,
      this.maxUploadBytes,
    );
    const key = `products/${this.createId()}.${imageExtensionByMimeType[detectedMimeType]}`;
    await this.provider.upload({
      key,
      data: input.data,
      contentType: detectedMimeType,
    });
    return {
      key,
      url: this.provider.getPublicUrl(key),
      mimeType: detectedMimeType,
      size: input.data.length,
    };
  }

  public delete(key: string): Promise<void> {
    return this.provider.delete(key);
  }
}

export class PrivateImageStorageService {
  public constructor(
    private readonly provider: StorageProvider,
    private readonly maxUploadBytes: number,
    private readonly createId: () => string = randomUUID,
  ) {}

  public async upload(input: ImageUploadInput): Promise<StoredPrivateImage> {
    const detectedMimeType = validateImageUpload(
      input.data,
      input.declaredMimeType,
      this.maxUploadBytes,
    );
    const key = `payment-proofs/${this.createId()}.${imageExtensionByMimeType[detectedMimeType]}`;
    await this.provider.upload({
      key,
      data: input.data,
      contentType: detectedMimeType,
    });
    return {
      key,
      mimeType: detectedMimeType,
      size: input.data.length,
    };
  }

  public delete(key: string): Promise<void> {
    return this.provider.delete(key);
  }

  public read(key: string): Promise<Buffer> {
    return this.provider.read(key);
  }
}
