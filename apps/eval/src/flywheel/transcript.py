"""Render a stored conversation into a judge-readable transcript.

The web app persists messages in the AI SDK ``UIMessage`` shape: each message has
``parts``, where a part is text, a tool call (``type == "tool-<name>"`` or
``"dynamic-tool"`` with ``input`` / ``output`` / ``errorText``), or reasoning. The
flat ``transcriptText`` the web route already stores drops tool arguments and
results — but those are exactly what policy compliance turns on (was
``customers_getById`` called before mutating? was ``addresses_list`` called before
``addresses_setDefault``?). So the judge needs a richer rendering that surfaces
each tool call's arguments and result.
"""

from __future__ import annotations

import json
from typing import Any

# Tool results can be large (a full meals catalog, an order list). Cap them so a
# single fat result can't blow the judge's context window; the head is enough to
# verify the call happened and roughly what it returned.
_MAX_RESULT_CHARS = 1500


def _is_tool_part(part: dict[str, Any]) -> bool:
    """A part is a tool call when its type is ``tool-<name>`` or ``dynamic-tool``
    (the AI SDK's two tool-part encodings; same test as the web route)."""

    t = part.get("type")
    return isinstance(t, str) and (t.startswith("tool-") or t == "dynamic-tool")


def _tool_name(part: dict[str, Any]) -> str:
    name = part.get("toolName")
    if isinstance(name, str) and name:
        return name
    t = part.get("type")
    if isinstance(t, str) and t.startswith("tool-"):
        return t[len("tool-") :]
    return "call"


def _stringify(value: Any) -> str:
    if isinstance(value, str):
        return value
    try:
        return json.dumps(value, default=str, ensure_ascii=False)
    except (TypeError, ValueError):
        return str(value)


def render_transcript(messages: list[dict[str, Any]]) -> str:
    """Flatten ``messages`` to a readable transcript with tool calls + results.

    Reasoning parts are intentionally omitted — the judge grades observable
    behavior (what the agent said and which tools it ran), not its private
    chain-of-thought.
    """

    lines: list[str] = []
    for message in messages:
        role = str(message.get("role", "?")).upper()
        for part in message.get("parts") or []:
            if not isinstance(part, dict):
                continue
            ptype = part.get("type")
            if ptype == "text":
                text = (part.get("text") or "").strip()
                if text:
                    lines.append(f"{role}: {text}")
            elif _is_tool_part(part):
                name = _tool_name(part)
                args = part.get("input")
                arg_str = _stringify(args) if args is not None else ""
                lines.append(f"  [tool call] {name}({arg_str})")
                if part.get("errorText"):
                    lines.append(f"  [tool error] {part['errorText']}")
                elif part.get("output") is not None:
                    out = _stringify(part["output"])
                    if len(out) > _MAX_RESULT_CHARS:
                        out = out[:_MAX_RESULT_CHARS] + " …(truncated)"
                    lines.append(f"  [tool result] {out}")
    return "\n".join(lines)


def extract_tool_calls(messages: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Pull every tool call out of a conversation as structured records.

    Used by the judge prompt (and later the corrector) to reason about the action
    sequence without re-parsing the rendered text.
    """

    calls: list[dict[str, Any]] = []
    for message in messages:
        for part in message.get("parts") or []:
            if isinstance(part, dict) and _is_tool_part(part):
                calls.append(
                    {
                        "name": _tool_name(part),
                        "input": part.get("input"),
                        "output": part.get("output"),
                        "error": part.get("errorText"),
                    }
                )
    return calls


def render_openai_transcript(messages: list[dict[str, Any]]) -> str:
    """Render OpenAI chat-format messages (the corrector's output) for the judge.

    Mirrors ``render_transcript`` but reads the canonical message shape the
    corrector produces — ``assistant`` turns carry ``tool_calls`` (with a
    JSON-string ``function.arguments``) and results come back as separate
    ``tool`` messages — rather than AI SDK ``parts``. ``system`` turns are skipped.
    """

    lines: list[str] = []
    for message in messages:
        role = str(message.get("role", "?"))
        if role == "system":
            continue
        if role == "tool":
            content = _stringify(message.get("content", ""))
            if len(content) > _MAX_RESULT_CHARS:
                content = content[:_MAX_RESULT_CHARS] + " …(truncated)"
            lines.append(f"  [tool result] {content}")
            continue
        content = (message.get("content") or "").strip()
        if content:
            lines.append(f"{role.upper()}: {content}")
        for call in message.get("tool_calls") or []:
            fn = call.get("function", {}) if isinstance(call, dict) else {}
            name = fn.get("name", "call")
            args = fn.get("arguments", "")
            lines.append(f"  [tool call] {name}({args})")
    return "\n".join(lines)


def messages_openai_to_ui(messages: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Convert OpenAI chat messages → the web app's UIMessage ``parts`` shape.

    The scenario generator captures the agent's history in OpenAI format
    (assistant ``tool_calls`` + separate ``tool`` results); the web app stores
    UIMessage ``parts`` where each tool part carries both ``input`` and ``output``.
    Converting at storage time means generated transcripts look exactly like web
    chats, so the judge/corrector/export consume them with no special-casing. The
    ``system`` turn is dropped (it's the policy, re-added at export time).
    """

    ui: list[dict[str, Any]] = []
    pending: dict[str, dict[str, Any]] = {}  # tool_call_id -> tool part awaiting output
    for msg in messages:
        role = msg.get("role")
        if role == "user":
            ui.append({"role": "user", "parts": [{"type": "text", "text": str(msg.get("content", ""))}]})
        elif role == "assistant":
            parts: list[dict[str, Any]] = []
            if msg.get("content"):
                parts.append({"type": "text", "text": msg["content"]})
            for call in msg.get("tool_calls") or []:
                fn = call.get("function", {}) if isinstance(call, dict) else {}
                name = fn.get("name", "")
                args = fn.get("arguments")
                if isinstance(args, str):
                    try:
                        args = json.loads(args)
                    except json.JSONDecodeError:
                        pass
                part = {
                    "type": f"tool-{name}",
                    "toolName": name,
                    "toolCallId": call.get("id"),
                    "input": args,
                }
                parts.append(part)
                if call.get("id"):
                    pending[call["id"]] = part
            ui.append({"role": "assistant", "parts": parts})
        elif role == "tool":
            part = pending.get(msg.get("tool_call_id"))
            if part is not None:
                part["output"] = msg.get("content", "")
        # system and anything else: skipped
    return ui


def has_user_text(messages: list[dict[str, Any]]) -> bool:
    """True if the customer actually said something (a non-empty user text part).

    Lets the worker skip empty/aborted conversations rather than spend a judge
    call on them.
    """

    for message in messages:
        if str(message.get("role")) != "user":
            continue
        for part in message.get("parts") or []:
            if (
                isinstance(part, dict)
                and part.get("type") == "text"
                and (part.get("text") or "").strip()
            ):
                return True
    return False
