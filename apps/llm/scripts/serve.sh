#!/usr/bin/env bash
# Serve LFM2.5-1.2B-Instruct with vLLM as an OpenAI-compatible endpoint with tool
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

BASE_MODEL="${BASE_MODEL:-LiquidAI/LFM2.5-1.2B-Instruct}"
SERVE_PORT="${SERVE_PORT:-8000}"
MAX_MODEL_LEN="${MAX_MODEL_LEN:-32768}"
TOOL_CALL_PARSER="${TOOL_CALL_PARSER:-lfm2}"

echo "[serve] model=$BASE_MODEL  port=$SERVE_PORT  tool-parser=$TOOL_CALL_PARSER"
echo "[serve] request model name '$BASE_MODEL' against http://0.0.0.0:$SERVE_PORT/v1"

exec vllm serve "$BASE_MODEL" \
  --host 0.0.0.0 \
  --port "$SERVE_PORT" \
  --max-model-len "$MAX_MODEL_LEN" \
  --enable-auto-tool-choice \
  --tool-call-parser "$TOOL_CALL_PARSER"
