"use client"

import { getToolName, isToolUIPart, type UIMessage } from "ai"

import { Markdown } from "./Markdown"
import { ReasoningBlock } from "./ReasoningBlock"
import { ToolCallBlock } from "./ToolCallBlock"

/**
 * Renders one message. User turns are right-aligned blue bubbles; assistant
 * turns are full-width and stream reasoning, tool calls, and answer text in the
 * order the parts arrive.
 */
export function MessageBubble({ message, isActive }: { message: UIMessage; isActive: boolean }) {
  if (message.role === "user") {
    const text = message.parts
      .map((part) => (part.type === "text" ? part.text : ""))
      .join("")
    return (
      <div className="flex justify-end">
        <div className="max-w-[80%] rounded-2xl rounded-br-sm bg-chat-accent px-3.5 py-2 text-sm whitespace-pre-wrap break-words text-chat-accent-foreground">
          {text}
        </div>
      </div>
    )
  }

  return (
    <div className="flex w-full flex-col gap-2">
      {message.parts.map((part, i) => {
        switch (part.type) {
          case "text":
            return part.text ? <Markdown key={i}>{part.text}</Markdown> : null
          case "reasoning":
            return <ReasoningBlock key={i} text={part.text} active={isActive} />
          case "dynamic-tool":
            return (
              <ToolCallBlock
                key={i}
                name={part.toolName}
                state={part.state}
                input={part.input}
                output={part.output}
                errorText={part.errorText}
              />
            )
          default:
            if (isToolUIPart(part)) {
              return (
                <ToolCallBlock
                  key={i}
                  name={getToolName(part)}
                  state={part.state}
                  input={part.input}
                  output={part.output}
                  errorText={part.errorText}
                />
              )
            }
            return null
        }
      })}
    </div>
  )
}

/** True when an assistant message has something visible to show. */
export function hasRenderableContent(message: UIMessage): boolean {
  return message.parts.some((part) => {
    if (part.type === "text") return part.text.trim().length > 0
    if (part.type === "reasoning") return part.text.trim().length > 0
    return part.type === "dynamic-tool" || isToolUIPart(part)
  })
}
