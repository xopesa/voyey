import { database, type Batch } from "@stenzo/database";
import type { Bucket } from "./runtime.js";
import {
  InvalidStorageKeyError,
  MediaStorageError,
} from "../modules/media/errors.js";
const chunkSize = 256 * 1024;
export class D1MediaBucket implements Bucket {
  constructor(private readonly privateAccess: boolean) {}
  private check(key: string) {
    const pattern = this.privateAccess
      ? /^payment-proofs\/[a-zA-Z0-9_-]+\.(png|jpe?g|webp)$/
      : /^products\/[a-zA-Z0-9_-]+\.(png|jpe?g|webp)$/;
    if (!pattern.test(key)) throw new InvalidStorageKeyError();
  }
  private putStatements(
    key: string,
    data: Uint8Array,
    options: { httpMetadata: { contentType: string } },
  ) {
    this.check(key);
    if (!data.length || data.length > 5 * 1024 * 1024)
      throw new MediaStorageError("Upload size is outside the preview limit");
    const db = database();
    const statements = [
      db
        .prepare(
          "INSERT INTO MediaObject (key,private,contentType,size,etag,createdAt) VALUES (?,?,?,?,?,?)",
        )
        .bind(
          key,
          Number(this.privateAccess),
          options.httpMetadata.contentType,
          data.length,
          crypto.randomUUID(),
          Date.now(),
        ),
    ];
    for (let offset = 0; offset < data.length; offset += chunkSize)
      statements.push(
        db
          .prepare(
            "INSERT INTO MediaChunk (objectKey,ordinal,data) VALUES (?,?,?)",
          )
          .bind(
            key,
            offset / chunkSize,
            new Uint8Array(data.slice(offset, offset + chunkSize)).buffer,
          ),
      );
    return statements;
  }
  /** Linked proofs and their payment metadata share one guarded D1 batch. */
  putInBatch(
    batch: Batch,
    key: string,
    data: Uint8Array,
    options: { httpMetadata: { contentType: string } },
  ) {
    batch.statements.push(...this.putStatements(key, data, options));
  }
  async put(
    key: string,
    data: Uint8Array,
    options: { httpMetadata: { contentType: string } },
  ) {
    await database().batch(this.putStatements(key, data, options));
  }
  async delete(key: string) {
    this.check(key);
    await database()
      .prepare("DELETE FROM MediaObject WHERE key=? AND private=?")
      .bind(key, Number(this.privateAccess))
      .run();
  }
  async get(key: string) {
    this.check(key);
    const meta = await database()
      .prepare(
        "SELECT contentType,size,etag FROM MediaObject WHERE key=? AND private=?",
      )
      .bind(key, Number(this.privateAccess))
      .first<{ contentType: string; size: number; etag: string }>();
    if (!meta) return null;
    const { results } = await database()
      .prepare("SELECT data FROM MediaChunk WHERE objectKey=? ORDER BY ordinal")
      .bind(key)
      .all<{ data: ArrayBuffer | number[] | Uint8Array }>();
    const body = new Uint8Array(meta.size);
    let offset = 0;
    for (const row of results) {
      const chunk = new Uint8Array(row.data);
      body.set(chunk, offset);
      offset += chunk.length;
    }
    if (offset !== meta.size)
      throw new MediaStorageError("Stored image is incomplete");
    return {
      body,
      httpEtag: `"${meta.etag}"`,
      arrayBuffer: async () => body.buffer,
      writeHttpMetadata: (headers: Headers) =>
        headers.set("Content-Type", meta.contentType),
    };
  }
}
