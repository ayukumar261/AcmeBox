"""Dataset prep for LoRA SFT: tokenize each conversation and mask the loss to
assistant tokens only.

Pure ``transformers`` (the tokenizer), no ``torch`` — so it can be exercised on
CPU/macOS without the GPU stack. The heavy training imports live in ``sft.py``.

The masking relies on the LFM2.5 chat template's ``{% generation %}`` markers:
``apply_chat_template(..., return_assistant_tokens_mask=True)`` returns a 0/1 mask
that is 1 exactly on the assistant turns. We turn every non-assistant position
into the HF ignore index so the loss is computed on the model's own replies and
tool calls only — never on the policy, the user, or the tool results.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Iterator

# Positions labelled with this are skipped by the cross-entropy loss (HF convention).
LOSS_IGNORE_INDEX = -100


def load_jsonl(path: str | Path) -> Iterator[dict[str, Any]]:
    with Path(path).open(encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if line:
                yield json.loads(line)


def build_features(example: dict[str, Any], tokenizer: Any) -> dict[str, list[int]]:
    """Tokenize one ``{messages, tools}`` record into input_ids / labels.

    No truncation here — the caller filters over-length examples so we never cut a
    conversation mid-answer (which would corrupt the supervision signal).
    """

    enc = tokenizer.apply_chat_template(
        example["messages"],
        tools=example.get("tools"),
        tokenize=True,
        return_dict=True,
        return_assistant_tokens_mask=True,
        add_generation_prompt=False,
    )
    input_ids = list(enc["input_ids"])
    masks = enc.get("assistant_masks")
    if not masks or not any(masks):
        raise ValueError(
            "chat template returned no assistant token mask — assistant-only loss "
            "needs a template with {% generation %} markers (LFM2.5 has them)."
        )
    attention_mask = list(enc.get("attention_mask") or [1] * len(input_ids))
    labels = [tid if m else LOSS_IGNORE_INDEX for tid, m in zip(input_ids, masks)]
    return {"input_ids": input_ids, "attention_mask": attention_mask, "labels": labels}


def count_supervised_tokens(features: dict[str, list[int]]) -> int:
    """How many tokens actually contribute to the loss (assistant tokens)."""

    return sum(1 for label in features["labels"] if label != LOSS_IGNORE_INDEX)
