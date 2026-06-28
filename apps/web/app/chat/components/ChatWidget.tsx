"use client";

import { useRef, useState } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { MessageCircle, X } from "lucide-react";

import { cn } from "@/lib/utils";
import { ChatPanel } from "./ChatPanel";
import { FeedbackCard, type ConversationRating } from "./FeedbackCard";

/**
 * Conversation lifecycle hooks. Client-only for now — no persistence — but
 * these are the single seam to wire analytics or a backend to later.
 */
function trackConversation(event: "start" | "end") {
  console.info(`[chat] conversation ${event}`);
}
function trackFeedback(rating: ConversationRating) {
  console.info(`[chat] conversation rated: ${rating}`);
}

/**
 * Floating support widget pinned to the bottom-right corner. A blue launcher
 * button toggles the chat card, which floats above it.
 *
 * The conversation lifecycle lives here: it "starts" on the first message and
 * "ends" when the user closes the widget via either X (the panel header or the
 * launcher). On end, if there was a real exchange, the card swaps to a quick
 * feedback prompt before collapsing; afterwards the conversation is reset so the
 * next open starts fresh.
 */
export function ChatWidget() {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<"chat" | "feedback">("chat");
  // Defers the post-close reset until the collapse animation finishes.
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { messages, sendMessage, status, stop, setMessages } = useChat({
    transport: new DefaultChatTransport({ api: "/api/chat" }),
  });

  const hasConversation = messages.length > 0;

  function clearResetTimer() {
    if (resetTimer.current) {
      clearTimeout(resetTimer.current);
      resetTimer.current = null;
    }
  }

  function openChat() {
    clearResetTimer();
    setView("chat");
    setOpen(true);
  }

  // Collapse the widget, then reset for a fresh next conversation once the
  // 200ms collapse animation has played (avoids a visible content swap).
  function finishClose() {
    clearResetTimer();
    setOpen(false);
    resetTimer.current = setTimeout(() => {
      setView("chat");
      setMessages([]);
      resetTimer.current = null;
    }, 200);
  }

  function handleSend(text: string) {
    if (messages.length === 0) trackConversation("start");
    sendMessage({ text });
  }

  function handleRate(rating: ConversationRating) {
    trackFeedback(rating);
    // Let the card show its "thanks" state briefly, then collapse.
    clearResetTimer();
    resetTimer.current = setTimeout(finishClose, 1100);
  }

  // Both close affordances (panel header X and launcher X) funnel here.
  function requestClose() {
    if (status === "streaming" || status === "submitted") stop();
    if (view === "chat" && hasConversation) {
      trackConversation("end");
      setView("feedback");
      return;
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
        {view === "feedback" ? (
          <FeedbackCard onRate={handleRate} onDismiss={finishClose} />
        ) : (
          <ChatPanel
            messages={messages}
            status={status}
            stop={stop}
            onSend={handleSend}
            onClose={requestClose}
          />
        )}
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
