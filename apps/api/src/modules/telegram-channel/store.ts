import { atomic, prisma, type Batch } from "@stenzo/database";
import { createHash, randomUUID } from "node:crypto";
import type { ChannelErrorCode } from "@stenzo/shared";
import { adminAuditActor } from "../admin/audit-actor.js";

export interface PostRecord {
  id: string;
  productId: string;
  channelChatId: string;
  messageId: number | null;
  status: "PENDING" | "PUBLISHED" | "FAILED";
  attemptId: string;
  publishedAt: Date | null;
  lastAttemptAt: Date;
  lastErrorCode: string | null;
}
export interface PublicationStore {
  get(productId: string, channel: string): Promise<PostRecord | null>;
  claim(
    actor: string,
    productId: string,
    slug: string,
    channel: string,
  ): Promise<{ owned: boolean; row: PostRecord }>;
  finish(
    actor: string,
    row: PostRecord,
    slug: string,
    result:
      { messageId: number } | { code: ChannelErrorCode; uncertain: boolean },
  ): Promise<void>;
  recordFailure(
    actor: string,
    productId: string,
    slug: string,
    channel: string,
    code: ChannelErrorCode,
  ): Promise<void>;
}
function audit(
  batch: Batch,
  actorId: string,
  action: string,
  row: Pick<PostRecord, "productId" | "channelChatId">,
  slug: string,
  detail = {},
) {
  const actor = adminAuditActor(actorId);
  batch.insert("AuditLog", {
    actorId: actor.actorId,
    action,
    entityType: "Product",
    entityId: row.productId,
    metadata: {
      ...actor.metadata,
      productId: row.productId,
      productSlug: slug,
      channelRef: createHash("sha256")
        .update(row.channelChatId)
        .digest("hex")
        .slice(0, 16),
      ...detail,
    },
  });
}
export class D1PublicationStore implements PublicationStore {
  get(productId: string, channelChatId: string): Promise<PostRecord | null> {
    return prisma.telegramProductPost.findUnique({
      where: { productId_channelChatId: { productId, channelChatId } },
    });
  }
  async claim(
    actor: string,
    productId: string,
    slug: string,
    channelChatId: string,
  ) {
    const result = await atomic(async (batch) => {
      const row = await this.get(productId, channelChatId);
      if (row && row.status !== "FAILED") return { owned: false, row };
      const attemptId = randomUUID();
      const lastAttemptAt = new Date();
      const id = row?.id ?? randomUUID();
      const next: PostRecord = {
        id,
        productId,
        channelChatId,
        attemptId,
        status: "PENDING",
        messageId: null,
        publishedAt: null,
        lastAttemptAt,
        lastErrorCode: null,
      };
      if (row) batch.update("TelegramProductPost", id, { ...next });
      else batch.insert("TelegramProductPost", { ...next });
      audit(batch, actor, "telegram.product_publish_started", next, slug);
      return { owned: true, row: next };
    });
    return result;
  }
  async finish(
    actor: string,
    row: PostRecord,
    slug: string,
    result:
      { messageId: number } | { code: ChannelErrorCode; uncertain: boolean },
  ) {
    await atomic(async (batch) => {
      const current = await this.get(row.productId, row.channelChatId);
      if (
        !current ||
        current.attemptId !== row.attemptId ||
        current.status !== "PENDING"
      )
        throw new Error("Publication claim is not current");
      if ("messageId" in result) {
        batch.update("TelegramProductPost", row.id, {
          status: "PUBLISHED",
          messageId: result.messageId,
          publishedAt: new Date(),
          lastErrorCode: null,
        });
        audit(batch, actor, "telegram.product_published", row, slug, {
          messageId: result.messageId,
        });
      } else {
        batch.update("TelegramProductPost", row.id, {
          status: result.uncertain ? "PENDING" : "FAILED",
          lastErrorCode: result.code,
        });
        audit(batch, actor, "telegram.product_publish_failed", row, slug, {
          errorCode: result.code,
        });
      }
    });
  }
  async recordFailure(
    actor: string,
    productId: string,
    slug: string,
    channel: string,
    code: ChannelErrorCode,
  ) {
    await atomic(async (batch) => {
      audit(
        batch,
        actor,
        "telegram.product_publish_failed",
        { productId, channelChatId: channel },
        slug,
        { errorCode: code },
      );
    });
  }
}
