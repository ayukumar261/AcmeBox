"""Task schema and JSON loader.

A task is a self-contained scenario: the starting database (``seed``), the
persona the simulated user plays (``user``), and how to grade the outcome
(``evaluation_criteria``). Grading is deterministic -- final DB state plus the
required tool calls; there is no LLM judge in this version.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from pydantic import BaseModel, Field

TASKS_DIR = Path(__file__).resolve().parent


class DbCheck(BaseModel):
    """Assert a row's columns after the conversation.

    ``id`` is matched against the table's ``id`` primary key; ``expect`` maps
    snake_case DB column names to their required values.
    """

    table: str
    id: str
    expect: dict[str, Any]


class ActionCheck(BaseModel):
    """Require that a tool was called with (at least) these arguments.

    ``args`` is subset-matched against the captured call, including the nested
    ``path``/``payload`` structure MCP tools use.
    """

    tool: str
    args: dict[str, Any] = Field(default_factory=dict)


class EvaluationCriteria(BaseModel):
    db_check: list[DbCheck] = Field(default_factory=list)
    actions: list[ActionCheck] = Field(default_factory=list)


class UserSpec(BaseModel):
    instructions: str


class Task(BaseModel):
    id: str
    seed: dict[str, list[dict[str, Any]]] = Field(default_factory=dict)
    user: UserSpec
    evaluation_criteria: EvaluationCriteria
    # Optional extra policy text appended to the agent's system prompt.
    policy: str | None = None
    max_turns: int = 12


def load_task(name_or_path: str) -> Task:
    """Load a task by id (``tasks/<id>.json``) or by explicit file path."""

    path = Path(name_or_path)
    if not path.exists():
        path = TASKS_DIR / f"{name_or_path}.json"
    if not path.exists():
        raise FileNotFoundError(f"No task found for {name_or_path!r} (looked in {path})")
    return Task.model_validate(json.loads(path.read_text()))
