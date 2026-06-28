#!/usr/bin/env bash
# Fired by the flywheel loop's --train-cmd on each training trigger. Ships the
# freshly-exported dataset to a PERSISTENT training pod (A40/A100) and runs LoRA
# SFT there. Runs from your laptop (where the loop runs); the pod does the GPU work.
#
# Prereqs on the pod (one-time): repo cloned to $TRAIN_POD_DIR and `scripts/setup.sh`
# run (installs the GPU base). This script ships only the new dataset each time.
#
# Configure via apps/llm/.env (sourced below) or the environment:
#   TRAIN_POD_SSH   ssh destination — e.g.  root@1.2.3.4   or  <podid>-xxxx@ssh.runpod.io   (required)
#   TRAIN_POD_PORT  ssh port (RunPod direct-TCP uses a custom port; omit for the proxy form)
#   TRAIN_POD_KEY   ssh key path (default ~/.ssh/id_ed25519_runpod)
#   TRAIN_POD_DIR   repo path on the pod (default /workspace/AcmeBox)
#
# Usage: train_remote.sh <local-dataset.jsonl>
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
if [[ -f "$HERE/.env" ]]; then set -a; source "$HERE/.env"; set +a; fi

DATASET_LOCAL="${1:?usage: train_remote.sh <dataset.jsonl>}"
: "${TRAIN_POD_SSH:?set TRAIN_POD_SSH (e.g. in apps/llm/.env) to your training pod ssh destination}"
KEY="${TRAIN_POD_KEY:-$HOME/.ssh/id_ed25519_runpod}"
DIR="${TRAIN_POD_DIR:-/workspace/AcmeBox}"
STAMP="$(date +%Y%m%d-%H%M%S)"
REMOTE_DATASET="/workspace/sft-${STAMP}.jsonl"

SCP_PORT=(); SSH_PORT=()
if [[ -n "${TRAIN_POD_PORT:-}" ]]; then SCP_PORT=(-P "$TRAIN_POD_PORT"); SSH_PORT=(-p "$TRAIN_POD_PORT"); fi
SSH_OPTS=(-i "$KEY" -o StrictHostKeyChecking=accept-new)

echo "[train_remote] $(date -u +%H:%M:%S) shipping $DATASET_LOCAL -> $TRAIN_POD_SSH:$REMOTE_DATASET"
scp "${SCP_PORT[@]}" "${SSH_OPTS[@]}" "$DATASET_LOCAL" "$TRAIN_POD_SSH:$REMOTE_DATASET"

echo "[train_remote] launching LoRA SFT on the pod (OUTPUT_DIR=adapters/adapter-$STAMP)"
ssh "${SSH_PORT[@]}" "${SSH_OPTS[@]}" "$TRAIN_POD_SSH" \
  "cd '$DIR/apps/llm' && DATASET='$REMOTE_DATASET' OUTPUT_DIR='adapters/adapter-$STAMP' bash scripts/train.sh"

echo "[train_remote] done — adapter on the pod at $DIR/apps/llm/adapters/adapter-$STAMP"
