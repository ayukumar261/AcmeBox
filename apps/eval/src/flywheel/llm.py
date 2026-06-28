"""A minimal OpenAI-compatible text client for the judge/teacher.

Trimmed from ``src.conversation.LLM``: the flywheel only needs plain-text (and
JSON) completions, never tool calls, so this stays free of the MCP imports. Like
the harness client it always streams — some providers (e.g. Together's larger
models) reject non-streamed requests, and streaming is a harmless superset
elsewhere.
"""

from __future__ import annotations

import json
import re
from typing import Any

from openai import OpenAI

from .config import ModelConfig


class LLM:
    """One configured model endpoint (the judge, or the teacher)."""

    def __init__(self, cfg: ModelConfig) -> None:
        self._model = cfg.model
        self._client = OpenAI(base_url=cfg.base_url, api_key=cfg.api_key)

    def complete(
        self,
        messages: list[dict[str, Any]],
        *,
        temperature: float = 0.0,
        max_tokens: int | None = None,
    ) -> str:
        """Stream one completion and return the concatenated text."""

        kwargs: dict[str, Any] = {
            "model": self._model,
            "messages": messages,
            "stream": True,
            "temperature": temperature,
        }
        if max_tokens is not None:
            kwargs["max_tokens"] = max_tokens

        parts: list[str] = []
        for chunk in self._client.chat.completions.create(**kwargs):
            if not chunk.choices:
                continue
            delta = chunk.choices[0].delta
            if delta.content:
                parts.append(delta.content)
        return "".join(parts)


_FENCE_RE = re.compile(r"```(?:json)?\s*(.*?)\s*```", re.DOTALL)


def extract_json(text: str) -> dict[str, Any]:
    """Best-effort parse of a JSON object out of a model's reply.

    Models sometimes wrap JSON in ``` fences or add a stray sentence. We try, in
    order: the raw text, any fenced block, then the first balanced ``{...}`` span.
    Raises ``ValueError`` if nothing parses, so the caller can record an honest
    judge failure rather than crashing.
    """

    candidates: list[str] = [text]
    fenced = _FENCE_RE.search(text)
    if fenced:
        candidates.append(fenced.group(1))
    span = _first_balanced_object(text)
    if span is not None:
        candidates.append(span)

    for candidate in candidates:
        candidate = candidate.strip()
        if not candidate:
            continue
        try:
            parsed = json.loads(candidate)
        except json.JSONDecodeError:
            continue
        if isinstance(parsed, dict):
            return parsed
    raise ValueError(f"no JSON object found in model reply: {text[:200]!r}")


def _first_balanced_object(text: str) -> str | None:
    """Return the first brace-balanced ``{...}`` substring, or None.

    Brace counting is string-aware so a ``}`` inside a quoted value doesn't close
    the object early.
    """

    start = text.find("{")
    if start == -1:
        return None
    depth = 0
    in_string = False
    escaped = False
    for i in range(start, len(text)):
        ch = text[i]
        if in_string:
            if escaped:
                escaped = False
            elif ch == "\\":
                escaped = True
            elif ch == '"':
                in_string = False
            continue
        if ch == '"':
            in_string = True
        elif ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                return text[start : i + 1]
    return None
