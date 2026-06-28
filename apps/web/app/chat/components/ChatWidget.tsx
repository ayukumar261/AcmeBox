"use client";

import { useState } from "react";
import { MessageCircle, X } from "lucide-react";

import { cn } from "@/lib/utils";
import { ChatPanel } from "./ChatPanel";

/**
 * Floating support widget pinned to the bottom-right corner. A blue launcher
 * button toggles the chat card, which floats above it. The panel stays mounted
 * so the conversation persists across open/close.
 */
export function ChatWidget() {
  const [open, setOpen] = useState(false);

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
        <ChatPanel onClose={() => setOpen(false)} />
      </div>

      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
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
