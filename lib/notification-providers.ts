import { NotificationChannel } from "@prisma/client";

export type NotificationProviderState = Record<NotificationChannel, boolean>;

export function notificationProviderState(): NotificationProviderState {
  return {
    EMAIL: Boolean(process.env.EMAIL_WEBHOOK_URL),
    TELEGRAM: Boolean(process.env.TELEGRAM_BOT_TOKEN),
    WEB_PUSH: Boolean(process.env.WEB_PUSH_WEBHOOK_URL && process.env.NEXT_PUBLIC_WEB_PUSH_VAPID_KEY),
  };
}

export function notificationDeliveryReady(providers = notificationProviderState()) {
  return Object.values(providers).some(Boolean);
}
