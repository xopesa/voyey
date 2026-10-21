export interface StorageEnvironment {
  STORAGE_DRIVER: "local" | "vercel-blob" | "r2";
  STORAGE_PUBLIC_BASE_URL: string;
  DATABASE_URL: string;
  CLOUDFLARE_CONTAINER?: "1";
  R2_ACCOUNT_ID?: string;
  R2_ACCESS_KEY_ID?: string;
  R2_SECRET_ACCESS_KEY?: string;
  R2_PUBLIC_BUCKET?: string;
  R2_PRIVATE_BUCKET?: string;
}

export function validateCloudflareStorage(env: StorageEnvironment): void {
  if (
    env.STORAGE_DRIVER === "r2" &&
    (!env.R2_ACCOUNT_ID ||
      !env.R2_ACCESS_KEY_ID ||
      !env.R2_SECRET_ACCESS_KEY ||
      !env.R2_PUBLIC_BUCKET ||
      !env.R2_PRIVATE_BUCKET ||
      env.R2_PUBLIC_BUCKET === env.R2_PRIVATE_BUCKET ||
      !env.STORAGE_PUBLIC_BASE_URL.startsWith("https://"))
  )
    throw new Error(
      "R2 requires account/credentials, separate public/private buckets and HTTPS STORAGE_PUBLIC_BASE_URL",
    );
  if (env.CLOUDFLARE_CONTAINER !== "1") return;
  if (env.STORAGE_DRIVER !== "r2")
    throw new Error("Cloudflare API requires durable R2 storage");
  let verifiedTls = false;
  try {
    const database = new URL(env.DATABASE_URL);
    verifiedTls =
      ["postgres:", "postgresql:"].includes(database.protocol) &&
      database.searchParams.get("sslmode") === "require" &&
      database.searchParams.get("sslaccept") === "strict";
  } catch {
    /* Sanitize malformed URL errors: they may otherwise include credentials. */
  }
  if (!verifiedTls)
    throw new Error(
      "Cloudflare API requires PostgreSQL TLS with sslmode=require and sslaccept=strict",
    );
}
