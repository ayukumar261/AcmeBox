# AcmeBox LLM (`apps/llm`)

vLLM serving for the **agent-under-test** in the continual-learning hackathon. The
model is **Liquid `LFM2.5-1.2B-Instruct`**, served as an **OpenAI-compatible**
endpoint that [`apps/eval`](../eval) points its `AGENT_BASE_URL` at.

## The workflow in one picture

```
  your laptop (this monorepo)            RunPod GPU pod (L4 / 24GB)
  ───────────────────────────            ──────────────────────────
  edit apps/llm/* + push     ──git──▶     git pull on the pod
                                              │
                                              ├─ scripts/setup.sh   (once: installs vLLM)
                                              └─ scripts/serve.sh   (vLLM :8000)
                                                       │
  apps/eval  ──AGENT_BASE_URL=http://<pod>:8000/v1──▶ scored
```

**Git is the source of truth; the pod is disposable compute.** You edit and push
here, `git pull` on the pod, run there. Model weights download to the pod's **HF
cache** on `/workspace`, never into git.

## 1. SSH onto the pod

Use the RunPod-specific key (`id_ed25519_runpod`). Grab the connection details from
the pod's **Connect** panel — either the direct TCP form (`ssh -i
~/.ssh/id_ed25519_runpod root@<pod-ip> -p <pod-ssh-port>`) or the proxy form
(`ssh <pod-id>-...@ssh.runpod.io -i ~/.ssh/id_ed25519_runpod`). Verify with
`nvidia-smi`.

## 2. On the pod (first time)

```bash
git clone <repo-url> /workspace/AcmeBox   # or: cd /workspace/AcmeBox && git pull
cd /workspace/AcmeBox/apps/llm
cp .env.example .env         # adjust BASE_MODEL / serving vars if needed
bash scripts/setup.sh        # installs vLLM (>=0.23)
```

LFM2.5 is open-license (not gated), so no Hugging Face token is required — set
`HF_TOKEN` in `.env` only to lift anonymous download rate limits.

## 3. Serve it (tool calling on)

```bash
# on the pod
scripts/serve.sh
# OpenAI-compatible at http://0.0.0.0:8000/v1  (model name: "LiquidAI/LFM2.5-1.2B-Instruct")
```

Make sure port **8000** is exposed in the pod's network settings.

## 4. Point the eval harness at it

In [`apps/eval/.env`](../eval/.env):

```ini
AGENT_BASE_URL=http://<pod-ip>:8000/v1
AGENT_MODEL=LiquidAI/LFM2.5-1.2B-Instruct
API_KEY=EMPTY              # vLLM ignores the key by default
```

Then run the benchmark as usual (`poetry run acmebox-eval run ...`) and read the
score.

## Notes / gotchas

- **Tool calling** uses vLLM's native `lfm2` parser (set via `TOOL_CALL_PARSER` in
  `.env`). Smoke-test that tool calls actually parse before trusting scores — a
  parse failure tanks the benchmark for reasons unrelated to the model.
- **Exposed port.** vLLM listens on `0.0.0.0:8000`; the pod must expose 8000 for the
  eval harness to reach it.
