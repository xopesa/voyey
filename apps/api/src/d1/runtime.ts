import { AsyncLocalStorage } from "node:async_hooks";
import type {
  PublicStorageProvider,
  StorageProvider,
  StorageWriteInput,
} from "../modules/media/types.js";
import { MediaStorageUnavailableError } from "../modules/media/errors.js";
export interface Bucket {
  put(
    key: string,
    data: Uint8Array,
    options: { httpMetadata: { contentType: string } },
  ): Promise<unknown>;
  delete(key: string): Promise<unknown>;
  get(key: string): Promise<{ arrayBuffer(): Promise<ArrayBuffer> } | null>;
}
type Bindings = {
  publicBucket?: Bucket;
  privateBucket?: Bucket;
  origin: string;
};
const bindings = new AsyncLocalStorage<Bindings>();
export const withStorage = <T>(value: Bindings, fn: () => T): T =>
  bindings.run(value, fn);
export function boundStorage(
  privateAccess = false,
): PublicStorageProvider | undefined {
  const value = bindings.getStore();
  if (!value) return undefined;
  const bucket = privateAccess ? value.privateBucket : value.publicBucket;
  function requireBucket() {
    if (!bucket) throw new MediaStorageUnavailableError();
    return bucket;
  }
  const provider: StorageProvider = {
    async upload(input: StorageWriteInput) {
      await requireBucket().put(input.key, new Uint8Array(input.data), {
        httpMetadata: { contentType: input.contentType },
      });
    },
    async delete(key) {
      await requireBucket().delete(key);
    },
    async read(key) {
      const result = await requireBucket().get(key);
      if (!result) throw new MediaStorageUnavailableError();
      return Buffer.from(await result.arrayBuffer());
    },
  };
  return { ...provider, getPublicUrl: (key) => value.origin + "/media/" + key };
}
