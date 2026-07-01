export const dynamic = "force-dynamic";

import { prisma } from "@/lib/prisma";

export async function GET() {
  let lastChecked = new Date();

  const stream = new ReadableStream({ // review: why readable stream? what even is that? also whats the force dynamic doing there what is that?
    async start(controller) {
      const encoder = new TextEncoder();
      let closed = false;

      const send = (data: string) => {
        if (closed) return;
        controller.enqueue(encoder.encode(`data: ${data}\n\n`)); // review: dont understand this
      };

      const close = () => {
        if (closed) return;
        closed = true;
        clearInterval(interval);
        try { controller.close(); } catch {}
      };

      // Send initial full chat list
      const initial = await prisma.chat.findMany({ orderBy: { updatedAt: "desc" } });
      send(JSON.stringify({ type: "init", chats: initial })); // review: why do we stringify that?

      const interval = setInterval(async () => {
        if (closed) return;
        try {
          const updated = await prisma.chat.findMany({
            where: { updatedAt: { gt: lastChecked } },
            orderBy: { updatedAt: "desc" },
          });
          lastChecked = new Date();
          if (updated.length > 0) {
            send(JSON.stringify({ type: "update", chats: updated })); // review: i dont understand why we need to json stringify that? becuase its an api route or why?
          }
          if (!closed) controller.enqueue(encoder.encode(": heartbeat\n\n"));
        } catch {
          close();
        }
      }, 2500);
    },
    cancel() {
      // client disconnected — interval will self-clean via closed flag
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
