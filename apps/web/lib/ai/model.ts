import { createOpenAICompatible } from "@ai-sdk/openai-compatible"
import { extractReasoningMiddleware, wrapLanguageModel } from "ai"

/**
 * The AcmeBox agent talks to a self-hosted vLLM server (OpenAI-compatible API)
 * serving LiquidAI/LFM2.5-8B-A1B on RunPod. All config is server-only — the
 * RunPod bearer key never reaches the browser (this module is imported only by
 * the route handler).
 */
const baseURL = process.env.VLLM_BASE_URL
if (!baseURL) {
  // Fail loudly at request time rather than silently hitting the wrong host.
  console.warn("[ai/model] VLLM_BASE_URL is not set — /api/chat will fail")
}

const vllm = createOpenAICompatible({
  name: "vllm",
  baseURL: baseURL ?? "http://localhost:8000/v1",
  apiKey: process.env.VLLM_API_KEY,
})

/**
 * Wrap the raw model so any `<think>...</think>` the model emits is split out of
 * the text stream into a separate reasoning stream (surfaced to the client as
 * `reasoning` message parts). We deliberately do NOT enable vLLM's own
 * reasoning parser — doing both would double-strip the tags.
 */
export const chatModel = wrapLanguageModel({
  model: vllm(process.env.VLLM_MODEL ?? "LiquidAI/LFM2.5-8B-A1B"),
  middleware: extractReasoningMiddleware({ tagName: "think" }),
})
