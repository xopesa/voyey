import { adminTelegramIds, env } from "../../config/env.js";
import { NotificationService } from "./service.js";
import { TelegramNotificationProvider } from "./telegram-provider.js";

export function createNotificationService(): NotificationService {
  return new NotificationService(
    new TelegramNotificationProvider(env.TELEGRAM_BOT_TOKEN),
    adminTelegramIds,
    undefined,
    { adminOrigin: env.ADMIN_ORIGIN },
  );
}

export { NotificationService } from "./service.js";
export { TelegramNotificationProvider } from "./telegram-provider.js";
export type {
  NotificationLogger,
  NotificationProvider,
  OrderStatusNotification,
  PaymentReviewedNotification,
  PaymentSubmittedNotification,
} from "./types.js";
