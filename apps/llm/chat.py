#!/usr/bin/env python3
"""Tiny terminal chat client for the LFM2.5 vLLM endpoint (OpenAI-compatible).

No dependencies — uses only the Python standard library. Streams replies token
by token and keeps the conversation history in memory.

Usage:
    python3 chat.py                         # talk to the default endpoint
    BASE_URL=http://localhost:8000/v1 python3 chat.py
    MODEL=LiquidAI/LFM2.5-8B-A1B python3 chat.py

In the chat:
    /reset   start a new conversation
    /exit    quit   (Ctrl-D or Ctrl-C also quit)
"""

import json
import os
import sys
import urllib.request

BASE_URL = os.getenv("BASE_URL", "https://1tbj4yr4jpvib2-8000.proxy.runpod.net/v1").rstrip("/")
MODEL = os.getenv("MODEL", "LiquidAI/LFM2.5-8B-A1B")
API_KEY = os.getenv("API_KEY", "EMPTY")
SYSTEM = os.getenv("SYSTEM_PROMPT", "You are a helpful, concise assistant.")


def stream_reply(messages):
    """POST to /chat/completions with stream=True; yield content chunks."""
    body = json.dumps({"model": MODEL, "messages": messages, "stream": True}).encode()
    req = urllib.request.Request(
        f"{BASE_URL}/chat/completions",
        data=body,
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {API_KEY}",
            # RunPod's proxy sits behind Cloudflare, which 403s the default
            # "Python-urllib" User-Agent — send a plain one.
            "User-Agent": "lfm-chat/1.0",
        },
    )
    with urllib.request.urlopen(req, timeout=120) as resp:
        for raw in resp:
            line = raw.decode("utf-8").strip()
            if not line.startswith("data:"):
                continue
            data = line[len("data:"):].strip()
            if data == "[DONE]":
                break
            delta = json.loads(data)["choices"][0]["delta"]
            if delta.get("content"):
                yield delta["content"]


def main():
    print(f"LFM2.5 chat — model={MODEL}\n  {BASE_URL}\n  /reset to clear, /exit to quit\n")
    messages = [{"role": "system", "content": SYSTEM}]
    while True:
        try:
            user = input("you> ").strip()
        except (EOFError, KeyboardInterrupt):
            print()
            break
        if not user:
            continue
        if user == "/exit":
            break
        if user == "/reset":
            messages = [{"role": "system", "content": SYSTEM}]
            print("(conversation reset)\n")
            continue

        messages.append({"role": "user", "content": user})
        print("lfm> ", end="", flush=True)
        reply = ""
        try:
            for chunk in stream_reply(messages):
                reply += chunk
                sys.stdout.write(chunk)
                sys.stdout.flush()
        except Exception as e:
            print(f"\n[error talking to {BASE_URL}: {e}]\n")
            messages.pop()  # drop the unanswered turn
            continue
        print("\n")
        messages.append({"role": "assistant", "content": reply})


if __name__ == "__main__":
    main()
