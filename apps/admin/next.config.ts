import { resolve } from "node:path";
import { config } from "dotenv";
import type { NextConfig } from "next";

config({ path: resolve(process.cwd(), "../../.env"), quiet: true });
const nextConfig: NextConfig = {
  poweredByHeader: false,
  ...(process.env.STENZO_CONTAINER_BUILD === "1"
    ? {
        output: "standalone",
        outputFileTracingRoot: resolve(process.cwd(), "../.."),
      }
    : {}),
};
export default nextConfig;
