import { validateCloudflareStorage } from "./cloudflare.js";
import { isAbsolute, relative, resolve } from "node:path";


import { z } from "zod";
import { trustedProxyPeers } from "./reverse-proxy.js";



const envSchema = z.object({
  ADMIN_TELEGRAM_IDS: z.string().default(""),
  ADMIN_PASSWORD_HASH: z
    .string()
    .refine(
      (value) =>
        !value ||
        /^\$argon2id\$v=19\$m=\d+,t=\d+,p=\d+\$[A-Za-z0-9+/]+\$[A-Za-z0-9+/]+$/.test(
          value,
        ),
      "Expected Argon2id hash",
    )
    .default(""),
  ADMIN_ORIGIN: z
    .url()
    .refine(
      (value) =>
        new URL(value).origin === value &&
        ["http:", "https:"].includes(new URL(value).protocol),
      "Expected exact HTTP(S) origin",
    )
    .default("http://localhost:3002"),
  ADMIN_SESSION_DRIVER: z
    .enum(["memory", "postgres"])
    .default(process.env.NODE_ENV === "production" ? "postgres" : "memory"),
  ADMIN_PROXY_SECRET: z.string().min(32).optional(),
  API_PORT: z.coerce.number().int().positive().max(65_535).default(3001),
  PORT: z.coerce.number().int().positive().max(65_535).optional(),
  INSTANCE_HOST: z.string().trim().min(1).optional(),
  TRUST_PROXY: z.string().optional(),
  CLOUDFLARE_CONTAINER: z.enum(["1"]).optional(),
  DATABASE_URL: z.string().min(1),
  JWT_SECRET: z.string().min(32),
  MAX_IMAGE_UPLOAD_SIZE: z.coerce
    .number()
    .int()
    .positive()
    .max(20 * 1024 * 1024)
    .default(5 * 1024 * 1024),
  MAX_PAYMENT_PROOF_UPLOAD_SIZE: z.coerce
    .number()
    .int()
    .positive()
    .max(20 * 1024 * 1024)
    .default(5 * 1024 * 1024),
  MANUAL_PAYMENT_CARD_HOLDER: z.string().trim().min(1),
  MANUAL_PAYMENT_CARD_NUMBER: z.string().trim().min(1),
  MANUAL_PAYMENT_INSTRUCTIONS_RU: z.string().trim().min(1),
  MANUAL_PAYMENT_INSTRUCTIONS_UZ: z.string().trim().min(1),
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  STORAGE_DRIVER: z.enum(["local", "vercel-blob", "r2"]).default("local"),
  R2_ACCOUNT_ID: z
    .string()
    .regex(/^[a-f0-9]{32}$/)
    .optional(),
  R2_ACCESS_KEY_ID: z.string().min(1).optional(),
  R2_SECRET_ACCESS_KEY: z.string().min(1).optional(),
  R2_PUBLIC_BUCKET: z
    .string()
    .regex(/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/)
    .optional(),
  R2_PRIVATE_BUCKET: z
    .string()
    .regex(/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/)
    .optional(),
  BLOB_PUBLIC_READ_WRITE_TOKEN: z.string().min(1).optional(),
  BLOB_PRIVATE_READ_WRITE_TOKEN: z.string().min(1).optional(),
  BLOB_PUBLIC_BASE_URL: z.url().optional(),
  STORAGE_LOCAL_PATH: z.string().trim().min(1).default("../../storage"),
  STORAGE_PRIVATE_PATH: z
    .string()
    .trim()
    .min(1)
    .default("../../storage-private"),
  STORAGE_PUBLIC_BASE_URL: z.url().default("http://localhost:3001/media"),
  TELEGRAM_BOT_TOKEN: z.string().min(1),
  TELEGRAM_INIT_DATA_TTL_SECONDS: z.coerce
    .number()
    .int()
    .positive()
    .max(900)
    .default(600),
});

export function parseLegacyEnvironment() {
const parsedEnv = envSchema.safeParse(process.env);

if (!parsedEnv.success) {
  throw new Error(
    `Invalid STENZO API environment:\n${z.prettifyError(parsedEnv.error)}`,
  );
}

const publicStorageRoot = resolve(
  process.cwd(),
  parsedEnv.data.STORAGE_LOCAL_PATH,
);
const privateStorageRoot = resolve(
  process.cwd(),
  parsedEnv.data.STORAGE_PRIVATE_PATH,
);
const privatePathFromPublicRoot = relative(
  publicStorageRoot,
  privateStorageRoot,
);
if (
  privatePathFromPublicRoot === "" ||
  (!privatePathFromPublicRoot.startsWith("..") &&
    !isAbsolute(privatePathFromPublicRoot))
) {
  throw new Error(
    "Invalid STENZO API environment: STORAGE_PRIVATE_PATH must not be inside STORAGE_LOCAL_PATH",
  );
}

const env = parsedEnv.data;
const trustProxy = trustedProxyPeers(env.TRUST_PROXY);

if (
  process.env.VERCEL &&
  (env.NODE_ENV !== "production" ||
    env.ADMIN_SESSION_DRIVER !== "postgres" ||
    !env.ADMIN_PASSWORD_HASH ||
    !env.ADMIN_ORIGIN.startsWith("https://"))
)
  throw new Error(
    "Vercel requires production mode, PostgreSQL admin sessions, an admin password hash and an HTTPS ADMIN_ORIGIN",
  );

if (env.NODE_ENV === "production" && env.ADMIN_SESSION_DRIVER !== "postgres")
  throw new Error("Production admin sessions require PostgreSQL");
if (
  env.NODE_ENV === "production" &&
  (!env.ADMIN_PASSWORD_HASH || !env.ADMIN_ORIGIN.startsWith("https://"))
)
  throw new Error(
    "Production admin requires an existing password hash and HTTPS ADMIN_ORIGIN",
  );
if (
  (process.env.VERCEL || env.NODE_ENV === "production") &&
  !env.ADMIN_PROXY_SECRET
)
  throw new Error(
    "Production requires ADMIN_PROXY_SECRET for authenticated client IP forwarding",
  );
if (process.env.VERCEL && env.STORAGE_DRIVER !== "vercel-blob")
  throw new Error("Vercel requires durable Blob storage");
if (
  env.STORAGE_DRIVER === "vercel-blob" &&
  (!env.BLOB_PUBLIC_READ_WRITE_TOKEN ||
    !env.BLOB_PRIVATE_READ_WRITE_TOKEN ||
    !env.BLOB_PUBLIC_BASE_URL ||
    env.BLOB_PUBLIC_READ_WRITE_TOKEN === env.BLOB_PRIVATE_READ_WRITE_TOKEN)
)
  throw new Error(
    "Blob storage requires separate public/private tokens and BLOB_PUBLIC_BASE_URL",
  );
if (
  process.env.VERCEL &&
  (env.MAX_IMAGE_UPLOAD_SIZE > 4_000_000 ||
    env.MAX_PAYMENT_PROOF_UPLOAD_SIZE > 4_000_000)
)
  throw new Error(
    "Vercel server uploads require MAX_IMAGE_UPLOAD_SIZE and MAX_PAYMENT_PROOF_UPLOAD_SIZE <= 4000000 (multipart overhead reserved)",
  );

const adminTelegramIds = new Set(
  env.ADMIN_TELEGRAM_IDS.split(",")
    .map((telegramId) => telegramId.trim())
    .filter(Boolean),
);

validateCloudflareStorage(env);

return {env,trustProxy,adminTelegramIds};
}
