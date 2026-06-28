"""Scoring: deterministic checks + run-it-k-times orchestration.

Grading is two pure checks (no model calls):

1. ``db_check`` -- the source of truth. Read the ephemeral DB after the
   conversation and confirm the expected columns. Catches agents that *say* they
   did something but didn't, and agents that reached the right state the wrong way
   (e.g. by deleting/recreating instead of updating). A check locates its row by
   ``id`` or by a ``where`` column match, and an expected value may be a literal
   or a ``$ref`` that resolves to another row's value -- so a check can assert a
   link to a row whose id is only known at runtime (e.g. a just-created address).
2. ``tools`` -- confirm the required tool(s) were actually called with the
   expected arguments (subset match, including the nested path/payload shape).

A run passes only if every check passes. ``run_task`` then repeats the whole
pipeline ``k`` times -- each trial fully isolated (its own ephemeral DB and MCP
process) -- and reports **pass^k** (all k trials passed), tau-bench's reliability
metric, which is far stricter than an average success rate.
"""

from __future__ import annotations

import asyncio
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from typing import Any

import psycopg
from psycopg import sql
from psycopg.rows import dict_row

from .config import HarnessConfig, agent_model, user_model
from .conversation import LLM, Conversation, run_conversation
from .harness import create_db, drop_db, migrate, seed
from .mcp import ToolResult, mcp_session
from .tasks.models import DbCheck, EvaluationCriteria, Task, ToolCheck

# --- Deterministic checks ----------------------------------------------------


@dataclass
class CheckResult:
    name: str
    passed: bool
    detail: str


@dataclass
class RunResult:
    checks: list[CheckResult] = field(default_factory=list)

    @property
    def passed(self) -> bool:
        return bool(self.checks) and all(c.passed for c in self.checks)


def _is_subset(expected: Any, actual: Any) -> bool:
    """True if ``expected`` is contained in ``actual`` (recursively for dicts)."""

    if isinstance(expected, dict):
        if not isinstance(actual, dict):
            return False
        return all(
            k in actual and _is_subset(v, actual[k]) for k, v in expected.items()
        )
    return expected == actual


_REF = "$ref"


def _match_clause(match: dict[str, Any]) -> tuple[sql.Composed, list[Any]]:
    """An AND-equality WHERE clause from a ``{column: value}`` filter.

    Columns are quoted as identifiers and values are bound as parameters (same
    safe-composition pattern as ``harness._insert_row``).
    """

    cols = list(match)
    clause = sql.SQL(" AND ").join(
        sql.SQL("{} = {}").format(sql.Identifier(c), sql.Placeholder()) for c in cols
    )
    return clause, [match[c] for c in cols]


def _fetch_one(
    conn: psycopg.Connection, table: str, match: dict[str, Any]
) -> tuple[dict | None, str]:
    """Fetch the single row matching ``match``; zero/ambiguous matches are errors."""

    clause, params = _match_clause(match)
    rows = conn.execute(
        sql.SQL("SELECT * FROM {} WHERE {}").format(sql.Identifier(table), clause),
        params,
    ).fetchall()
    if not rows:
        return None, f"no row matching {match!r}"
    if len(rows) > 1:
        return None, f"ambiguous match ({len(rows)} rows) for {match!r}"
    return rows[0], "ok"


def _row_exists(conn: psycopg.Connection, table: str, match: dict[str, Any]) -> bool:
    """True if any row matches ``match`` -- the basis of an ``absent`` assertion."""

    clause, params = _match_clause(match)
    found = conn.execute(
        sql.SQL("SELECT 1 FROM {} WHERE {} LIMIT 1").format(
            sql.Identifier(table), clause
        ),
        params,
    ).fetchone()
    return found is not None


def _resolve(conn: psycopg.Connection, value: Any) -> tuple[Any, str | None]:
    """A literal resolves to itself; a ``{"$ref": ...}`` to a referenced column.

    Returns ``(resolved_value, None)`` on success or ``(None, error_detail)`` if
    a ``$ref`` row couldn't be uniquely located.
    """

    if isinstance(value, dict) and set(value) == {_REF}:
        spec = value[_REF]
        row, detail = _fetch_one(conn, spec["table"], spec["where"])
        if row is None:
            return None, f"$ref {spec['table']}: {detail}"
        return row.get(spec.get("column", "id")), None
    return value, None


def check_db(db_url: str, checks: list[DbCheck]) -> list[CheckResult]:
    results: list[CheckResult] = []
    with psycopg.connect(db_url, row_factory=dict_row) as conn:
        for check in checks:
            label = check.id if check.id is not None else check.where
            name = f"db:{check.table}:{label}"

            if check.absent:
                exists = _row_exists(conn, check.table, check.match)
                results.append(
                    CheckResult(
                        name=name,
                        passed=not exists,
                        detail="absent"
                        if not exists
                        else f"row {check.match!r} still present",
                    )
                )
                continue

            row, detail = _fetch_one(conn, check.table, check.match)
            if row is None:
                results.append(CheckResult(name=name, passed=False, detail=detail))
                continue

            mismatches: list[str] = []
            for col, exp in check.expect.items():
                expected, ref_err = _resolve(conn, exp)
                if ref_err:
                    mismatches.append(f"{col}: {ref_err}")
                elif row.get(col) != expected:
                    mismatches.append(
                        f"{col}: expected {expected!r}, got {row.get(col)!r}"
                    )

            results.append(
                CheckResult(
                    name=name,
                    passed=not mismatches,
                    detail="ok" if not mismatches else "; ".join(mismatches),
                )
            )
    return results


def check_tools(
    captured: list[ToolResult], tools: list[ToolCheck]
) -> list[CheckResult]:
    results: list[CheckResult] = []
    for check in tools:
        match = any(
            call.name == check.tool and _is_subset(check.args, call.arguments)
            for call in captured
        )
        results.append(
            CheckResult(
                name=f"tool:{check.tool}",
                passed=match,
                detail=(
                    "called with expected args"
                    if match
                    else f"no matching call (args {check.args!r})"
                ),
            )
        )
    return results


def grade(
    db_url: str,
    captured: list[ToolResult],
    criteria: EvaluationCriteria,
) -> RunResult:
    result = RunResult()
    result.checks.extend(check_db(db_url, criteria.db_check))
    result.checks.extend(check_tools(captured, criteria.tools))
    return result


# --- Orchestration (pass^k) --------------------------------------------------


@dataclass
class TaskReport:
    task_id: str
    k: int
    runs: list[RunResult] = field(default_factory=list)
    conversations: list[Conversation] = field(default_factory=list)

    @property
    def pass_count(self) -> int:
        return sum(1 for r in self.runs if r.passed)

    @property
    def pass_k(self) -> bool:
        """True only if every one of the k runs passed."""

        return len(self.runs) == self.k and all(r.passed for r in self.runs)


def _provision_db(cfg: HarnessConfig, seed_data: Any) -> tuple[str, str]:
    """Create + migrate + seed a fresh DB; on failure drop it and re-raise.

    The blocking half of ``run_once`` (a ``pnpm db:migrate`` subprocess plus
    psycopg work) lives here so it can be pushed off the event loop with
    ``asyncio.to_thread`` -- otherwise every concurrent trial would serialize its
    migration on the loop and defeat the point of ``--concurrency``.
    """

    name, url = create_db(cfg)
    try:
        migrate(cfg, url)
        seed(url, seed_data)
    except BaseException:
        drop_db(cfg, name)
        raise
    return name, url


async def run_once(
    cfg: HarnessConfig, task: Task, agent: LLM, user: LLM
) -> tuple[RunResult, Conversation]:
    """One full trial: fresh DB + MCP, run the conversation, grade the end state."""

    # Provision/grade/teardown are synchronous (subprocess + psycopg); run them in
    # threads so concurrent trials overlap instead of blocking the event loop.
    name, db_url = await asyncio.to_thread(_provision_db, cfg, task.seed)
    try:
        async with mcp_session(cfg, db_url) as mcp:
            convo = await run_conversation(task, mcp, agent, user)
        # Grade after the MCP process has shut down, while the DB still exists.
        result = await asyncio.to_thread(
            grade, db_url, convo.tool_calls, task.evaluation_criteria
        )
    finally:
        await asyncio.to_thread(drop_db, cfg, name)
    return result, convo


def _errored_run(exc: BaseException) -> RunResult:
    """A synthetic failed run so one trial's crash doesn't sink the whole batch."""

    return RunResult(
        checks=[CheckResult(name="run", passed=False, detail=f"run errored: {exc}")]
    )


async def run_task(
    cfg: HarnessConfig, task: Task, k: int, concurrency: int = 1
) -> TaskReport:
    agent = LLM(agent_model())
    user = LLM(user_model())

    # Each concurrent trial drives blocking calls via ``asyncio.to_thread``; size
    # the default executor so those don't queue behind the stock min(32, cpu+4).
    loop = asyncio.get_running_loop()
    loop.set_default_executor(ThreadPoolExecutor(max_workers=concurrency + 4))

    sem = asyncio.Semaphore(concurrency)

    async def trial() -> tuple[RunResult, Conversation]:
        async with sem:
            return await run_once(cfg, task, agent, user)

    # gather preserves input order, so the report stays deterministic even though
    # runs finish out of order; return_exceptions keeps one failure from aborting
    # the rest.
    outcomes = await asyncio.gather(
        *(trial() for _ in range(k)), return_exceptions=True
    )

    report = TaskReport(task_id=task.id, k=k)
    for outcome in outcomes:
        if isinstance(outcome, BaseException):
            report.runs.append(_errored_run(outcome))
            report.conversations.append(Conversation())
        else:
            result, convo = outcome
            report.runs.append(result)
            report.conversations.append(convo)
    return report
