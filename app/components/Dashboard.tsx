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

  return (
    <div style={styles.shell}>
      {/* Sidebar */}
      <aside style={styles.sidebar}>
        <div style={styles.sidebarHeader}>
          <span style={styles.logo}>X DM</span>
          {pendingCount > 0 && (
            <span style={styles.badge}>{pendingCount}</span>
          )}
        </div>
        <div style={styles.chatList}>
          {chats.length === 0 && (
            <p style={styles.empty}>no conversations yet</p>
          )}
          {chats.map((chat) => (
            <button
              key={chat.id}
              style={{
                ...styles.chatItem,
                ...(selectedId === chat.id ? styles.chatItemActive : {}),
              }}
              onClick={() => selectChat(chat.id)}
            >
              <div style={styles.chatItemTop}>
                <span style={styles.username}>@{chat.leadUsername}</span>
                <span style={styles.time}>{formatTime(chat.updatedAt)}</span>
              </div>
              <div style={styles.preview}>
                {chat.pendingNotifyAt && <span style={styles.unreadDot} />}
                <span style={styles.previewText}>
                  {chat.lastMessageText?.slice(0, 60) ?? ""}
                </span>
              </div>
            </button>
          ))}
        </div>
      </aside>

      {/* Main panel */}
      <main style={styles.main}>
        {!selectedChat ? (
          <div style={styles.emptyState}>
            <span style={styles.emptyIcon}>_</span>
            <p>select a conversation</p>
          </div>
        ) : (
          <>
            {/* Chat header */}
            <div style={styles.chatHeader}>
              <span style={styles.chatHeaderName}>@{selectedChat.leadUsername}</span>
            </div>

            {/* Message feed */}
            <div ref={feedRef} style={styles.feed}>
              {messages.map((message) => {
                const isMe = message.senderId === "me";
                return (
                  <div
                    key={message.id}
                    style={{ ...styles.msgRow, justifyContent: isMe ? "flex-end" : "flex-start" }}
                  >
                    {!isMe && (
                      <span style={styles.msgSender}>@{selectedChat.leadUsername}</span>
                    )}
                    <div style={{ ...styles.bubble, ...(isMe ? styles.bubbleMe : styles.bubbleThem) }}>
                      {message.text}
                    </div>
                    <span style={styles.msgTime}>{formatTime(message.createdAt)}</span>
                  </div>
                );
              })}
            </div>

            {/* Suggestions */}
            {suggestions.length > 0 && (
              <div style={styles.suggestions}>
                <span style={styles.suggestLabel}>suggestions — click to approve</span>
                {suggestions.map((suggestion, i) => {
                  const flagged = hasLink(suggestion);
                  const isApproved = approved.has(i);
                  return (
                    <button
                      key={i}
                      onClick={() => toggleApprove(i)}
                      style={{
                        ...styles.suggestionChip,
                        ...(isApproved ? styles.suggestionApproved : {}),
                        ...(flagged ? styles.suggestionFlagged : {}),
                      }}
                    >
                      {flagged && <span style={styles.linkWarn}>⚠ link · </span>}
                      {suggestion}
                    </button>
                  );
                })}
              </div>
            )}

            {/* Compose */}
            <div style={styles.compose}>
              {status && (
                <div style={{
                  ...styles.statusBar,
                  color: status.startsWith("⚠") ? "var(--danger)" : status === "sent" ? "var(--accent)" : "var(--danger)"
                }}>
                  {status}
                </div>
              )}
              <div style={styles.composeRow}>
                <textarea
                  style={styles.textarea}
                  placeholder="type a reply..."
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) handleSend();
                  }}
                  rows={2}
                />
              </div>
              <div style={styles.composeActions}>
                <button
                  style={styles.btnSecondary}
                  onClick={handleGenerate}
                  disabled={isPending}
                >
                  {isPending ? "generating..." : "generate suggestions"}
                </button>
                <button
                  style={{
                    ...styles.btnPrimary,
                    opacity: (approved.size === 0 && !draft.trim()) || isSending ? 0.4 : 1,
                  }}
                  onClick={handleSend}
                  disabled={(approved.size === 0 && !draft.trim()) || isSending}
                >
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

// ─── Styles ────────────────────────────────────────────────────────────────

const styles: Record<string, React.CSSProperties> = {
  shell: {
    display: "flex",
    height: "100vh",
    overflow: "hidden",
    background: "var(--bg)",
  },
  sidebar: {
    width: 280,
    minWidth: 220,
    borderRight: "1px solid var(--border)",
    display: "flex",
    flexDirection: "column",
    background: "var(--surface)",
  },
  sidebarHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "14px 16px",
    borderBottom: "1px solid var(--border)",
  },
  logo: {
    fontSize: 14,
    fontWeight: 700,
    letterSpacing: "0.08em",
    color: "var(--accent)",
    textTransform: "uppercase",
  },
  badge: {
    background: "var(--accent)",
    color: "#000",
    fontSize: 10,
    fontWeight: 700,
    borderRadius: 9999,
    padding: "1px 6px",
    lineHeight: "16px",
  },
  chatList: {
    flex: 1,
    overflowY: "auto",
  },
  chatItem: {
    width: "100%",
    background: "none",
    border: "none",
    borderBottom: "1px solid var(--border)",
    padding: "10px 16px",
    cursor: "pointer",
    textAlign: "left",
    transition: "background 0.1s",
    color: "var(--text)",
    fontFamily: "inherit",
    fontSize: 12,
  },
  chatItemActive: {
    background: "var(--surface-2)",
    borderLeft: "2px solid var(--accent)",
    paddingLeft: 14,
  },
  chatItemTop: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "baseline",
    marginBottom: 4,
  },
  username: {
    fontWeight: 600,
    color: "var(--text)",
    fontSize: 12,
  },
  time: {
    fontSize: 10,
    color: "var(--muted)",
  },
  preview: {
    display: "flex",
    alignItems: "center",
    gap: 6,
  },
  unreadDot: {
    display: "inline-block",
    width: 5,
    height: 5,
    borderRadius: "50%",
    background: "var(--accent)",
    flexShrink: 0,
  },
  previewText: {
    color: "var(--muted)",
    fontSize: 11,
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
    maxWidth: 210,
  },
  empty: {
    padding: "24px 16px",
    color: "var(--muted)",
    fontSize: 11,
  },
  main: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
    background: "var(--bg)",
  },
  emptyState: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    color: "var(--muted)",
    fontSize: 12,
    gap: 8,
  },
  emptyIcon: {
    fontSize: 32,
    color: "var(--border-2)",
    fontWeight: 700,
  },
  chatHeader: {
    padding: "12px 20px",
    borderBottom: "1px solid var(--border)",
    background: "var(--surface)",
  },
  chatHeaderName: {
    fontWeight: 700,
    fontSize: 13,
    color: "var(--accent)",
  },
  feed: {
    flex: 1,
    overflowY: "auto",
    padding: "16px 20px",
    display: "flex",
    flexDirection: "column",
    gap: 12,
  },
  msgRow: {
    display: "flex",
    alignItems: "flex-end",
    gap: 8,
    flexWrap: "wrap",
  },
  msgSender: {
    fontSize: 10,
    color: "var(--muted)",
    whiteSpace: "nowrap",
  },
  bubble: {
    maxWidth: "70%",
    padding: "8px 12px",
    fontSize: 12,
    lineHeight: 1.5,
    borderRadius: 4,
    wordBreak: "break-word",
  },
  bubbleThem: {
    background: "var(--surface)",
    border: "1px solid var(--border)",
    color: "var(--text)",
  },
  bubbleMe: {
    background: "var(--accent-dim)",
    border: "1px solid var(--accent)",
    color: "var(--text)",
  },
  msgTime: {
    fontSize: 10,
    color: "var(--muted)",
    whiteSpace: "nowrap",
  },
  suggestions: {
    padding: "10px 20px",
    borderTop: "1px solid var(--border)",
    display: "flex",
    flexWrap: "wrap",
    gap: 8,
    alignItems: "flex-start",
    background: "var(--surface)",
  },
  suggestLabel: {
    width: "100%",
    fontSize: 10,
    color: "var(--muted)",
    letterSpacing: "0.05em",
    textTransform: "uppercase",
    marginBottom: 2,
  },
  suggestionChip: {
    background: "var(--surface-2)",
    border: "1px solid var(--border-2)",
    color: "var(--text)",
    fontSize: 12,
    padding: "6px 12px",
    borderRadius: 3,
    cursor: "pointer",
    fontFamily: "inherit",
    textAlign: "left",
    transition: "border-color 0.1s, background 0.1s",
    maxWidth: 380,
  },
  suggestionApproved: {
    borderColor: "var(--accent)",
    background: "rgba(232,160,48,0.08)",
    color: "var(--accent)",
  },
  suggestionFlagged: {
    borderColor: "var(--danger)",
  },
  linkWarn: {
    color: "var(--danger)",
    fontWeight: 600,
  },
  compose: {
    borderTop: "1px solid var(--border)",
    padding: "12px 20px",
    background: "var(--surface)",
    display: "flex",
    flexDirection: "column",
    gap: 8,
  },
  composeRow: {
    display: "flex",
    gap: 8,
  },
  textarea: {
    flex: 1,
    background: "var(--bg)",
    border: "1px solid var(--border-2)",
    color: "var(--text)",
    fontFamily: "inherit",
    fontSize: 12,
    padding: "8px 12px",
    borderRadius: 3,
    resize: "none",
    outline: "none",
    lineHeight: 1.5,
  },
  composeActions: {
    display: "flex",
    justifyContent: "space-between",
    gap: 8,
  },
  btnSecondary: {
    background: "none",
    border: "1px solid var(--border-2)",
    color: "var(--muted)",
    fontFamily: "inherit",
    fontSize: 11,
    padding: "6px 14px",
    borderRadius: 3,
    cursor: "pointer",
    letterSpacing: "0.03em",
    transition: "border-color 0.1s, color 0.1s",
  },
  btnPrimary: {
    background: "var(--accent)",
    border: "1px solid var(--accent)",
    color: "#000",
    fontFamily: "inherit",
    fontSize: 11,
    fontWeight: 700,
    padding: "6px 18px",
    borderRadius: 3,
    cursor: "pointer",
    letterSpacing: "0.05em",
    textTransform: "uppercase",
    transition: "opacity 0.1s",
  },
  statusBar: {
    fontSize: 11,
    fontWeight: 500,
    padding: "4px 0",
  },
};

function urlBase64ToUint8Array(base64String: string) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  return new Uint8Array([...rawData].map((char) => char.charCodeAt(0)));
}
