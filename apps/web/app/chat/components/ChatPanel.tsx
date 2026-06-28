"use client";

import { useState } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { Bot, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ChatInput } from "./ChatInput";
import { MessageList } from "./MessageList";

export function ChatPanel({ onClose }: { onClose: () => void }) {
  const [input, setInput] = useState("");
  const { messages, sendMessage, status, stop } = useChat({
    transport: new DefaultChatTransport({ api: "/api/chat" }),
  });

  function submit() {
    const text = input.trim();
    if (!text) return;
    sendMessage({ text });
    setInput("");
  }

  return (
    <div className="flex h-[600px] max-h-[80dvh] w-[400px] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-2xl border border-border bg-card text-card-foreground shadow-2xl ring-1 ring-foreground/5">
      <header className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
        <div className="flex items-center gap-2.5">
          <div className="grid size-8 place-items-center rounded-full bg-chat-accent text-chat-accent-foreground">
            <Bot className="size-4.5" />
          </div>
          <div className="leading-tight">
            <p className="text-sm font-medium">Assistant</p>
            <p className="text-xs text-muted-foreground">Meal-kit support</p>
          </div>
        </div>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onClose}
          aria-label="Close chat"
        >
          <X className="size-4" />
        </Button>
      </header>

      <MessageList messages={messages} status={status} />

      {status === "error" && (
        <p className="px-4 pb-1 text-xs text-destructive">
          Something went wrong. Check that the model endpoint and AcmeBox API
          are reachable.
        </p>
      )}

      <div className="border-t border-border p-3">
        <ChatInput
          value={input}
          onChange={setInput}
          onSubmit={submit}
          onStop={stop}
          status={status}
        />
      </div>
    </div>
  );
}
