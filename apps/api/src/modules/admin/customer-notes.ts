import { atomic, prisma } from "@stenzo/database";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { HttpError } from "../auth/errors.js";
import { adminAuditActor } from "./audit-actor.js";
import { adminPrincipalHash } from "../../d1/principal.js";
import { decodeCustomerCursor } from "./customers.js";

export type NoteDto = {
  id: string;
  body: string;
  createdAt: string;
  createdBy: string;
};
export class CustomerNoteService {
  async list(userId: string, limit = 20, cursor?: string) {
    if (!(await prisma.user.findUnique({ where: { id: userId } })))
      throw new HttpError(404, "customerMissing");
    const after = decodeCustomerCursor(cursor);
    const rows = await prisma.customerNote.findMany({
      where: {
        userId,
        ...(after
          ? {
              OR: [
                { createdAt: { lt: new Date(after.time) } },
                { createdAt: new Date(after.time), id: { lt: after.id } },
              ],
            }
          : {}),
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit + 1,
    });
    const visible = rows.slice(0, limit),
      last = visible.at(-1);
    return {
      notes: visible.map(noteDto),
      nextCursor:
        rows.length > limit && last
          ? Buffer.from(
              JSON.stringify({ time: last.createdAt.getTime(), id: last.id }),
            ).toString("base64url")
          : null,
    };
  }
  async create(userId: string, actorId: string, input: unknown) {
    const parsed = z
      .object({ body: z.string().trim().min(1).max(2000) })
      .strict()
      .safeParse(input);
    if (!parsed.success) throw new HttpError(400, "customerNoteInvalid");
    const actor = adminAuditActor(actorId),
      hash = adminPrincipalHash();
    const createdBy = actor.actorId
      ? `telegram-admin:${actor.actorId}`
      : `web-admin:${hash ?? actor.metadata.adminPrincipal}`;
    const id = await atomic(async (batch) => {
      if (!(await prisma.user.findUnique({ where: { id: userId } })))
        throw new HttpError(404, "customerMissing");
      const noteId = batch.insert("CustomerNote", {
        userId,
        body: parsed.data.body,
        createdBy,
      });
      batch.insert("AuditLog", {
        actorId: actor.actorId,
        action: "customer.note.created",
        entityType: "CustomerNote",
        entityId: noteId,
        metadata: { ...actor.metadata, userId, noteId },
      });
      return noteId;
    });
    return noteDto(
      await prisma.customerNote.findUniqueOrThrow({ where: { id } }),
    );
  }
}
function noteDto(note: {
  id: string;
  body: string;
  createdAt: Date;
  createdBy: string;
}): NoteDto {
  return {
    id: note.id,
    body: note.body,
    createdAt: note.createdAt.toISOString(),
    createdBy: note.createdBy.startsWith("web-admin:")
      ? "web-admin"
      : "telegram-admin",
  };
}
export function registerCustomerNotes(
  app: FastifyInstance,
  guard: (r: FastifyRequest) => Promise<void>,
) {
  const service = new CustomerNoteService();
  app.get<{ Params: { id: string } }>(
    "/admin/customers/:id/notes",
    { preHandler: guard },
    async (r) => {
      const p = z
        .object({
          limit: z.coerce.number().int().min(1).max(50).default(20),
          cursor: z.string().max(512).optional(),
        })
        .strict()
        .safeParse(r.query);
      if (!p.success) throw new HttpError(400, "Invalid note query");
      return service.list(r.params.id, p.data.limit, p.data.cursor);
    },
  );
  app.post<{ Params: { id: string } }>(
    "/admin/customers/:id/notes",
    { preHandler: guard },
    async (r, reply) => {
      const actor = r.webAdminActor ?? r.currentUser?.id;
      if (!actor) throw new HttpError(401, "Admin session required");
      return reply
        .status(201)
        .send({ note: await service.create(r.params.id, actor, r.body) });
    },
  );
}
