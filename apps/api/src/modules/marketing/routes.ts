import multipart from "@fastify/multipart";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { HttpError } from "../auth/errors.js";
import { BannerService, publicBanners } from "./banners.js";
import {
  ImageTooLargeError,
  ImageTypeMismatchError,
  UnsupportedImageTypeError,
  MediaStorageError,
  MediaStorageUnavailableError,
} from "../media/index.js";

export function registerPublicBanners(app: FastifyInstance) {
  app.get("/home/banners", async () => ({ banners: await publicBanners() }));
}
export function registerMarketingAdminRoutes(
  app: FastifyInstance,
  banners: BannerService,
  guard: (request: FastifyRequest) => Promise<void>,
) {
  const actor = (r: FastifyRequest) => {
    const id = r.webAdminActor ?? r.currentUser?.id;
    if (!id) throw new HttpError(401, "Admin session required");
    return id;
  };
  app.get("/admin/marketing/banners", { preHandler: guard }, async () => ({
    banners: await banners.list(),
  }));
  app.post("/admin/marketing/banners", { preHandler: guard }, async (r) => ({
    banner: await banners.create(actor(r), r.body),
  }));
  app.patch<{ Params: { id: string } }>(
    "/admin/marketing/banners/:id",
    { preHandler: guard },
    async (r) => ({
      banner: await banners.update(actor(r), r.params.id, r.body),
    }),
  );
  app.delete<{ Params: { id: string } }>(
    "/admin/marketing/banners/:id",
    { preHandler: guard },
    async (r) => banners.delete(actor(r), r.params.id),
  );
  for (const [action, active] of [
    ["activate", true],
    ["deactivate", false],
  ] as const)
    app.post<{ Params: { id: string } }>(
      `/admin/marketing/banners/:id/${action}`,
      { preHandler: guard },
      async (r) => ({
        banner: await banners.setActive(actor(r), r.params.id, active),
      }),
    );
  void app.register(async (scope) => {
    await scope.register(multipart, {
      limits: { files: 1, fields: 0, parts: 1, fileSize: 5242880 },
    });
    scope.post<{ Params: { id: string } }>(
      "/admin/marketing/banners/:id/images/upload",
      { preHandler: guard, bodyLimit: 5242880 + 65536 },
      async (r) => {
        try {
          const file = await r.file();
          if (!file || file.fieldname !== "file")
            throw new HttpError(400, "marketingImageRequired");
          const data = await file.toBuffer();
          if (file.file.truncated) throw new ImageTooLargeError(5242880);
          return {
            banner: await banners.upload(actor(r), r.params.id, {
              data,
              declaredMimeType: file.mimetype,
            }),
          };
        } catch (e) {
          if (
            e instanceof ImageTooLargeError ||
            (e &&
              typeof e === "object" &&
              "code" in e &&
              e.code === "FST_REQ_FILE_TOO_LARGE")
          )
            throw new HttpError(413, "imageTooLarge");
          if (
            e instanceof ImageTypeMismatchError ||
            e instanceof UnsupportedImageTypeError
          )
            throw new HttpError(415, "imageType");
          if (
            e instanceof MediaStorageError ||
            e instanceof MediaStorageUnavailableError
          )
            throw new HttpError(503, "unavailable");
          throw e;
        }
      },
    );
  });
}
