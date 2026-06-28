#!/usr/bin/env bash
# LoRA SFT for LFM2.5-8B-A1B (MoE). RUN ON A GPU POD, separate from the serving
# pod — the serving L4 (23GB) is too small to train an 8B even with QLoRA, so use
# an A40/A100-class card.
#
# Inputs:
#   DATASET     path to the JSONL from `acmebox-flywheel export` (required)
#   OUTPUT_DIR  where to write the adapter (default adapters/adapter-<timestamp>)
#   plus the TRAIN_* / LORA_* knobs in .env.example
#
# Usage (on the pod, inside apps/llm/):
#   scripts/setup.sh            # once: installs the GPU base (vllm pulls torch)
#   DATASET=/data/sft.jsonl scripts/train.sh
#
# Afterwards, copy OUTPUT_DIR to the serving pod and load it into vLLM (Phase 6).
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$HERE"
if [[ -f .env ]]; then set -a; source .env; set +a; fi

: "${DATASET:?Set DATASET to the exported sft.jsonl (from acmebox-flywheel export)}"
BASE_MODEL="${BASE_MODEL:-LiquidAI/LFM2.5-8B-A1B}"
OUTPUT_DIR="${OUTPUT_DIR:-adapters/adapter-$(date +%Y%m%d-%H%M%S)}"

echo "[train] nvidia:"; nvidia-smi --query-gpu=name,memory.total --format=csv,noheader || true
echo "[train] base=$BASE_MODEL  dataset=$DATASET  out=$OUTPUT_DIR"

pip install -r train/requirements-train.txt

exec python train/sft.py \
  --dataset "$DATASET" \
  --base-model "$BASE_MODEL" \
  --output-dir "$OUTPUT_DIR"
