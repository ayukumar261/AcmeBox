#!/usr/bin/env bash
# Serve LFM2.5-8B-A1B (MoE) with vLLM as an OpenAI-compatible endpoint with tool
# calling enabled. RUN ON THE POD.
#
# Point apps/eval's AGENT_BASE_URL at  http://<pod-ip>:${SERVE_PORT}/v1
# and AGENT_MODEL at the BASE_MODEL id below.
#
# Usage (on the pod, inside apps/llm/):
#   scripts/serve.sh
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$HERE"
if [[ -f .env ]]; then set -a; source .env; set +a; fi

BASE_MODEL="${BASE_MODEL:-LiquidAI/LFM2.5-8B-A1B}"
SERVE_PORT="${SERVE_PORT:-8000}"
# ~17GB of bf16 weights only just fit the L4's 23GB, so keep the context modest
# and let vLLM claim most of the card. Bump MAX_MODEL_LEN down further if you OOM.
MAX_MODEL_LEN="${MAX_MODEL_LEN:-16384}"
GPU_MEMORY_UTILIZATION="${GPU_MEMORY_UTILIZATION:-0.95}"
TOOL_CALL_PARSER="${TOOL_CALL_PARSER:-lfm2}"

echo "[serve] model=$BASE_MODEL  port=$SERVE_PORT  tool-parser=$TOOL_CALL_PARSER"
echo "[serve] request model name '$BASE_MODEL' against http://0.0.0.0:$SERVE_PORT/v1"

exec vllm serve "$BASE_MODEL" \
  --host 0.0.0.0 \
  --port "$SERVE_PORT" \
  --max-model-len "$MAX_MODEL_LEN" \
  --gpu-memory-utilization "$GPU_MEMORY_UTILIZATION" \
  --enable-auto-tool-choice \
  --tool-call-parser "$TOOL_CALL_PARSER"
