import type { StorageProvider } from "./types.js";
import type { FastifyInstance } from "fastify";
import { mkdir } from "node:fs/promises";
import { LocalFileStorageProvider } from "./local-storage.js";

export function registerLocalMediaRoute(
  app: FastifyInstance,
  rootPath: string,
  publicBaseUrl: string,
): void {
  void app.register(async (mediaScope) => {
    await mkdir(rootPath, { recursive: true, mode: 0o700 });
    registerPublicMediaRoute(
      mediaScope,
      new LocalFileStorageProvider(rootPath),
      publicBaseUrl,
    );
  });
}

// The R2 caller supplies only its public products provider, never private proofs.
export function registerPublicMediaRoute(
  app: FastifyInstance,
  storage: StorageProvider,
  publicBaseUrl: string,
): void {
  const pathname = new URL(publicBaseUrl).pathname.replace(/\/+$/, "");
  const prefix = `${pathname || "/media"}/`;
  void app.register(async (mediaScope) => {
    mediaScope.get<{ Params: { "*": string } }>(
      `${prefix}*`,
      async (request, reply) => {
        const key = request.params["*"];
        const types: Record<string, string> = {
          jpg: "image/jpeg",
          png: "image/png",
          webp: "image/webp",
        };
        const contentType = types[key.split(".").at(-1) ?? ""];
        if (!contentType) return reply.code(404).send({ error: "Not found" });
        try {
          const bytes = await storage.read(key);
          return reply
            .type(contentType)
            .header("X-Content-Type-Options", "nosniff")
            .header("Cache-Control", "public, max-age=3600")
            .send(bytes);
        } catch {
          return reply.code(404).send({ error: "Not found" });
        }
      },
    );
  });
}
