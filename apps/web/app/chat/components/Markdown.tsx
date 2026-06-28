"use client"

import { Streamdown } from "streamdown"

import { cn } from "@/lib/utils"

/**
 * Renders streamed assistant markdown. `streamdown` gracefully handles partial
 * markdown (unterminated code fences, half-written lists) as tokens arrive.
 */
export function Markdown({ children, className }: { children: string; className?: string }) {
  return (
    <Streamdown
      parseIncompleteMarkdown
      className={cn(
        "text-sm leading-relaxed break-words",
        "[&_p]:my-1.5 first:[&_p]:mt-0 last:[&_p]:mb-0",
        "[&_ul]:my-1.5 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:my-1.5 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:my-0.5",
        "[&_a]:font-medium [&_a]:text-chat-accent [&_a]:underline [&_a]:underline-offset-2",
        "[&_strong]:font-semibold [&_h1]:mt-3 [&_h1]:mb-1 [&_h1]:text-base [&_h1]:font-semibold",
        "[&_h2]:mt-3 [&_h2]:mb-1 [&_h2]:text-sm [&_h2]:font-semibold [&_h3]:mt-2 [&_h3]:font-semibold",
        "[&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[0.85em]",
        "[&_pre]:my-2 [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:text-xs [&_pre_code]:bg-transparent [&_pre_code]:p-0",
        "[&_table]:my-2 [&_table]:w-full [&_th]:border [&_th]:border-border [&_th]:px-2 [&_th]:py-1 [&_th]:text-left",
        "[&_td]:border [&_td]:border-border [&_td]:px-2 [&_td]:py-1",
        className
      )}
    >
      {children}
    </Streamdown>
  )
}
