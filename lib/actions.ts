"use server";

import Anthropic from "@anthropic-ai/sdk";
import { Chat, Message } from "@prisma/client";
import { prisma } from "./prisma";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export async function generateSuggestions(chatId: string): Promise<string[]> {
  // Fetch the most recent 20 messages in chronological order
  const recentMessages = await prisma.message.findMany({
    where: { chatId },
    orderBy: { createdAt: "desc" },
    take: 20,
  });
  const messages = recentMessages.reverse();

  const chat = await prisma.chat.findUnique({ where: { id: chatId } });
  if (!chat) throw new Error("Chat not found");

  const myPastMessages = messages.filter((message) => message.senderId === "me");
  const styleSection =
    myPastMessages.length >= 2
      ? `My writing style — match the tone, length, and vibe exactly:\n${myPastMessages.map((message) => `- "${message.text}"`).join("\n")}`
      : `Examples of my style:\n- "hey yeah that makes sense, lmk when you're free to chat"\n- "totally get it, no rush. we can circle back whenever works for you"\n- "sounds good! what time works best?"`;

  const conversation = messages
    .map((message) => `${message.senderId === "me" ? "me" : chat.leadUsername}: ${message.text}`)
    .join("\n");

  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-5",
    max_tokens: 512,
    system: `You are helping draft DM replies in a casual, lowercase, conversational sales style.
Keep messages short — 1-3 sentences max. no caps, minimal punctuation, very natural.
${styleSection}`,
    messages: [
      {
        role: "user",
        content: `Here is the DM conversation so far:\n\n${conversation}\n\nSuggest 2-4 short replies I could send.`,
      },
    ],
    tools: [
      {
        name: "provide_suggestions",
        description: "Return 2-4 short DM reply suggestions matching the user's style",
        input_schema: {
          type: "object" as const,
          properties: {
            suggestions: { type: "array", items: { type: "string" } },
          },
          required: ["suggestions"],
        },
      },
    ],
    tool_choice: { type: "tool", name: "provide_suggestions" },
  });

  const toolUseBlock = response.content.find((block) => block.type === "tool_use");
  if (!toolUseBlock || toolUseBlock.type !== "tool_use") return [];
  const input = toolUseBlock.input as { suggestions: string[] };
  return input.suggestions ?? [];
}

export async function sendMessages(chatId: string, texts: string[]): Promise<void> {
  const chat = await prisma.chat.findUnique({ where: { id: chatId } });
  if (!chat) throw new Error("Chat not found");

  const accessToken = process.env.X_ACCESS_TOKEN;
  if (!accessToken) throw new Error("X_ACCESS_TOKEN not set");

  for (const text of texts) {
    const res = await fetch(
      `https://api.twitter.com/2/dm_conversations/${chat.xConversationId}/messages`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ text }),
      }
    );

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`X API error: ${err}`);
    }

    await prisma.message.create({
      data: { chatId, senderId: "me", text },
    });

    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

export async function getChats(): Promise<Chat[]> {
  return prisma.chat.findMany({ orderBy: { updatedAt: "desc" } });
}

export async function getMessages(chatId: string): Promise<Message[]> {
  return prisma.message.findMany({
    where: { chatId },
    orderBy: { createdAt: "asc" },
  });
}

export async function getChatById(chatId: string): Promise<Chat | null> {
  return prisma.chat.findUnique({ where: { id: chatId } });
}
