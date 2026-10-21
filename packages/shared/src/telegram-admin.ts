export const validTelegramAdminId = (value: string): boolean =>
  /^[1-9][0-9]{0,15}$/.test(value) &&
  BigInt(value) <= BigInt(Number.MAX_SAFE_INTEGER);

export interface TelegramAdminDto {
  id: string;
  telegramId: string;
  label: string | null;
  isActive: boolean;
  notifyNewOrders: boolean;
  notifyPayments: boolean;
  createdAt: string;
  updatedAt: string;
  user: {
    username: string | null;
    firstName: string | null;
    lastName: string | null;
    preferredLocale: "uz" | "ru";
  } | null;
}
