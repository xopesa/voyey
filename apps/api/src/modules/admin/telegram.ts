import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { validTelegramAdminId, type TelegramAdminDto } from "@stenzo/shared";
import { HttpError } from "../auth/errors.js";

export interface TelegramAdminPatch {
  label?: string | null;
  isActive?: boolean;
  notifyNewOrders?: boolean;
  notifyPayments?: boolean;
}
export interface TelegramAdminStore {
  list(): Promise<TelegramAdminDto[]>;
  getByTelegramId(id: string): Promise<TelegramAdminDto | null>;
  isAdmin(id: string): Promise<boolean>;
  create(
    actor: string,
    input: { telegramId: string; label?: string | null },
  ): Promise<TelegramAdminDto>;
  update(
    actor: string,
    id: string,
    input: TelegramAdminPatch,
  ): Promise<TelegramAdminDto>;
  disable(actor: string, id: string): Promise<TelegramAdminDto>;
}
const label = z.string().trim().max(100).nullable();
const createInput = z
  .object({
    telegramId: z.string().refine(validTelegramAdminId),
    label: label.optional(),
  })
  .strict();
const patchInput = z
  .object({
    label: label.optional(),
    isActive: z.boolean().optional(),
    notifyNewOrders: z.boolean().optional(),
    notifyPayments: z.boolean().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0);

function parse<T extends z.ZodType>(schema: T, value: unknown): z.output<T> {
  const result = schema.safeParse(value);
  if (!result.success)
    throw new HttpError(400, "Invalid Telegram admin settings");
  return result.data;
}

export function registerTelegramAdminRoutes(
  app: FastifyInstance,
  store: TelegramAdminStore,
) {
  // These settings are web-admin-only, even on the legacy bearer-enabled API.
  app.addHook("preHandler", async (request) => {
    if (
      request.url.split("?")[0]?.startsWith("/admin/telegram/") &&
      !request.webAdminActor
    )
      throw new HttpError(403, "Admin web session required");
  });
  app.get("/admin/telegram/admins", async () => ({
    admins: await store.list(),
  }));
  app.post("/admin/telegram/admins", async (request, reply) => {
    const row = await store.create(
      request.webAdminActor!,
      parse(createInput, request.body),
    );
    return reply.code(201).send(row);
  });
  app.patch<{ Params: { id: string } }>(
    "/admin/telegram/admins/:id",
    async (request) =>
      store.update(
        request.webAdminActor!,
        request.params.id,
        parse(patchInput, request.body),
      ),
  );
}
