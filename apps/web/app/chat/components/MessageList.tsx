"use client";

import { useEffect, useRef } from "react";
import { Brain, Sparkles } from "lucide-react";
import type { UIMessage } from "ai";

import { hasRenderableContent, MessageBubble } from "./MessageBubble";

interface MessageListProps {
  messages: UIMessage[];
  status: string;
}

export function MessageList({ messages, status }: MessageListProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  // Whether the user is parked near the bottom (so we keep auto-scrolling).
  const stickRef = useRef(true);

  function handleScroll() {
    const el = containerRef.current;
    if (!el) return;
    stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  }

  useEffect(() => {
    if (stickRef.current) {
      endRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, status]);

  const last = messages[messages.length - 1];
  const streaming = status === "submitted" || status === "streaming";
  // Show the "Thinking…" shimmer after sending, until the assistant produces
  // its first visible part.
  const waiting =
    streaming &&
    (!last ||
      last.role === "user" ||
      (last.role === "assistant" && !hasRenderableContent(last)));

  return (
    <div
      ref={containerRef}
      onScroll={handleScroll}
      className="flex-1 space-y-4 overflow-y-auto px-4 py-4"
    >
      {messages.map((message) => (
        <MessageBubble
          key={message.id}
          message={message}
          isActive={streaming && message.id === last?.id}
        />
      ))}

      {waiting && (
        <div className="flex items-center gap-2 text-muted-foreground">
          <Brain className="size-4 animate-pulse" />
          <span className="text-xs animate-pulse">Thinking…</span>
        </div>
      )}

      <div ref={endRef} />
    </div>
  );
}
