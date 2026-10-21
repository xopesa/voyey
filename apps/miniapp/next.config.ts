import { resolve } from "node:path";

import { config } from "dotenv";
import type { NextConfig } from "next";

import { apiRewrite } from "./src/lib/api-proxy";

config({ path: resolve(process.cwd(), "../../.env"), quiet: true });

const nextConfig: NextConfig = {
  ...(process.env.STENZO_CONTAINER_BUILD === "1"
    ? {
        output: "standalone",
        outputFileTracingRoot: resolve(process.cwd(), "../.."),
      }
    : {}),
  async rewrites() {
    return [
      apiRewrite({
        API_URL: process.env.API_URL,
        API_PORT: process.env.API_PORT,
        VERCEL: process.env.VERCEL,
      }),
    ];
  },
};

export default nextConfig;
