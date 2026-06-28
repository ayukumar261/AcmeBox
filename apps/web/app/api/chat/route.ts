import {
  convertToModelMessages,
  createUIMessageStreamResponse,
  stepCountIs,
  streamText,
  toUIMessageStream,
  type UIMessage,
} from "ai"

import { chatModel } from "@/lib/ai/model"
import { SYSTEM_PROMPT } from "@/lib/ai/system-prompt"
import { acmeboxTools } from "@/lib/ai/tools"

// Tools fetch from the local AcmeBox API and the vLLM call is server-side, so
// this must run on the Node runtime (not edge).
export const runtime = "nodejs"
export const maxDuration = 60

export async function POST(req: Request) {
  const { messages }: { messages: UIMessage[] } = await req.json()

  const result = streamText({
    model: chatModel,
    system: SYSTEM_PROMPT,
    messages: await convertToModelMessages(messages),
    tools: acmeboxTools,
    // Multi-step agent loop: model calls a tool -> we run it -> feed the result
    // back -> model continues, up to 10 steps (mirrors _MAX_TOOL_ITERS in
    // apps/eval/src/conversation.py).
    stopWhen: stepCountIs(10),
  })

  return createUIMessageStreamResponse({
    stream: toUIMessageStream({
      stream: result.fullStream,
      // Forward `<think>` reasoning parts (extracted by the model middleware).
      sendReasoning: true,
      // Surface real error text to the client instead of the default masked
      // "An error occurred." — useful while integrating against vLLM.
      onError: (error) => (error instanceof Error ? error.message : String(error)),
    }),
  })
}
