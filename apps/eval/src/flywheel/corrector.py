"""Phase 2: turn a judge-failed transcript into gold training data.

A strong "teacher" model rewrites the failed conversation into a single correct,
policy-compliant version that resolves the customer's request. Two guardrails keep
the synthetic data honest:

1. **Real-result reuse** — when the corrected conversation makes a tool call that
   the original also made with identical arguments, we splice the REAL recorded
   result back in. Those are read-only lookups against the same database, so the
   real answer is authoritative; only genuinely-new calls get a teacher-invented
   result.
2. **Verifier gate** — the same judge from Phase 1 re-grades the rewrite. We keep
   it only if it now passes; a rewrite the judge still fails is dropped, never
   trained on.

The corrected conversation is emitted in OpenAI chat format (``user`` /
``assistant`` with ``tool_calls`` / ``tool``), the same shape
``src.conversation`` builds — so Phase 3 can export it to the model's chat
template with assistant-only loss masking.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any

from .judge import Verdict, judge_transcript
from .llm import LLM, extract_json
from .tools import catalog_text
from .transcript import (
    extract_tool_calls,
    render_openai_transcript,
    render_transcript,
)

_SYSTEM = """You are a senior AcmeBox support agent and a training-data author. \
You are given a transcript where a junior agent handled a customer incorrectly, \
plus the QA critique explaining what went wrong. Rewrite it into a single CORRECT \
version that fully follows the policy and resolves the customer's request.

Rules for the rewrite:
- Keep the customer's goal and any concrete facts they gave (IDs, addresses, \
names) faithful to the original. You may lightly adjust the customer's wording \
for coherence, but never change what they want.
- Fix the AGENT side: add every required verification and list-before-mutate \
call, drop unauthorized or unrelated actions, correct wrong actions, and ask \
"Is there anything else I can help you with?" before closing.
- Make EXACTLY ONE tool call per assistant message, and immediately follow it \
with that tool's result message. Use ONLY tools from the TOOL CATALOG, with \
arguments that exactly fit each tool's schema (e.g. {"path": {...}, "payload": \
{...}}). Do not invent tools or argument shapes.
- Tool result content must be realistic JSON, consistent with the rest of the \
conversation.
- The final assistant message makes no tool call and plainly states what was done.

Respond with ONLY a JSON object of this shape (no prose, no code fences):
{
  "messages": [
    {"role": "user", "content": "..."},
    {"role": "assistant", "content": "", "tool_calls": [{"name": "customers_getById", "arguments": {"path": {"customerId": "cust_1"}}}]},
    {"role": "tool", "name": "customers_getById", "content": "{...realistic JSON...}"},
    {"role": "assistant", "content": "..."}
  ]
}"""


@dataclass
class Correction:
    """A rewritten conversation in OpenAI chat format, plus result provenance."""

    messages: list[dict[str, Any]]
    reused_results: int  # tool results taken verbatim from the real transcript
    synthesized_results: int  # tool results the teacher had to invent


def _canon_args(args: Any) -> str:
    """Order-insensitive key for matching a corrected call to an original one."""

    try:
        return json.dumps(args, sort_keys=True, default=str)
    except (TypeError, ValueError):
        return str(args)


def build_result_index(original_messages: list[dict[str, Any]]) -> dict[tuple[str, str], str]:
    """Map ``(tool_name, canonical_args) -> real_result_text`` from the original.

    First occurrence wins. Errors are indexed too (a corrected path that repeats a
    genuinely failing call should see the same failure).
    """

    index: dict[tuple[str, str], str] = {}
    for call in extract_tool_calls(original_messages):
        if call.get("error"):
            value = str(call["error"])
        elif call.get("output") is not None:
            out = call["output"]
            value = out if isinstance(out, str) else json.dumps(out, default=str)
        else:
            continue
        index.setdefault((call["name"], _canon_args(call.get("input"))), value)
    return index


def _assemble(raw: dict[str, Any], result_index: dict[tuple[str, str], str]) -> Correction:
    """Normalize the teacher's JSON into OpenAI messages, splicing real results.

    Assigns ``tool_call_id``s (the teacher needn't invent them) and pairs each
    ``tool`` message with the immediately preceding assistant tool call.
    """

    messages_in = raw.get("messages")
    if not isinstance(messages_in, list) or not messages_in:
        raise ValueError("teacher output missing a non-empty 'messages' list")

    out: list[dict[str, Any]] = []
    reused = synthesized = 0
    cid_counter = 0
    last_call: dict[str, str] | None = None

    for msg in messages_in:
        if not isinstance(msg, dict):
            continue
        role = msg.get("role")

        if role == "user":
            out.append({"role": "user", "content": str(msg.get("content", ""))})
            last_call = None

        elif role == "assistant":
            content = msg.get("content") or ""
            tool_calls = msg.get("tool_calls") or []
            if tool_calls:
                tc = tool_calls[0] if isinstance(tool_calls[0], dict) else {}
                name = str(tc.get("name", ""))
                args_obj = tc.get("arguments", {})
                if isinstance(args_obj, str):
                    try:
                        args_obj = json.loads(args_obj)
                    except json.JSONDecodeError:
                        pass
                arguments = (
                    args_obj if isinstance(args_obj, str) else json.dumps(args_obj, default=str)
                )
                cid_counter += 1
                cid = f"call_{cid_counter}"
                out.append(
                    {
                        "role": "assistant",
                        "content": content,
                        "tool_calls": [
                            {
                                "id": cid,
                                "type": "function",
                                "function": {"name": name, "arguments": arguments},
                            }
                        ],
                    }
                )
                last_call = {"id": cid, "name": name, "canon": _canon_args(args_obj)}
            else:
                out.append({"role": "assistant", "content": content})
                last_call = None

        elif role == "tool":
            if last_call is None:
                continue  # orphan result with no preceding call; drop it
            content = str(msg.get("content", ""))
            real = result_index.get((last_call["name"], last_call["canon"]))
            if real is not None:
                content = real
                reused += 1
            else:
                synthesized += 1
            out.append(
                {"role": "tool", "tool_call_id": last_call["id"], "content": content}
            )
            last_call = None

    if not any(m["role"] == "assistant" for m in out):
        raise ValueError("corrected conversation has no assistant messages")
    return Correction(messages=out, reused_results=reused, synthesized_results=synthesized)


def build_messages(
    policy: str, transcript_text: str, critique: str, tools_text: str
) -> list[dict[str, str]]:
    sections = [f"AGENT POLICY:\n{policy}"]
    if tools_text:
        sections.append(
            "TOOL CATALOG (use only these tools, with arguments fitting these "
            f"shapes):\n{tools_text}"
        )
    sections += [
        f"FAILED TRANSCRIPT:\n{transcript_text}",
        f"QA CRITIQUE (what went wrong):\n{critique}",
        "Produce the corrected conversation as the JSON object described.",
    ]
    return [
        {"role": "system", "content": _SYSTEM},
        {"role": "user", "content": "\n\n".join(sections)},
    ]


def correct_transcript(
    teacher: LLM,
    judge: LLM,
    *,
    policy: str,
    original_messages: list[dict[str, Any]],
    critique: str,
) -> tuple[Correction, Verdict]:
    """Rewrite one failed transcript and re-judge the result.

    Returns the ``Correction`` (OpenAI-format messages + provenance) and the
    verifier ``Verdict``. The caller keeps the example only if ``verdict.passed``.
    Raises if the teacher produces no parseable/usable conversation.
    """

    transcript_text = render_transcript(original_messages)
    tools_text = catalog_text()

    reply = teacher.complete(
        build_messages(policy, transcript_text, critique, tools_text), max_tokens=2500
    )
    correction = _assemble(extract_json(reply), build_result_index(original_messages))
    verdict = judge_transcript(
        judge, render_openai_transcript(correction.messages), policy, tools_text=tools_text
    )
    return correction, verdict
