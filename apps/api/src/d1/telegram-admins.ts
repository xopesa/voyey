import { atomic, prisma, type Batch } from "@stenzo/database";
import { validTelegramAdminId, type TelegramAdminDto } from "@stenzo/shared";
import type { TelegramAdmin } from "@stenzo/database";
import type {
  TelegramAdminStore,
  TelegramAdminPatch,
} from "../modules/admin/telegram.js";
import type {
  AdminRecipientSource,
  AdminNotificationEvent,
} from "../modules/notifications/types.js";
import { HttpError } from "../modules/auth/errors.js";
import { adminAuditActor } from "../modules/admin/audit-actor.js";
import { adminPrincipalHash } from "./principal.js";

function audit(
  batch: Batch,
  actorId: string,
  action: string,
  row: TelegramAdmin,
) {
  const actor = adminAuditActor(actorId);
  batch.insert("AuditLog", {
    actorId: actor.actorId,
    action,
    entityType: "TelegramAdmin",
    entityId: row.id,
    metadata: {
      ...actor.metadata,
      principal: adminPrincipalHash(),
      telegramId: row.telegramId,
      label: row.label,
      isActive: row.isActive,
      notifyNewOrders: row.notifyNewOrders,
      notifyPayments: row.notifyPayments,
    },
  });
}
export class D1TelegramAdminStore
  implements TelegramAdminStore, AdminRecipientSource
{
  private async dto(row: TelegramAdmin): Promise<TelegramAdminDto> {
    const user = await prisma.user.findUnique({
      where: { telegramId: BigInt(row.telegramId) },
      select: {
        username: true,
        firstName: true,
        lastName: true,
        preferredLocale: true,
      },
    });
    return {
      id: row.id,
      telegramId: row.telegramId,
      label: row.label,
      isActive: row.isActive,
      notifyNewOrders: row.notifyNewOrders,
      notifyPayments: row.notifyPayments,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      user,
    };
  }
  async list() {
    const rows = await prisma.telegramAdmin.findMany({
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
    // Sequential lookups keep each query below D1's parameter limit.
    const result: TelegramAdminDto[] = [];
    for (const row of rows) result.push(await this.dto(row));
    return result;
  }
  async getByTelegramId(telegramId: string) {
    if (!validTelegramAdminId(telegramId)) return null;
    const row = await prisma.telegramAdmin.findUnique({
      where: { telegramId },
    });
    return row ? this.dto(row) : null;
  }
  async isAdmin(telegramId: string) {
    return Boolean((await this.getByTelegramId(telegramId))?.isActive);
  }
  async recipients(event: AdminNotificationEvent) {
    return (await this.list())
      .filter(
        (row) =>
          row.isActive &&
          (event === "order.created"
            ? row.notifyNewOrders
            : row.notifyPayments),
      )
      .map((row) => ({
        telegramId: row.telegramId,
        preferredLocale: row.user?.preferredLocale ?? ("uz" as const),
      }));
  }
  async create(
    actor: string,
    input: { telegramId: string; label?: string | null },
  ) {
    if (!validTelegramAdminId(input.telegramId))
      throw new HttpError(400, "Invalid Telegram ID");
    const id = await atomic(async (batch) => {
      if (
        await prisma.telegramAdmin.findUnique({
          where: { telegramId: input.telegramId },
        })
      )
        throw new HttpError(409, "Telegram ID already exists");
      const now = new Date();
      const row: TelegramAdmin = {
        id: crypto.randomUUID(),
        telegramId: input.telegramId,
        label: input.label ?? null,
        isActive: true,
        notifyNewOrders: true,
        notifyPayments: true,
        createdBy: adminPrincipalHash() ?? actor,
        createdAt: now,
        updatedAt: now,
      };
      batch.insert("TelegramAdmin", { ...row });
      audit(batch, actor, "telegram_admin.created", row);
      return row.id;
    });
    return this.dto(
      await prisma.telegramAdmin.findUniqueOrThrow({ where: { id } }),
    );
  }
  async update(actor: string, id: string, input: TelegramAdminPatch) {
    await atomic(async (batch) => {
      const row = await prisma.telegramAdmin.findUnique({ where: { id } });
      if (!row) throw new HttpError(404, "Telegram admin not found");
      const next = { ...row, ...input };
      batch.update("TelegramAdmin", id, { ...input });
      audit(batch, actor, "telegram_admin.updated", next);
      if (row.isActive !== next.isActive)
        audit(
          batch,
          actor,
          next.isActive ? "telegram_admin.enabled" : "telegram_admin.disabled",
          next,
        );
    });
    return this.dto(
      await prisma.telegramAdmin.findUniqueOrThrow({ where: { id } }),
    );
  }
  disable(actor: string, id: string) {
    return this.update(actor, id, { isActive: false });
  }
}
