"""Phase 3: export minted gold examples to trainer-ready JSONL.

Each line is one conversation in the conversational SFT format::

    {"messages": [system, user, assistant(tool_calls), tool, ...], "tools": [...]}

We deliberately do NOT hand-render LFM2.5's chat/tool-call template here. The
trainer applies the model's OWN tokenizer chat template at train time — that is
the only way to guarantee the rendered tool-call syntax byte-matches what vLLM
serves (and what the ``lfm2`` tool-call parser expects). Assistant-only loss
masking is likewise the trainer's job, enabled by the template's generation
markers; ``render_with_template`` verifies the real tokenizer supports it.

The exported system prompt reproduces the serving prompt (agent preamble +
``policy.md``), so the training context matches inference.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Iterable

from .config import read_policy
from .tools import load_catalog

_EVAL_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_OUT = _EVAL_ROOT / "data" / "sft.jsonl"
DEFAULT_TOKENIZER = "LiquidAI/LFM2.5-8B-A1B"

# Verbatim copy of the serving preamble (apps/web/lib/ai/system-prompt.ts /
# apps/eval/src/conversation.py `_AGENT_SYSTEM`). The full system prompt is this
# plus the canonical policy, so training context == inference context.
_AGENT_SYSTEM = (
    "You are a customer-support agent for AcmeBox, a meal-kit subscription "
    "company. You are chatting with a customer. Use the provided tools to look "
    "up information and make changes on their behalf. Only take the actions the "
    "customer actually asked for -- do not make unrelated changes. When the "
    "request is fully handled, tell the customer plainly what you did."
)


def build_system_prompt(policy: str | None = None) -> str:
    return f"{_AGENT_SYSTEM}\n\nPolicy:\n{policy if policy is not None else read_policy()}"


def _normalize_tool_call(tc: dict[str, Any]) -> dict[str, Any]:
    """Convert an OpenAI tool call to the shape the LFM2.5 chat template wants.

    Critically, ``function.arguments`` must be an OBJECT, not a JSON string: the
    LFM2.5 Jinja template iterates the arguments (``.items()``), so a string makes
    it throw. The corrector/Mongo store arguments as a JSON string (OpenAI wire
    format), so we parse it back to a dict here.
    """

    fn = tc.get("function", {}) if isinstance(tc, dict) else {}
    args = fn.get("arguments", {})
    if isinstance(args, str):
        try:
            args = json.loads(args)
        except json.JSONDecodeError:
            args = {}
    if not isinstance(args, dict):
        args = {}
    return {
        "id": tc.get("id", ""),
        "type": "function",
        "function": {"name": fn.get("name", ""), "arguments": args},
    }


def _normalize_message(msg: dict[str, Any]) -> dict[str, Any]:
    """Keep only the fields a trainer's chat template needs, by role."""

    role = msg.get("role")
    if role == "tool":
        return {
            "role": "tool",
            "tool_call_id": msg.get("tool_call_id", ""),
            "content": str(msg.get("content", "")),
        }
    if role == "assistant":
        out: dict[str, Any] = {"role": "assistant", "content": msg.get("content") or ""}
        if msg.get("tool_calls"):
            out["tool_calls"] = [_normalize_tool_call(tc) for tc in msg["tool_calls"]]
        return out
    # user / system / anything else
    return {"role": str(role), "content": str(msg.get("content", ""))}


def default_template_tools() -> list[dict[str, Any]]:
    """The catalog as bare function dicts (``{name, description, parameters}``).

    The LFM2.5 template renders ``tools`` as a plain list of function schemas, not
    OpenAI ``{"type": "function", "function": ...}`` envelopes — so unwrap them.
    """

    return [t.get("function", t) for t in load_catalog()]


def is_trainable(messages: list[dict[str, Any]]) -> bool:
    """A usable example needs a customer turn and at least one assistant target."""

    has_user = any(m.get("role") == "user" for m in messages)
    has_assistant = any(m.get("role") == "assistant" for m in messages)
    return has_user and has_assistant


def example_to_record(
    doc: dict[str, Any], system_prompt: str, tools: list[dict[str, Any]]
) -> dict[str, Any] | None:
    """Turn a ``training_examples`` doc into one JSONL record, or None if unusable."""

    convo = [_normalize_message(m) for m in (doc.get("messages") or []) if isinstance(m, dict)]
    if not is_trainable(convo):
        return None
    record: dict[str, Any] = {"messages": [{"role": "system", "content": system_prompt}, *convo]}
    if tools:
        record["tools"] = tools
    return record


@dataclass
class ExportStats:
    written: int = 0
    skipped: int = 0
    assistant_turns: int = 0
    tool_calls: int = 0
    max_chars: int = 0
    total_chars: int = 0
    sources: list[str] = field(default_factory=list)

    @property
    def approx_max_tokens(self) -> int:
        # Rough char/4 heuristic; the real count comes from render_with_template.
        return self.max_chars // 4


def export_dataset(
    docs: Iterable[dict[str, Any]],
    out_path: Path,
    *,
    system_prompt: str | None = None,
    tools: list[dict[str, Any]] | None = None,
) -> ExportStats:
    """Write one JSONL record per usable doc. Returns aggregate stats."""

    system_prompt = system_prompt if system_prompt is not None else build_system_prompt()
    tools = default_template_tools() if tools is None else tools

    out_path.parent.mkdir(parents=True, exist_ok=True)
    stats = ExportStats()
    with out_path.open("w", encoding="utf-8") as fh:
        for doc in docs:
            record = example_to_record(doc, system_prompt, tools)
            if record is None:
                stats.skipped += 1
                continue
            line = json.dumps(record, ensure_ascii=False)
            fh.write(line + "\n")
            stats.written += 1
            stats.assistant_turns += sum(
                1 for m in record["messages"] if m["role"] == "assistant"
            )
            stats.tool_calls += sum(
                len(m.get("tool_calls", [])) for m in record["messages"]
            )
            stats.max_chars = max(stats.max_chars, len(line))
            stats.total_chars += len(line)
            sid = doc.get("sourceConversationId")
            if sid:
                stats.sources.append(sid)
    return stats


def write_stats_sidecar(out_path: Path, stats: ExportStats, tokenizer: str) -> Path:
    """Write ``<out>.meta.json`` describing the dataset (provenance + sizing)."""

    meta = {
        "examples": stats.written,
        "skipped": stats.skipped,
        "assistantTurns": stats.assistant_turns,
        "toolCalls": stats.tool_calls,
        "approxMaxTokens": stats.approx_max_tokens,
        "approxAvgChars": (stats.total_chars // stats.written) if stats.written else 0,
        "tokenizer": tokenizer,
        "sourceConversationIds": stats.sources,
    }
    meta_path = out_path.with_suffix(out_path.suffix + ".meta.json")
    meta_path.write_text(json.dumps(meta, indent=2) + "\n")
    return meta_path


def render_with_template(
    record: dict[str, Any], model: str = DEFAULT_TOKENIZER
) -> tuple[str, bool, int | None, int | None]:
    """Apply the REAL LFM2.5 chat template to one record (needs ``transformers``).

    Returns ``(rendered_text, assistant_mask_supported, assistant_tokens,
    total_tokens)``. ``assistant_mask_supported`` tells Phase 4 whether the
    template exposes generation markers so the trainer can do assistant-only loss
    automatically (TRL ``assistant_only_loss``) — if False, Phase 4 needs a custom
    collator. Raises ``ImportError`` if transformers is missing.
    """

    from transformers import AutoTokenizer  # lazy: not a core dependency

    tok = AutoTokenizer.from_pretrained(model)
    messages = record["messages"]
    tools = record.get("tools")

    text = tok.apply_chat_template(
        messages, tools=tools, tokenize=False, add_generation_prompt=False
    )

    mask_supported = False
    assistant_tokens: int | None = None
    total_tokens: int | None = None
    try:
        out = tok.apply_chat_template(
            messages,
            tools=tools,
            tokenize=True,
            return_dict=True,
            return_assistant_tokens_mask=True,
        )
        mask = out.get("assistant_masks")
        if mask:
            mask_supported = True
            assistant_tokens = int(sum(mask))
            total_tokens = len(mask)
    except (ValueError, KeyError, TypeError):
        # Template lacks {% generation %} markers — mask unsupported, not fatal.
        pass

    return text, mask_supported, assistant_tokens, total_tokens
