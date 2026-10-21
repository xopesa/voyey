import { atomic, prisma } from "@stenzo/database";
import type {
  AdminNotificationEvent,
  NotificationDeliveryStore,
  NotificationFailureCode,
} from "../modules/notifications/types.js";

export class D1NotificationDeliveryStore implements NotificationDeliveryStore {
  claim(
    eventKey: string,
    telegramId: string,
    eventType: AdminNotificationEvent,
  ) {
    return atomic(async (batch) => {
      // Recheck eligibility in the same snapshot as the claim, including flag changes.
      const admin = await prisma.telegramAdmin.findUnique({
        where: { telegramId },
      });
      if (
        !admin?.isActive ||
        !(eventType === "order.created"
          ? admin.notifyNewOrders
          : admin.notifyPayments)
      )
        return null;
      const row = await prisma.telegramNotificationDelivery.findUnique({
        where: { eventKey_telegramId: { eventKey, telegramId } },
      });
      if (
        row &&
        (row.status !== "FAILED" ||
          !["TELEGRAM_REJECTED", "PROOF_UNAVAILABLE"].includes(
            row.lastErrorCode ?? "",
          ))
      )
        return null;
      const claim = {
        id: row?.id ?? crypto.randomUUID(),
        attemptId: crypto.randomUUID(),
      };
      const data = {
        ...claim,
        eventKey,
        telegramId,
        eventType,
        status: "PENDING",
        telegramMessageId: null,
        sentAt: null,
        lastErrorCode: null,
      };
      if (row) batch.update("TelegramNotificationDelivery", claim.id, data);
      else batch.insert("TelegramNotificationDelivery", data);
      return claim;
    });
  }
  async finish(
    claim: { id: string; attemptId: string },
    result: { messageId: number } | { code: NotificationFailureCode },
  ) {
    await atomic(async (batch) => {
      const row = await prisma.telegramNotificationDelivery.findUnique({
        where: { id: claim.id },
      });
      if (!row || row.attemptId !== claim.attemptId || row.status !== "PENDING")
        throw new Error("Notification claim is not current");
      batch.update(
        "TelegramNotificationDelivery",
        row.id,
        "messageId" in result
          ? {
              status: "SENT",
              telegramMessageId: result.messageId,
              sentAt: new Date(),
              lastErrorCode: null,
            }
          : { status: "FAILED", lastErrorCode: result.code },
      );
    });
  }
}
