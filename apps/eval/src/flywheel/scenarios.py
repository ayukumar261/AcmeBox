"""Scenario authoring: pick a seed fixture, have an LLM invent a persona + goal.

A *fixture* is a hand-authored, always-valid database state (``seeds/*.json``)
covering a particular account situation. The *author* model is shown one fixture
(its data + description) plus the policy, and writes a NEW, realistic customer
persona + goal grounded in that data — including goals the policy should refuse,
for robustness. The result is a ``Task`` (reusing the eval schema) with empty
evaluation criteria — the LLM judge grades it later, there is no deterministic
key.

These scenarios are deliberately distinct from the eval task set: the eval suite
stays held out for the gate, never used as training data.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from .llm import LLM, extract_json
from ..tasks.models import EvaluationCriteria, Task, UserSpec

SEEDS_DIR = Path(__file__).resolve().parent / "seeds"


@dataclass(frozen=True)
class Fixture:
    id: str
    customer_id: str
    description: str
    seed: dict[str, list[dict[str, Any]]]


def load_fixtures() -> list[Fixture]:
    fixtures: list[Fixture] = []
    for path in sorted(SEEDS_DIR.glob("*.json")):
        data = json.loads(path.read_text())
        fixtures.append(
            Fixture(
                id=data["id"],
                customer_id=data.get("customerId", ""),
                description=data.get("description", ""),
                seed=data["seed"],
            )
        )
    if not fixtures:
        raise FileNotFoundError(f"no seed fixtures found in {SEEDS_DIR}")
    return fixtures


_SYSTEM = """You write training scenarios for an AcmeBox customer-support agent. \
Given a snapshot of one customer's account data and the agent's policy, invent ONE \
realistic thing that customer might contact support about, and write the customer's \
persona/instructions for a role-play.

Rules:
- Ground the scenario in the ACTUAL data shown (real ids, addresses, orders, \
subscriptions). Don't invent records that aren't there.
- Vary the request type across calls — address changes, payment methods, \
subscription pause/resume/cancel/plan-change, order reschedule/cancel, refunds, \
meal/plan questions. Include requests the policy must REFUSE (e.g. change-of-mind \
refund, editing a shipped order, reactivating a canceled subscription) some of the \
time — those are valuable training cases too.
- Write the instructions in the second person ("You are <name>..."), like a real \
person: state the goal in plain words, hand over the customer id only when asked, \
and stay in character. Do NOT script the agent's side.

Respond with ONLY a JSON object (no prose, no code fences):
{
  "goal": "<one short line: what the customer wants>",
  "instructions": "<the customer persona + behaviour, second person>"
}"""


def _author_messages(fixture: Fixture, policy: str, nudge: str) -> list[dict[str, str]]:
    user = (
        f"AGENT POLICY:\n{policy}\n\n"
        f"CUSTOMER ACCOUNT SNAPSHOT ({fixture.id}):\n{fixture.description}\n\n"
        f"RAW DATA:\n{json.dumps(fixture.seed, indent=1)}\n\n"
        f"Write scenario #{nudge}. Make it meaningfully different from obvious or "
        "common requests. Produce the JSON object described."
    )
    return [{"role": "system", "content": _SYSTEM}, {"role": "user", "content": user}]


def author_scenario(
    author: LLM, fixture: Fixture, policy: str, *, index: int = 0, max_turns: int = 14
) -> tuple[Task, str]:
    """Have the author model write one scenario grounded in ``fixture``.

    Returns ``(task, goal)`` where ``task`` has empty evaluation criteria (the LLM
    judge grades it later) and is ready for the harness. ``index`` nudges variety
    across calls. Raises if the author returns no usable JSON.
    """

    reply = author.complete(
        _author_messages(fixture, policy, str(index + 1)),
        temperature=0.9,
        max_tokens=900,
    )
    data = extract_json(reply)
    instructions = str(data.get("instructions", "")).strip()
    if not instructions:
        raise ValueError("author returned no 'instructions'")
    goal = str(data.get("goal", "")).strip()

    task = Task(
        id=f"gen_{fixture.id}_{index + 1}",
        seed=fixture.seed,
        user=UserSpec(instructions=instructions),
        evaluation_criteria=EvaluationCriteria(),
        max_turns=max_turns,
    )
    return task, goal
