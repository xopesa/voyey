import { put, del, get } from "@vercel/blob";
import { InvalidStorageKeyError, MediaStorageError } from "./errors.js";
import type {
  PublicStorageProvider,
  StorageProvider,
  StorageWriteInput,
} from "./types.js";

class BlobStorage implements StorageProvider {
  constructor(
    private readonly token: string,
    private readonly access: "public" | "private",
    private readonly prefix: "products" | "payment-proofs",
    private readonly baseUrl?: string,
  ) {}
  protected validateKey(key: string) {
    if (
      !new RegExp(`^${this.prefix}/[a-z0-9][a-z0-9_-]*\\.(jpg|png|webp)$`).test(
        key,
      )
    )
      throw new InvalidStorageKeyError();
  }
  async upload(input: StorageWriteInput) {
    this.validateKey(input.key);
    try {
      const blob = await put(input.key, input.data, {
        access: this.access,
        token: this.token,
        addRandomSuffix: false,
        allowOverwrite: false,
        contentType: input.contentType,
      });
      const expected = this.baseUrl
        ? `${this.baseUrl}/${input.key}`
        : undefined;
      if (
        blob.pathname !== input.key ||
        (expected && blob.url !== expected) ||
        (this.access === "private" &&
          !new URL(blob.url).hostname.endsWith(
            ".private.blob.vercel-storage.com",
          ))
      )
        throw new Error("Unexpected Blob store response");
    } catch {
      throw new MediaStorageError("Unable to store uploaded image");
    }
  }
  async delete(key: string) {
    this.validateKey(key);
    try {
      await del(key, { token: this.token });
    } catch {
      throw new MediaStorageError("Unable to delete stored image");
    }
  }
  async read(key: string) {
    this.validateKey(key);
    try {
      const result = await get(key, {
        access: this.access,
        token: this.token,
        useCache: false,
      });
      if (!result || result.statusCode !== 200)
        throw new Error("Blob not found");
      return Buffer.from(await new Response(result.stream).arrayBuffer());
    } catch {
      throw new MediaStorageError("Unable to read stored image");
    }
  }
}

export class VercelBlobPrivateStorageProvider extends BlobStorage {
  constructor(token: string) {
    super(token, "private", "payment-proofs");
  }
}

export class VercelBlobPublicStorageProvider
  extends BlobStorage
  implements PublicStorageProvider
{
  private readonly publicBaseUrl: string;
  constructor(token: string, baseUrl: string) {
    const url = new URL(baseUrl);
    if (
      url.protocol !== "https:" ||
      !/^[a-z0-9-]+(?:\.public)?\.blob\.vercel-storage\.com$/.test(
        url.hostname,
      ) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.pathname !== "/"
    )
      throw new Error("Invalid public Blob base URL");
    super(token, "public", "products", url.origin);
    this.publicBaseUrl = url.origin;
  }
  getPublicUrl(key: string) {
    this.validateKey(key);
    return `${this.publicBaseUrl}/${key}`;
  }
}
