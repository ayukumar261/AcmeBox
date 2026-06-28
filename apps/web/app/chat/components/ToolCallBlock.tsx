"use client"

import { useState } from "react"
import { Check, ChevronDown, Loader2, Wrench, X } from "lucide-react"

import { cn } from "@/lib/utils"

export interface ToolCallBlockProps {
  name: string
  state: string
  input?: unknown
  output?: unknown
  errorText?: string
}

function stringify(value: unknown): string {
  if (value == null) return ""
  if (typeof value === "string") return value
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

/**
 * Renders a single tool invocation (the Wrench rows in the sketch). Shows the
 * tool name, a running/done/error indicator, and the input + result on expand.
 */
export function ToolCallBlock({ name, state, input, output, errorText }: ToolCallBlockProps) {
  const [open, setOpen] = useState(false)
  const running = state === "input-streaming" || state === "input-available"
  const error = state === "output-error"

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-muted/40">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 px-2.5 py-2 text-left transition-colors hover:bg-muted/70"
      >
        <Wrench className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="flex-1 truncate font-mono text-xs text-foreground">{name}</span>
        {running ? (
          <Loader2 className="size-3.5 shrink-0 animate-spin text-muted-foreground" />
        ) : error ? (
          <X className="size-3.5 shrink-0 text-destructive" />
        ) : (
          <Check className="size-3.5 shrink-0 text-muted-foreground" />
        )}
        <ChevronDown
          className={cn("size-3 shrink-0 text-muted-foreground transition-transform", open ? "" : "-rotate-90")}
        />
      </button>

      {open && (
        <div className="space-y-2 border-t border-border px-2.5 py-2 text-xs">
          {input != null && stringify(input) !== "{}" && (
            <div>
              <p className="mb-1 font-medium text-muted-foreground">Arguments</p>
              <pre className="overflow-x-auto rounded bg-background/60 p-2 font-mono text-[11px] leading-relaxed">
                {stringify(input)}
              </pre>
            </div>
          )}
          {error ? (
            <pre className="overflow-x-auto rounded bg-destructive/10 p-2 font-mono text-[11px] leading-relaxed text-destructive">
              {errorText || "Tool error"}
            </pre>
          ) : (
            output != null && (
              <div>
                <p className="mb-1 font-medium text-muted-foreground">Result</p>
                <pre className="max-h-48 overflow-auto rounded bg-background/60 p-2 font-mono text-[11px] leading-relaxed">
                  {stringify(output)}
                </pre>
              </div>
            )
          )}
        </div>
      )}
    </div>
  )
}
