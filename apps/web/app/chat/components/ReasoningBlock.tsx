"use client"

import { useState } from "react"
import { Brain, ChevronDown } from "lucide-react"

import { cn } from "@/lib/utils"

/**
 * Collapsible "Thinking" panel for model reasoning (the `<think>` content the
 * model middleware extracts). Renders nothing when there's no reasoning text.
 */
export function ReasoningBlock({ text, active }: { text: string; active?: boolean }) {
  const [open, setOpen] = useState(true)
  if (!text.trim()) return null

  return (
    <div className="text-muted-foreground">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 rounded-md py-0.5 text-xs font-medium transition-colors hover:text-foreground"
      >
        <Brain className={cn("size-3.5", active && "animate-pulse")} />
        <span>Thinking</span>
        <ChevronDown className={cn("size-3 transition-transform", open ? "" : "-rotate-90")} />
      </button>
      {open && (
        <div className="mt-1 ml-1.5 border-l-2 border-border pl-3 text-[13px] leading-relaxed whitespace-pre-wrap">
          {text}
        </div>
      )}
    </div>
  )
}
