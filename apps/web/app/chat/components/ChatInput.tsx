"use client";

import { useRef } from "react";
import { ArrowUp, Square } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

interface ChatInputProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onStop: () => void;
  status: string;
}

const MAX_HEIGHT = 160;

export function ChatInput({
  value,
  onChange,
  onSubmit,
  onStop,
  status,
}: ChatInputProps) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const busy = status === "submitted" || status === "streaming";
  const canSend = value.trim().length > 0 && !busy;

  function resize(el: HTMLTextAreaElement) {
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, MAX_HEIGHT)}px`;
  }

  function submit() {
    if (!canSend) return;
    onSubmit();
    const el = ref.current;
    if (el) {
      el.style.height = "auto";
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      className="flex items-end gap-2"
    >
      <Textarea
        ref={ref}
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          resize(e.target);
        }}
        onKeyDown={handleKeyDown}
        rows={1}
        placeholder="How can I help you today?"
        aria-label="Message"
        className="min-h-10 flex-1 [field-sizing:fixed]"
      />
      {busy ? (
        <Button
          type="button"
          size="icon"
          onClick={onStop}
          aria-label="Stop generating"
          className="size-10 shrink-0"
        >
          <Square className="size-4" />
        </Button>
      ) : (
        <Button
          type="submit"
          size="icon"
          disabled={!canSend}
          aria-label="Send message"
          className="size-10 shrink-0 bg-chat-accent text-chat-accent-foreground hover:bg-chat-accent/90"
        >
          <ArrowUp className="size-4" />
        </Button>
      )}
    </form>
  );
}
