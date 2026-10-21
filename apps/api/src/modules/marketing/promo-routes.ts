import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { HttpError } from "../auth/errors.js";
import { PromoCodeService } from "./promo-codes.js";

export function registerPromoValidation(
  app: FastifyInstance,
  guard: (request: FastifyRequest) => Promise<void>,
) {
  const service = new PromoCodeService();
  app.post("/promo-codes/validate", { preHandler: guard }, async (r) => {
    const body = z
      .object({ code: z.string().max(64) })
      .strict()
      .safeParse(r.body);
    if (!body.success) throw new HttpError(400, "Invalid promo code payload");
    if (!r.currentUser) throw new HttpError(401, "Invalid access token");
    return service.validateCart(r.currentUser.id, body.data.code);
  });
}
export function registerPromoAdmin(
  app: FastifyInstance,
  guard: (request: FastifyRequest) => Promise<void>,
) {
  const service = new PromoCodeService();
  const actor = (r: FastifyRequest) => {
    const id = r.webAdminActor ?? r.currentUser?.id;
    if (!id) throw new HttpError(401, "Admin session required");
    return id;
  };
  app.get("/admin/marketing/promo-codes", { preHandler: guard }, async () => ({
    promoCodes: await service.list(),
  }));
  app.post(
    "/admin/marketing/promo-codes",
    { preHandler: guard },
    async (r, reply) =>
      reply
        .status(201)
        .send({ promoCode: await service.save(actor(r), r.body) }),
  );
  app.patch<{ Params: { id: string } }>(
    "/admin/marketing/promo-codes/:id",
    { preHandler: guard },
    async (r) => ({
      promoCode: await service.save(actor(r), r.body, r.params.id),
    }),
  );
  for (const [action, active] of [
    ["activate", true],
    ["deactivate", false],
  ] as const) {
    app.post<{ Params: { id: string } }>(
      `/admin/marketing/promo-codes/:id/${action}`,
      { preHandler: guard },
      async (r) => ({
        promoCode: await service.setActive(actor(r), r.params.id, active),
      }),
    );
  }
  // Intentionally no DELETE endpoint: redemption/history remains permanent.
}
