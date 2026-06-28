"""Phase 5: the eval gate — promote a trained adapter only if it doesn't regress.

After Phase 4 trains a LoRA adapter, vLLM serves it alongside the base
(``--enable-lora --lora-modules <adapter>=<path>``). The gate runs the FULL task
suite twice against that one endpoint — once with ``AGENT_MODEL`` = the base id
(baseline), once = the adapter name (candidate) — and compares ``pass^k`` per task.

Promotion policy: **promote iff no task regressed** (no task that passed on the
baseline now fails). Because a no-regression run can only hold or raise the total
pass count, that single rule already guarantees the candidate is at least as good
overall; ``require_improvement`` additionally demands at least one fail→pass flip.

The suite run needs the full eval infra (Postgres + MCP + a live vLLM), so it is
driven from the worker's ``gate`` command. The comparison logic here
(``decide``) is pure and unit-tested.
"""

from __future__ import annotations

import asyncio
import os
from dataclasses import dataclass, field
from typing import Any

from ..config import HarnessConfig
from ..evaluate import run_task
from ..tasks.models import TASKS_DIR, Task, load_task


def discover_tasks(only: list[str] | None = None) -> list[Task]:
    """Load every task in ``src/tasks/*.json`` (or just ``only`` by id)."""

    if only:
        return [load_task(name) for name in only]
    return [load_task(path) for path in sorted(TASKS_DIR.glob("*.json"))]


@dataclass
class SuiteResult:
    """One model's ``pass^k`` across the whole suite."""

    model: str
    k: int
    per_task: dict[str, bool] = field(default_factory=dict)  # task_id -> pass^k

    @property
    def pass_count(self) -> int:
        return sum(1 for ok in self.per_task.values() if ok)

    @property
    def total(self) -> int:
        return len(self.per_task)

    def to_dict(self) -> dict[str, Any]:
        return {"model": self.model, "k": self.k, "perTask": self.per_task}

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "SuiteResult":
        return cls(model=data["model"], k=data["k"], per_task=dict(data["perTask"]))


@dataclass
class GateDecision:
    promote: bool
    reason: str
    regressions: list[str] = field(default_factory=list)
    improvements: list[str] = field(default_factory=list)
    baseline_pass: int = 0
    candidate_pass: int = 0
    total: int = 0

    def to_dict(self) -> dict[str, Any]:
        return {
            "promote": self.promote,
            "reason": self.reason,
            "regressions": self.regressions,
            "improvements": self.improvements,
            "baselinePass": self.baseline_pass,
            "candidatePass": self.candidate_pass,
            "total": self.total,
        }


def decide(
    baseline: SuiteResult, candidate: SuiteResult, *, require_improvement: bool = False
) -> GateDecision:
    """Compare two suite runs and decide whether to promote the candidate."""

    tasks = sorted(set(baseline.per_task) | set(candidate.per_task))
    regressions, improvements = [], []
    for task_id in tasks:
        was = baseline.per_task.get(task_id, False)
        now = candidate.per_task.get(task_id, False)
        if was and not now:
            regressions.append(task_id)
        elif now and not was:
            improvements.append(task_id)

    promote = not regressions
    if require_improvement:
        promote = promote and bool(improvements)

    if regressions:
        reason = f"{len(regressions)} task(s) regressed: {', '.join(regressions)}"
    elif require_improvement and not improvements:
        reason = "no regressions, but no improvement either (require_improvement set)"
    else:
        reason = (
            f"no regressions; {len(improvements)} improvement(s) "
            f"({baseline.pass_count}→{candidate.pass_count} of {len(tasks)} tasks)"
        )

    return GateDecision(
        promote=promote,
        reason=reason,
        regressions=regressions,
        improvements=improvements,
        baseline_pass=baseline.pass_count,
        candidate_pass=candidate.pass_count,
        total=len(tasks),
    )


def run_suite(
    cfg: HarnessConfig,
    tasks: list[Task],
    *,
    model: str,
    k: int,
    concurrency: int = 1,
    base_url: str | None = None,
    on_task: Any = None,
) -> SuiteResult:
    """Run the whole suite against ``model`` and return per-task ``pass^k``.

    Switches the agent under test by setting ``AGENT_MODEL`` (and optionally
    ``AGENT_BASE_URL``) before each task — ``run_task`` reads them via
    ``agent_model()``. The user-simulator config is left untouched.
    """

    os.environ["AGENT_MODEL"] = model
    if base_url:
        os.environ["AGENT_BASE_URL"] = base_url

    result = SuiteResult(model=model, k=k)
    for task in tasks:
        report = asyncio.run(run_task(cfg, task, k, concurrency))
        result.per_task[task.id] = report.pass_k
        if on_task:
            on_task(task.id, report.pass_k, report.pass_count)
    return result
