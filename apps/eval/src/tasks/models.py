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

from pydantic import BaseModel, Field, model_validator

TASKS_DIR = Path(__file__).resolve().parent


class DbCheck(BaseModel):
    """Assert a row's columns after the conversation.

    Locate the row by ``id`` (primary-key shorthand) or ``where`` (match on any
    columns) -- exactly one is required. By default the row must exist and its
    ``expect`` columns must match; set ``absent: true`` instead to assert the row
    does NOT exist (e.g. after a deletion), in which case ``expect`` must be empty.
    An expected value may be a literal, or a ``{"$ref": {table, where, column?}}``
    object that resolves to another row's value. The ``$ref`` form lets a check
    assert a cross-row link whose id isn't known until runtime -- e.g. a
    customer's ``default_address_id`` pointing at a freshly created address.
    """

    table: str
    id: str | None = None
    where: dict[str, Any] | None = None
    expect: dict[str, Any] = Field(default_factory=dict)
    absent: bool = False

    @model_validator(mode="after")
    def _check_shape(self) -> "DbCheck":
        if (self.id is None) == (self.where is None):
            raise ValueError("DbCheck needs exactly one of `id` or `where`")
        if self.where is not None and not self.where:
            raise ValueError("DbCheck `where` must not be empty")
        if self.absent and self.expect:
            raise ValueError("DbCheck `absent` cannot be combined with `expect`")
        return self

    @property
    def match(self) -> dict[str, Any]:
        """The ``{column: value}`` filter that locates the row."""

        return {"id": self.id} if self.id is not None else dict(self.where or {})


class ToolCheck(BaseModel):
    """Require that a tool was called with (at least) these arguments.

    ``args`` is subset-matched against the captured call, including the nested
    ``path``/``payload`` structure MCP tools use.
    """

    tool: str
    args: dict[str, Any] = Field(default_factory=dict)


class EvaluationCriteria(BaseModel):
    db_check: list[DbCheck] = Field(default_factory=list)
    tools: list[ToolCheck] = Field(default_factory=list)


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
