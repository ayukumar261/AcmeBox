"use client";

import { useState } from "react";
import { Check, ThumbsDown, ThumbsUp, X } from "lucide-react";

import { Button } from "@/components/ui/button";

export type ConversationRating = "up" | "down";

/**
 * Shown in place of the chat panel when a conversation ends (the user closes
 * the widget after at least one exchange). It collects a quick thumbs up/down,
 * acknowledges it, and then the widget closes. Dismissing without rating is
 * allowed. The card mirrors the panel's chrome/width so the swap reads as the
 * same surface transitioning into a "before you go" step.
 */
export function FeedbackCard({
  onRate,
  onDismiss,
}: {
  onRate: (rating: ConversationRating) => void;
  onDismiss: () => void;
}) {
  const [rated, setRated] = useState<ConversationRating | null>(null);

  function rate(rating: ConversationRating) {
    if (rated) return; // ignore a second click while we close
    setRated(rating);
    onRate(rating);
  }

  return (
    <div className="w-[400px] max-w-[calc(100vw-2rem)] overflow-hidden rounded-2xl border border-border bg-card text-card-foreground shadow-2xl ring-1 ring-foreground/5">
      <header className="flex items-center justify-end border-b border-border px-3 py-2">
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onDismiss}
          aria-label="Dismiss feedback"
        >
          <X className="size-4" />
        </Button>
      </header>

      <div className="px-6 py-8 text-center">
        {rated ? (
          <div className="flex flex-col items-center gap-2">
            <div className="grid size-10 place-items-center rounded-full bg-chat-accent/10 text-chat-accent">
              <Check className="size-5" />
            </div>
            <p className="text-sm font-medium">Thanks for the feedback!</p>
          </div>
        ) : (
          <>
            <p className="text-sm font-medium">Was this a good conversation?</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Your feedback helps us improve.
            </p>
            <div className="mt-4 flex items-center justify-center gap-2">
              <Button
                variant="outline"
                onClick={() => rate("up")}
                className="gap-1.5"
              >
                <ThumbsUp className="size-4" />
                Yes
              </Button>
              <Button
                variant="outline"
                onClick={() => rate("down")}
                className="gap-1.5"
              >
                <ThumbsDown className="size-4" />
                No
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
