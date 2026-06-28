"""LLM judge: did the agent handle this conversation correctly?

Unlike the eval harness — which grades against a seeded database and a known
required tool sequence — a production transcript has no ground truth. So the
judge reasons purely from observable behavior against the canonical
``policy.md``: did the agent accomplish what the customer asked, and did it follow
the rules (identity verification, list-before-mutate, refund limits, state
machines, the closing question, no unrelated changes)?

The verdict is structured so Phase 2 (teacher rewrite) can act on it: the
``critique`` and ``policy_violations`` tell the teacher exactly what to fix.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from .config import JUDGE_VERSION
from .llm import LLM, extract_json
from .tools import catalog_text

_SYSTEM = """You are a strict but fair QA reviewer for AcmeBox, a meal-kit \
subscription company. You audit transcripts of an AI support agent talking to a \
customer and decide whether the agent did its job correctly.

You are given the agent's POLICY (its rulebook) and a TRANSCRIPT that includes \
every message and every tool call the agent made, with the real arguments and \
real results. Judge ONLY what you can observe in the transcript. The tool results \
shown are real, so you can trust them as the system's actual state.

Evaluate two things:
1. TASK COMPLETION — did the agent accomplish what the customer actually asked \
for (no more, no less)? A correct refusal of a request the policy forbids counts \
as completed.
2. POLICY COMPLIANCE — did the agent follow every applicable rule? Common ones: \
verify identity with customers_getById before account actions; list before \
mutating (addresses_list / paymentMethods_list / subscriptions_list / \
orders_list); never exceed 3 lifetime refunds; respect subscription and order \
state machines; never make unrelated changes; ask "is there anything else?" \
before closing.

You are also given the TOOL CATALOG: the exact tools the agent could call, with \
their argument schemas. Use it to check tool usage — a call to a tool that isn't \
in the catalog, or with arguments that don't fit its schema, would fail in \
reality and is a blocker.

Classify each violation's severity:
- "blocker": the agent did the wrong thing — took an unauthorized action, skipped \
a required verification before a mutation, broke a state-machine rule, exceeded a \
limit, called a nonexistent tool or one with malformed arguments, or failed to \
accomplish the request.
- "minor": a soft lapse that did not change the outcome (e.g. forgot the closing \
question, slightly clumsy wording).

A transcript PASSES only if the task was completed AND there are no blocker \
violations.

Respond with ONLY a JSON object (no prose, no code fences) of exactly this shape:
{
  "request_summary": "<one sentence: what the customer wanted>",
  "task_completed": <true|false>,
  "policy_violations": [
    {"rule": "<short rule id>", "severity": "blocker"|"minor", "evidence": "<what in the transcript shows this>"}
  ],
  "passed": <true|false>,
  "critique": "<2-4 sentences: what went wrong (or right) and what the correct handling was>",
  "confidence": <number 0.0-1.0>
}"""


@dataclass
class Verdict:
    """A structured judgement of one transcript."""

    passed: bool
    task_completed: bool
    request_summary: str
    critique: str
    confidence: float
    policy_violations: list[dict[str, Any]] = field(default_factory=list)
    raw: dict[str, Any] = field(default_factory=dict)

    @property
    def blockers(self) -> list[dict[str, Any]]:
        return [v for v in self.policy_violations if v.get("severity") == "blocker"]

    def to_doc(self, model: str) -> dict[str, Any]:
        """Shape stored under ``conversations.judge`` (timestamp added by caller)."""

        return {
            "version": JUDGE_VERSION,
            "model": model,
            "passed": self.passed,
            "taskCompleted": self.task_completed,
            "requestSummary": self.request_summary,
            "critique": self.critique,
            "confidence": self.confidence,
            "policyViolations": self.policy_violations,
        }


def build_messages(
    transcript_text: str, policy: str, tools_text: str = ""
) -> list[dict[str, str]]:
    sections = [f"AGENT POLICY:\n{policy}"]
    if tools_text:
        sections.append(
            "TOOL CATALOG (the only tools the agent could call; arguments must fit "
            f"these shapes):\n{tools_text}"
        )
    sections.append(f"TRANSCRIPT:\n{transcript_text}")
    sections.append("Return your verdict as the JSON object described in the system prompt.")
    return [
        {"role": "system", "content": _SYSTEM},
        {"role": "user", "content": "\n\n".join(sections)},
    ]


def _coerce_violations(raw: Any) -> list[dict[str, Any]]:
    if not isinstance(raw, list):
        return []
    out: list[dict[str, Any]] = []
    for item in raw:
        if isinstance(item, dict):
            severity = item.get("severity")
            out.append(
                {
                    "rule": str(item.get("rule", "unspecified")),
                    "severity": severity if severity in ("blocker", "minor") else "minor",
                    "evidence": str(item.get("evidence", "")),
                }
            )
    return out


def judge_transcript(
    llm: LLM,
    transcript_text: str,
    policy: str,
    *,
    tools_text: str | None = None,
    attempts: int = 2,
) -> Verdict:
    """Run the judge and return a structured ``Verdict``.

    ``passed`` is recomputed in code (task completed AND no blockers) rather than
    trusting the model's self-reported field — the structured signals are the
    source of truth, the model's ``passed`` is just advisory.

    Robustness: a model can return an empty or non-JSON reply (e.g. a reasoning
    model that burns its whole budget thinking). We retry once with a terse "emit
    only JSON" nudge before giving up, so a single bad generation doesn't drop the
    transcript. A generous ``max_tokens`` leaves room for reasoning models.
    """

    if tools_text is None:
        tools_text = catalog_text()
    messages = build_messages(transcript_text, policy, tools_text)
    data: dict[str, Any] = {}
    last_error: Exception | None = None
    for _ in range(max(1, attempts)):
        reply = llm.complete(messages, max_tokens=2048)
        try:
            data = extract_json(reply)
            break
        except ValueError as exc:
            last_error = exc
            messages = messages + [
                {"role": "assistant", "content": reply or ""},
                {
                    "role": "user",
                    "content": "Respond now with ONLY the JSON verdict object — no reasoning, no prose, no code fences.",
                },
            ]
    else:
        raise ValueError(f"judge returned no parseable JSON: {last_error}")

    violations = _coerce_violations(data.get("policy_violations"))
    task_completed = bool(data.get("task_completed"))
    has_blocker = any(v["severity"] == "blocker" for v in violations)
    passed = task_completed and not has_blocker

    confidence = data.get("confidence")
    try:
        confidence = float(confidence)
    except (TypeError, ValueError):
        confidence = 0.0

    return Verdict(
        passed=passed,
        task_completed=task_completed,
        request_summary=str(data.get("request_summary", "")),
        critique=str(data.get("critique", "")),
        confidence=max(0.0, min(1.0, confidence)),
        policy_violations=violations,
        raw=data,
    )
