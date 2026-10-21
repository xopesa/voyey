import { lstat, mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { dirname, parse, relative, resolve, sep } from "node:path";

import { InvalidStorageKeyError, MediaStorageError } from "./errors.js";
import type {
  PublicStorageProvider,
  StorageProvider,
  StorageWriteInput,
} from "./types.js";

const SAFE_STORAGE_KEY = /^[a-z0-9][a-z0-9/_-]*\.(?:jpg|png|webp)$/;

export class LocalFileStorageProvider implements StorageProvider {
  public readonly rootPath: string;

  public constructor(rootPath: string) {
    this.rootPath = resolve(rootPath);
    if (this.rootPath === parse(this.rootPath).root) {
      throw new InvalidStorageKeyError();
    }
  }

  public async upload(input: StorageWriteInput): Promise<void> {
    const target = this.resolveKey(input.key);
    try {
      await this.rejectSymbolicLinks(target);
      await mkdir(dirname(target), { recursive: true, mode: 0o700 });
      await this.rejectSymbolicLinks(target);
      await writeFile(target, input.data, { flag: "wx", mode: 0o600 });
    } catch (error) {
      throw new MediaStorageError("Unable to store uploaded image", {
        cause: error,
      });
    }
  }

  public async delete(key: string): Promise<void> {
    const target = this.resolveKey(key);
    try {
      await this.rejectSymbolicLinks(target);
      await unlink(target);
    } catch (error) {
      if (this.errorCode(error) === "ENOENT") return;
      throw new MediaStorageError("Unable to delete stored image", {
        cause: error,
      });
    }
  }

  public async read(key: string): Promise<Buffer> {
    const target = this.resolveKey(key);
    try {
      await this.rejectSymbolicLinks(target);
      return await readFile(target);
    } catch (error) {
      throw new MediaStorageError("Unable to read stored image", {
        cause: error,
      });
    }
  }

  protected validateKey(key: string): void {
    this.resolveKey(key);
  }

  private async rejectSymbolicLinks(target: string): Promise<void> {
    let current = this.rootPath;
    const segments = ["", ...relative(this.rootPath, target).split(sep)];
    for (const segment of segments) {
      if (segment) current = resolve(current, segment);
      try {
        if ((await lstat(current)).isSymbolicLink())
          throw new InvalidStorageKeyError();
      } catch (error) {
        if (this.errorCode(error) === "ENOENT") return;
        throw error;
      }
    }
  }

  private resolveKey(key: string): string {
    if (
      !SAFE_STORAGE_KEY.test(key) ||
      key.includes("..") ||
      key.includes("\\")
    ) {
      throw new InvalidStorageKeyError();
    }
    const target = resolve(this.rootPath, key);
    const relativePath = relative(this.rootPath, target);
    if (
      !relativePath ||
      relativePath.startsWith("..") ||
      parse(relativePath).root
    ) {
      throw new InvalidStorageKeyError();
    }
    return target;
  }

  private errorCode(error: unknown): string | undefined {
    if (typeof error === "object" && error !== null && "code" in error) {
      return typeof error.code === "string" ? error.code : undefined;
    }
    return undefined;
  }
}

export class LocalStorageProvider
  extends LocalFileStorageProvider
  implements PublicStorageProvider
{
  private readonly publicBaseUrl: string;

  public constructor(rootPath: string, publicBaseUrl: string) {
    super(rootPath);
    this.publicBaseUrl = publicBaseUrl.replace(/\/+$/, "");
  }

  public getPublicUrl(key: string): string {
    this.validateKey(key);
    const encodedKey = key.split("/").map(encodeURIComponent).join("/");
    return `${this.publicBaseUrl}/${encodedKey}`;
  }
}
