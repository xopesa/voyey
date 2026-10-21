import { atomic, database, prisma } from "@stenzo/database";
import type {
  CustomerNotificationEvent,
  RefundNotificationEvent,
  NotificationDeliveryStore,
} from "../modules/notifications/types.js";

interface Delivery {
  id: string;
  attemptId: string;
  status: "PENDING" | "SENT" | "FAILED";
  lastErrorCode: string | null;
}

// D1-only receipt table; intentionally independent of the admin event CHECK/roles.
export class D1CustomerNotificationDeliveryStore<
  Event extends CustomerNotificationEvent | RefundNotificationEvent =
    CustomerNotificationEvent,
> implements NotificationDeliveryStore<Event> {
  constructor(
    private readonly table:
      | "CustomerTelegramNotificationDelivery"
      | "CustomerRefundNotificationDelivery" = "CustomerTelegramNotificationDelivery",
  ) {
    if (
      ![
        "CustomerTelegramNotificationDelivery",
        "CustomerRefundNotificationDelivery",
      ].includes(table)
    )
      throw Error("Invalid delivery table");
  }
  private sql(value: string) {
    return value.replaceAll("CustomerTelegramNotificationDelivery", this.table);
  }
  claim(eventKey: string, telegramId: string, eventType: Event) {
    return atomic(async (batch) => {
      const user = await prisma.user.findUnique({
        where: { telegramId: BigInt(telegramId) },
      });
      if (user?.status !== "ACTIVE") return null;
      const row = await database()
        .prepare(
          this.sql(
            'SELECT id,attemptId,status,lastErrorCode FROM "CustomerTelegramNotificationDelivery" WHERE eventKey=? AND telegramId=?',
          ),
        )
        .bind(eventKey, telegramId)
        .first<Delivery>();
      if (
        row &&
        (row.status !== "FAILED" || row.lastErrorCode !== "TELEGRAM_REJECTED")
      )
        return null;
      const claim = {
        id: row?.id ?? crypto.randomUUID(),
        attemptId: crypto.randomUUID(),
      };
      const now = Date.now();
      if (row)
        batch.sql(
          this.sql(
            "UPDATE \"CustomerTelegramNotificationDelivery\" SET attemptId=?,status='PENDING',telegramMessageId=NULL,sentAt=NULL,lastErrorCode=NULL,updatedAt=? WHERE id=?",
          ),
          claim.attemptId,
          now,
          claim.id,
        );
      else
        batch.sql(
          this.sql(
            'INSERT INTO "CustomerTelegramNotificationDelivery" (id,eventKey,telegramId,eventType,attemptId,createdAt,updatedAt) VALUES (?,?,?,?,?,?,?)',
          ),
          claim.id,
          eventKey,
          telegramId,
          eventType,
          claim.attemptId,
          now,
          now,
        );
      return claim;
    });
  }

  async finish(
    claim: { id: string; attemptId: string },
    result:
      | { messageId: number }
      | { code: "TELEGRAM_REJECTED" | "DELIVERY_UNCONFIRMED" },
  ) {
    await atomic(async (batch) => {
      const row = await database()
        .prepare(
          this.sql(
            'SELECT id,attemptId,status,lastErrorCode FROM "CustomerTelegramNotificationDelivery" WHERE id=?',
          ),
        )
        .bind(claim.id)
        .first<Delivery>();
      if (!row || row.attemptId !== claim.attemptId || row.status !== "PENDING")
        throw new Error("Notification claim is not current");
      const sent = "messageId" in result,
        now = Date.now();
      batch.sql(
        this.sql(
          'UPDATE "CustomerTelegramNotificationDelivery" SET status=?,telegramMessageId=?,sentAt=?,lastErrorCode=?,updatedAt=? WHERE id=?',
        ),
        sent ? "SENT" : "FAILED",
        sent ? result.messageId : null,
        sent ? now : null,
        sent ? null : result.code,
        now,
        claim.id,
      );
    });
  }
}
