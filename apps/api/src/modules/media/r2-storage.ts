import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";

import { InvalidStorageKeyError, MediaStorageError } from "./errors.js";
import type {
  PublicStorageProvider,
  StorageProvider,
  StorageWriteInput,
} from "./types.js";

export interface R2StorageConfig {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
}

class R2Storage implements StorageProvider {
  private readonly client: S3Client;
  constructor(
    private readonly config: R2StorageConfig,
    private readonly prefix: "products" | "payment-proofs",
  ) {
    this.client = new S3Client({
      endpoint: `https://${config.accountId}.r2.cloudflarestorage.com`,
      region: "auto",
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
      requestChecksumCalculation: "WHEN_REQUIRED",
      responseChecksumValidation: "WHEN_REQUIRED",
    });
  }
  protected validateKey(key: string) {
    if (
      !new RegExp(`^${this.prefix}/[a-z0-9][a-z0-9_-]*\\.(jpg|png|webp)$`).test(
        key,
      )
    )
      throw new InvalidStorageKeyError();
  }
  async upload(input: StorageWriteInput): Promise<void> {
    this.validateKey(input.key);
    try {
      await this.client.send(
        new PutObjectCommand({
          Bucket: this.config.bucket,
          Key: input.key,
          Body: input.data,
          ContentType: input.contentType,
          IfNoneMatch: "*",
          CacheControl:
            this.prefix === "products"
              ? "public, max-age=3600"
              : "private, no-store",
        }),
      );
    } catch {
      // SDK exceptions can contain request/credential information. Do not attach them.
      throw new MediaStorageError("Unable to store uploaded image");
    }
  }
  async delete(key: string): Promise<void> {
    this.validateKey(key);
    try {
      await this.client.send(
        new DeleteObjectCommand({ Bucket: this.config.bucket, Key: key }),
      );
    } catch {
      throw new MediaStorageError("Unable to delete stored image");
    }
  }
  async read(key: string): Promise<Buffer> {
    this.validateKey(key);
    try {
      const result = await this.client.send(
        new GetObjectCommand({ Bucket: this.config.bucket, Key: key }),
      );
      if (!result.Body) throw new Error("Missing object body");
      return Buffer.from(await result.Body.transformToByteArray());
    } catch {
      throw new MediaStorageError("Unable to read stored image");
    }
  }
}

export class R2PrivateStorageProvider extends R2Storage {
  constructor(config: R2StorageConfig) {
    super(config, "payment-proofs");
  }
}

export class R2PublicStorageProvider
  extends R2Storage
  implements PublicStorageProvider
{
  private readonly publicBaseUrl: string;
  constructor(config: R2StorageConfig, publicBaseUrl: string) {
    const url = new URL(publicBaseUrl);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      throw new Error("R2 public media requires a clean HTTPS base URL");
    super(config, "products");
    this.publicBaseUrl = publicBaseUrl.replace(/\/+$/, "");
  }
  getPublicUrl(key: string): string {
    this.validateKey(key);
    return `${this.publicBaseUrl}/${key}`;
  }
}
