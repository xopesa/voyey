import {
  R2PublicStorageProvider,
  R2PrivateStorageProvider,
} from "./r2-storage.js";
import { resolve } from "node:path";
import { env } from "../../config/env.js";
import {
  LocalStorageProvider,
  LocalFileStorageProvider,
} from "./local-storage.js";
import {
  VercelBlobPublicStorageProvider,
  VercelBlobPrivateStorageProvider,
} from "./blob-storage.js";
import type { PublicStorageProvider, StorageProvider } from "./types.js";
import { boundStorage } from '../../d1/runtime.js';

export function createPublicStorage(): PublicStorageProvider {
  const binding = boundStorage();
  if (binding) return binding;
  if (env.STORAGE_DRIVER === "r2")
    return new R2PublicStorageProvider(
      r2Config(env.R2_PUBLIC_BUCKET!),
      env.STORAGE_PUBLIC_BASE_URL,
    );
  return env.STORAGE_DRIVER === "vercel-blob"
    ? new VercelBlobPublicStorageProvider(
        env.BLOB_PUBLIC_READ_WRITE_TOKEN!,
        env.BLOB_PUBLIC_BASE_URL!,
      )
    : new LocalStorageProvider(
        resolve(process.cwd(), env.STORAGE_LOCAL_PATH),
        env.STORAGE_PUBLIC_BASE_URL,
      );
}
export function createPrivateStorage(): StorageProvider {
  const binding = boundStorage(true);
  if (binding) return binding;
  if (env.STORAGE_DRIVER === "r2")
    return new R2PrivateStorageProvider(r2Config(env.R2_PRIVATE_BUCKET!));
  return env.STORAGE_DRIVER === "vercel-blob"
    ? new VercelBlobPrivateStorageProvider(env.BLOB_PRIVATE_READ_WRITE_TOKEN!)
    : new LocalFileStorageProvider(
        resolve(process.cwd(), env.STORAGE_PRIVATE_PATH),
      );
}

function r2Config(bucket: string) {
  return {
    accountId: env.R2_ACCOUNT_ID!,
    accessKeyId: env.R2_ACCESS_KEY_ID!,
    secretAccessKey: env.R2_SECRET_ACCESS_KEY!,
    bucket,
  };
}
