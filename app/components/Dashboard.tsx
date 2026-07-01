"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import type { Chat, Message } from "@prisma/client";
import { generateSuggestions, sendMessages, getMessages, getChatById } from "@/lib/actions";

const ONE_MINUTE = 60_000;
const ONE_HOUR   = 3_600_000;
const ONE_DAY    = 86_400_000;

function formatTime(date: Date | string) {
  const parsed = new Date(date);
  const now = new Date();
  const msElapsed = now.getTime() - parsed.getTime();
  if (msElapsed < ONE_MINUTE) return "now";
  if (msElapsed < ONE_HOUR)   return `${Math.floor(msElapsed / ONE_MINUTE)}m`;
  if (msElapsed < ONE_DAY)    return `${Math.floor(msElapsed / ONE_HOUR)}h`;
  return parsed.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function hasLink(text: string) {
  return /https?:\/\//.test(text);
}

export default function Dashboard({ initialChats }: { initialChats: Chat[] }) {
  const [chats, setChats] = useState<Chat[]>(initialChats);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [selectedChat, setSelectedChat] = useState<Chat | null>(null);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [approved, setApproved] = useState<Set<number>>(new Set());
  const [draft, setDraft] = useState("");
  const [isPending, startTransition] = useTransition();
  const [isSending, setIsSending] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const feedRef = useRef<HTMLDivElement>(null);
  const linkWarningRef = useRef<Set<number>>(new Set());

  // SSE for live updates
  useEffect(() => {
    const eventSource = new EventSource("/api/events");
    eventSource.onmessage = (event) => {
      const sseData = JSON.parse(event.data);
      if (sseData.type === "init") {
        setChats(sseData.chats);
      } else if (sseData.type === "update") {
        setChats((prev) => {
          const chatMap = new Map(prev.map((chat) => [chat.id, chat]));
          for (const chat of sseData.chats) chatMap.set(chat.id, chat);
          return Array.from(chatMap.values()).sort(
            (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
          );
        });
        if (selectedId) {
          const updatedChat = sseData.chats.find((chat: Chat) => chat.id === selectedId);
          if (updatedChat) loadMessages(selectedId);
        }
      }
    };
    return () => eventSource.close();
  }, [selectedId]);

  // Register service worker + push
  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").then(async (registration) => {
        const permission = await Notification.requestPermission();
        if (permission !== "granted") return;
        const existing = await registration.pushManager.getSubscription();
        const subscription =
          existing ??
          (await registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlBase64ToUint8Array(
              process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!
            ),
          }));
        await fetch("/api/push/subscribe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(subscription.toJSON()),
        });
      });
    }
  }, []);

  async function loadMessages(chatId: string) {
    const [msgs, chat] = await Promise.all([getMessages(chatId), getChatById(chatId)]);
    setMessages(msgs);
    setSelectedChat(chat);
    setSuggestions([]);
    setApproved(new Set());
    setDraft("");
    setTimeout(() => {
      feedRef.current?.scrollTo({ top: feedRef.current.scrollHeight, behavior: "smooth" });
    }, 50);
  }

  function selectChat(chatId: string) {
    setSelectedId(chatId);
    loadMessages(chatId);
  }

  function handleGenerate() {
    if (!selectedId) return;
    startTransition(async () => {
      const newSuggestions = await generateSuggestions(selectedId);
      setSuggestions(newSuggestions);
      setApproved(new Set());
    });
  }

  function toggleApprove(idx: number) {
    setApproved((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  }

  async function handleSend() {
    if (!selectedId) return;
    const toSend: string[] = [];
    approved.forEach((i) => {
      if (suggestions[i]) toSend.push(suggestions[i]);
    });
    if (draft.trim()) toSend.push(draft.trim());
    if (toSend.length === 0) return;

    const flagged = toSend.filter(hasLink);
    if (flagged.length > 0 && !linkWarningRef.current.has(toSend.join("|").length)) {
      linkWarningRef.current.add(toSend.join("|").length);
      setStatus("⚠ message contains a link (~$0.20 vs $0.015). click send again to confirm.");
      return;
    }

    setIsSending(true);
    setStatus(null);
    try {
      await sendMessages(selectedId, toSend);
      setSuggestions([]);
      setApproved(new Set());
      setDraft("");
      linkWarningRef.current.clear();
      await loadMessages(selectedId);
      setStatus("sent");
      setTimeout(() => setStatus(null), 2000);
    } catch (err) {
      setStatus(`error: ${err instanceof Error ? err.message : "unknown"}`);
    } finally {
      setIsSending(false);
    }
  }

  const approvedTexts = Array.from(approved).map((i) => suggestions[i]);
  const pendingCount = chats.filter((chat) => chat.pendingNotifyAt).length;

  const statusClass = status?.startsWith("⚠") ? "warning" : status === "sent" ? "success" : "error";

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="sidebar-header">
          <span className="logo">X DM</span>
          {pendingCount > 0 && <span className="badge">{pendingCount}</span>}
        </div>
        <div className="chat-list">
          {chats.length === 0 && <p className="empty-list">no conversations yet</p>}
          {chats.map((chat) => (
            <button
              key={chat.id}
              className={`chat-item${selectedId === chat.id ? " active" : ""}`}
              onClick={() => selectChat(chat.id)}
            >
              <div className="chat-item-top">
                <span className="chat-username">@{chat.leadUsername}</span>
                <span className="chat-time">{formatTime(chat.updatedAt)}</span>
              </div>
              <div className="chat-preview">
                {chat.pendingNotifyAt && <span className="unread-dot" />}
                <span className="preview-text">{chat.lastMessageText?.slice(0, 60) ?? ""}</span>
              </div>
            </button>
          ))}
        </div>
      </aside>

      <main className="main">
        {!selectedChat ? (
          <div className="empty-state">
            <span className="empty-state-icon">_</span>
            <p>select a conversation</p>
          </div>
        ) : (
          <>
            <div className="chat-header">
              <span className="chat-header-name">@{selectedChat.leadUsername}</span>
            </div>

            <div ref={feedRef} className="feed">
              {messages.map((message) => {
                const isMe = message.senderId === "me";
                return (
                  <div key={message.id} className={`msg-row ${isMe ? "me" : "them"}`}>
                    {!isMe && <span className="msg-sender">@{selectedChat.leadUsername}</span>}
                    <div className={`bubble ${isMe ? "me" : "them"}`}>{message.text}</div>
                    <span className="msg-time">{formatTime(message.createdAt)}</span>
                  </div>
                );
              })}
            </div>

            {suggestions.length > 0 && (
              <div className="suggestions">
                <span className="suggestions-label">suggestions — click to approve</span>
                {suggestions.map((suggestion, i) => (
                  <button
                    key={i}
                    onClick={() => toggleApprove(i)}
                    className={[
                      "suggestion-chip",
                      approved.has(i) ? "approved" : "",
                      hasLink(suggestion) ? "flagged" : "",
                    ].join(" ").trim()}
                  >
                    {hasLink(suggestion) && <span className="link-warn">⚠ link · </span>}
                    {suggestion}
                  </button>
                ))}
              </div>
            )}

            <div className="compose">
              {status && <div className={`status-bar ${statusClass}`}>{status}</div>}
              <div className="compose-row">
                <textarea
                  className="compose-textarea"
                  placeholder="type a reply..."
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) handleSend();
                  }}
                  rows={2}
                />
              </div>
              <div className="compose-actions">
                <button className="btn-secondary" onClick={handleGenerate} disabled={isPending}>
                  {isPending ? "generating..." : "generate suggestions"}
                </button>
                <button className="btn-primary" onClick={handleSend} disabled={(approved.size === 0 && !draft.trim()) || isSending}>
                  {isSending ? "sending..." : `send${approvedTexts.length > 0 ? ` (${approvedTexts.length + (draft.trim() ? 1 : 0)})` : ""}`}
                </button>
              </div>
            </div>
          </>
        )}
      </main>
    </div>
  );
}

function urlBase64ToUint8Array(base64String: string) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  return new Uint8Array([...rawData].map((char) => char.charCodeAt(0)));
}
