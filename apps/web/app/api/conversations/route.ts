import { z } from "zod"

import { getDb } from "@/lib/db/mongo"

// The Mongo driver needs the Node runtime (not edge), same as the chat route.
export const runtime = "nodejs"

// Tolerant message/part shapes: UIMessage parts vary (text / reasoning /
// dynamic-tool with toolName, input, output, errorText). `.loose()` keeps every
// field verbatim so the stored document mirrors what the client held.
const MessageSchema = z
  .object({
    id: z.string(),
    role: z.string(),
    parts: z.array(z.object({}).loose()),
  })
  .loose()

const BodySchema = z.object({
  conversationId: z.string().min(1),
  customerId: z.string().optional(),
  startedAt: z.coerce.date(),
  endedAt: z.coerce.date(),
  messages: z.array(MessageSchema).min(1),
})

type Part = { type?: string; text?: string; toolName?: string }
type Message = { role: string; parts: Part[] }

// A part is a tool call when its type is `tool-<name>` or `dynamic-tool`
// (the AI SDK's two tool-part encodings).
function isToolPart(part: Part): boolean {
  return (
    typeof part.type === "string" &&
    (part.type.startsWith("tool-") || part.type === "dynamic-tool")
  )
}

// Flat, human-readable rendering of the transcript. Only text parts contribute
// prose; tool calls leave a short marker. Reasoning is intentionally skipped
// here (it's still preserved verbatim in the raw `messages` array).
function flattenTranscript(messages: Message[]): string {
  return messages
    .map((message) => {
      const body = message.parts
        .map((part) => {
          if (part.type === "text") return part.text ?? ""
          if (isToolPart(part)) {
            const name = part.toolName ?? part.type?.replace(/^tool-/, "")
            return `[tool ${name ?? "call"}]`
          }
          return ""
        })
        .filter(Boolean)
        .join(" ")
      return `${message.role}: ${body}`.trimEnd()
    })
    .join("\n")
}

// Ensure the upsert key is unique. Guarded so we only pay the round-trip once
// per server process rather than on every request.
let indexEnsured = false

export async function POST(req: Request) {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: "invalid JSON" }, { status: 400 })
  }

  const parsed = BodySchema.safeParse(body)
  if (!parsed.success) {
    return Response.json(
      { error: "validation failed", issues: parsed.error.issues },
      { status: 400 },
    )
  }
  const { conversationId, customerId, startedAt, endedAt, messages } =
    parsed.data

  const typedMessages = messages as unknown as Message[]
  const messageCount = typedMessages.length
  const toolCallCount = typedMessages.reduce(
    (n, m) => n + m.parts.filter(isToolPart).length,
    0,
  )
  const transcriptText = flattenTranscript(typedMessages)

  try {
    const db = await getDb()
    const conversations = db.collection("conversations")

    if (!indexEnsured) {
      await conversations.createIndex(
        { conversationId: 1 },
        { unique: true },
      )
      indexEnsured = true
    }

    const now = new Date()
    // Upsert by conversationId so a client retry — or the pagehide + close
    // double-fire — never creates a duplicate document.
    await conversations.updateOne(
      { conversationId },
      {
        $set: {
          conversationId,
          customerId: customerId ?? null,
          startedAt,
          endedAt,
          messageCount,
          toolCallCount,
          messages,
          transcriptText,
          updatedAt: now,
        },
        $setOnInsert: { createdAt: now },
      },
      { upsert: true },
    )

    return Response.json({ ok: true, conversationId }, { status: 200 })
  } catch (err) {
    console.error("[conversations] persist failed", err)
    return Response.json({ error: "persist failed" }, { status: 500 })
  }
}
