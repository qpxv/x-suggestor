import { after } from "next/server";
import { createHmac } from "crypto";
import { prisma } from "@/lib/prisma";
import { sendPushNotification } from "@/lib/push";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const crcToken = url.searchParams.get("crc_token");
  if (!crcToken) return new Response("missing crc_token", { status: 400 });

  const secret = process.env.X_CONSUMER_SECRET!;
  const hash = createHmac("sha256", secret).update(crcToken).digest("base64");
  return Response.json({ response_token: `sha256=${hash}` });
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  if (!body) return new Response("bad json", { status: 400 });

  const events: Array<{
    id: string;
    text: string;
    dm_conversation_id: string;
    sender_id: string;
    sender_username?: string;
  }> = body?.direct_message_events ?? [];

  for (const event of events) {
    const conversationId = event.dm_conversation_id;
    const username = event.sender_username ?? event.sender_id;

    const chat = await prisma.chat.upsert({
      where: { xConversationId: conversationId },
      update: {
        lastMessageText: event.text,
        pendingNotifyAt: undefined,
      },
      create: {
        xConversationId: conversationId,
        leadUsername: username,
        lastMessageText: event.text,
        pendingNotifyAt: new Date(),
      },
    });

    // Set pendingNotifyAt only if not already set
    if (!chat.pendingNotifyAt) {
      await prisma.chat.update({
        where: { id: chat.id },
        data: { pendingNotifyAt: new Date() },
      });
    }

    await prisma.message.create({
      data: {
        chatId: chat.id,
        senderId: event.sender_id,
        text: event.text,
      },
    });

    const chatId = chat.id;
    const eventTimestamp = new Date();

    after(async () => {
      await new Promise((r) => setTimeout(r, 5000));

      const fresh = await prisma.chat.findUnique({ where: { id: chatId } });
      if (!fresh?.pendingNotifyAt) return;
      if (fresh.updatedAt > eventTimestamp) return;

      await sendPushNotification("New DM");
      await prisma.chat.update({
        where: { id: chatId },
        data: { pendingNotifyAt: null },
      });
    });
  }

  return new Response("ok", { status: 200 });
}
