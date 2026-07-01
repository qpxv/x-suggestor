import webPush from "web-push";
import { prisma } from "./prisma";

let vapidInitialized = false;

function ensureVapid() {
  if (vapidInitialized) return;
  webPush.setVapidDetails(
    "mailto:benwinzer.biz@gmail.com",
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!,
    process.env.VAPID_PRIVATE_KEY!
  );
  vapidInitialized = true;
}

export async function sendPushNotification(payload: string) {
  ensureVapid();
  const subscriptions = await prisma.pushSubscription.findMany();
  await Promise.all(
    subscriptions.map((sub) =>
      webPush
        .sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          payload
        )
        .catch(() => {})
    )
  );
}
