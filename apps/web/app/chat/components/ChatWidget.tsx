"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { MessageCircle, X } from "lucide-react";

import { cn } from "@/lib/utils";
import { ChatPanel } from "./ChatPanel";

/**
 * Conversation lifecycle hooks. Client-only for now — no persistence — but
 * these are the single seam to wire analytics or a backend to later.
 */
function trackConversation(event: "start" | "end") {
  console.info(`[chat] conversation ${event}`);
}

/**
 * Floating support widget pinned to the bottom-right corner. A blue launcher
 * button toggles the chat card, which floats above it.
 *
 * The conversation lifecycle lives here: it "starts" on the first message and
 * "ends" when the user closes the widget via either X (the panel header or the
 * launcher) after a real exchange. On close the conversation is reset so the
 * next open starts fresh.
 */
export function ChatWidget() {
  const [open, setOpen] = useState(false);
  // Defers the post-close reset until the collapse animation finishes.
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Identity/timing for the current conversation, persisted to MongoDB on end.
  const conversationIdRef = useRef<string | null>(null);
  const startedAtRef = useRef<number | null>(null);

  const { messages, sendMessage, status, stop, setMessages } = useChat({
    transport: new DefaultChatTransport({ api: "/api/chat" }),
  });

  const hasConversation = messages.length > 0;

  // Always reflects the latest messages so persistence (including the unload
  // listener, which binds once) reads a fresh snapshot without re-binding.
  const messagesRef = useRef(messages);
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  // Save the full transcript to MongoDB via the conversations route. Reads only
  // refs, so it's stable and safe to call from an event listener. `keepalive`
  // lets the POST outlive a widget unmount or page unload; the route upserts by
  // conversationId, so a double-fire (close + pagehide) won't duplicate.
  const persistConversation = useCallback(() => {
    const conversationId = conversationIdRef.current;
    const snapshot = messagesRef.current;
    if (!conversationId || snapshot.length === 0) return;
    const body = JSON.stringify({
      conversationId,
      startedAt: new Date(startedAtRef.current ?? Date.now()).toISOString(),
      endedAt: new Date().toISOString(),
      messages: snapshot,
    });
    void fetch("/api/conversations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
      keepalive: true,
    }).catch((err) => console.error("[chat] persist failed", err));
  }, []);

  // Catch the case where the user closes the tab / navigates away mid-chat
  // without closing the widget first — requestClose never runs then.
  useEffect(() => {
    const onPageHide = () => persistConversation();
    window.addEventListener("pagehide", onPageHide);
    return () => window.removeEventListener("pagehide", onPageHide);
  }, [persistConversation]);

  function clearResetTimer() {
    if (resetTimer.current) {
      clearTimeout(resetTimer.current);
      resetTimer.current = null;
    }
  }

  function openChat() {
    clearResetTimer();
    setOpen(true);
  }

  // Collapse the widget, then reset for a fresh next conversation once the
  // 200ms collapse animation has played (avoids a visible content swap).
  function finishClose() {
    clearResetTimer();
    setOpen(false);
    resetTimer.current = setTimeout(() => {
      setMessages([]);
      conversationIdRef.current = null;
      startedAtRef.current = null;
      resetTimer.current = null;
    }, 200);
  }

  function handleSend(text: string) {
    if (messages.length === 0) {
      conversationIdRef.current = crypto.randomUUID();
      startedAtRef.current = Date.now();
      trackConversation("start");
    }
    sendMessage({ text });
  }

  // Both close affordances (panel header X and launcher X) funnel here.
  function requestClose() {
    if (status === "streaming" || status === "submitted") stop();
    if (hasConversation) {
      trackConversation("end");
      // Capture synchronously — finishClose schedules a setMessages([]) reset.
      persistConversation();
    }
    finishClose();
  }

  return (
    <div className="fixed right-4 bottom-4 z-50 sm:right-6 sm:bottom-6">
      <div
        className={cn(
          "absolute right-0 bottom-full mb-3 origin-bottom-right transition-all duration-200 ease-out",
          open
            ? "pointer-events-auto translate-y-0 scale-100 opacity-100"
            : "pointer-events-none translate-y-2 scale-95 opacity-0",
        )}
        aria-hidden={!open}
      >
        <ChatPanel
          messages={messages}
          status={status}
          stop={stop}
          onSend={handleSend}
          onClose={requestClose}
        />
      </div>

      <button
        type="button"
        onClick={() => (open ? requestClose() : openChat())}
        aria-label={open ? "Close chat" : "Open chat"}
        aria-expanded={open}
        className="grid size-14 place-items-center rounded-full bg-chat-accent text-chat-accent-foreground shadow-sm outline-none transition-all hover:bg-chat-accent/90 focus-visible:ring-3 focus-visible:ring-chat-accent/40 active:scale-95"
      >
        <MessageCircle
          className={cn("size-6 transition-all", open && "scale-0 opacity-0")}
        />
        <X
          className={cn(
            "absolute size-6 transition-all",
            open ? "scale-100 opacity-100" : "scale-0 opacity-0",
          )}
        />
      </button>
    </div>
  );
}
