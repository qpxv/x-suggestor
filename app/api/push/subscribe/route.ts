import { prisma } from "@/lib/prisma";

export async function POST(request: Request) {
  const sub = await request.json();
  const { endpoint, keys } = sub as {
    endpoint: string;
    keys: { p256dh: string; auth: string };
  };

  await prisma.pushSubscription.upsert({
    where: { endpoint },
    update: { p256dh: keys.p256dh, auth: keys.auth },
    create: { endpoint, p256dh: keys.p256dh, auth: keys.auth },
  }); // review: i dont need to understand this right?

  return Response.json({ ok: true });
}
