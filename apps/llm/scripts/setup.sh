#!/usr/bin/env bash
# One-time environment bootstrap. RUN ON THE POD (RunPod PyTorch image, CUDA 12.x).
# Installs the GPU stack that intentionally is NOT in pyproject.toml.
#
#   bash scripts/setup.sh
set -euo pipefail

echo "[setup] python: $(python --version)"
echo "[setup] nvidia:"; nvidia-smi --query-gpu=name,memory.total --format=csv,noheader || true

pip install --upgrade pip

# vLLM pulls a matching torch CUDA build as a dependency. v0.23+ registers both
# the dense LFM2.5 (`Lfm2ForCausalLM`) and the MoE (`Lfm2MoeForCausalLM`, what
# LFM2.5-8B-A1B uses) architectures, plus the native `lfm2` tool-call parser.
pip install "vllm>=0.23"

# LFM2.5 is open-license (not gated), so no HF login is required. Set HF_TOKEN
# only to lift anonymous download rate limits.
if [[ -n "${HF_TOKEN:-}" ]]; then
  python -c "from huggingface_hub import login; login('${HF_TOKEN}')"
  echo "[setup] logged into Hugging Face"
fi

echo "[setup] done. Next: scripts/serve.sh"
