"""Command-line entry point: ``acmebox-eval run <task> --k N``."""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys
from pathlib import Path

from .config import ConfigError, HarnessConfig
from .evaluate import TaskReport, run_task
from .tasks.models import load_task

_ENV_FILE = Path(__file__).resolve().parents[1] / ".env"


def _load_dotenv() -> None:
    """Load ``apps/eval/.env`` if present (simple KEY=VALUE lines).

    Avoids a python-dotenv dependency. Existing environment variables win, so a
    value already exported in the shell is never overridden.
    """

    if not _ENV_FILE.exists():
        return
    for line in _ENV_FILE.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key, value = key.strip(), value.strip().strip('"').strip("'")
        os.environ.setdefault(key, value)


def _print_transcripts(report: TaskReport) -> None:
    for i, convo in enumerate(report.conversations, start=1):
        print(f"\n{'=' * 56}\nRun {i} transcript\n{'=' * 56}")
        for turn in convo.transcript:
            speaker = "CUSTOMER" if turn["role"] == "user" else "AGENT"
            print(f"\n[{speaker}]\n{turn['content']}")
        if convo.tool_calls:
            print("\n[TOOL CALLS]")
            for call in convo.tool_calls:
                status = "error" if call.is_error else "ok"
                print(f"  → {call.name}({json.dumps(call.arguments)})")
                print(f"    ← ({status}) {call.text}")


def _print_report(report: TaskReport) -> None:
    print(f"\nTask: {report.task_id}   (k = {report.k})")
    print("=" * 56)
    for i, run in enumerate(report.runs, start=1):
        verdict = "PASS" if run.passed else "FAIL"
        print(f"\nRun {i}: {verdict}")
        for check in run.checks:
            mark = "✓" if check.passed else "✗"
            print(f"  {mark} {check.name}: {check.detail}")
    print("\n" + "-" * 56)
    print(f"pass rate : {report.pass_count}/{report.k}")
    print(f"pass^{report.k}    : {'PASS' if report.pass_k else 'FAIL'}")


def _cmd_run(args: argparse.Namespace) -> int:
    _load_dotenv()
    task = load_task(args.task)
    cfg = HarnessConfig.from_env()
    try:
        report = asyncio.run(run_task(cfg, task, args.k))
    except ConfigError as exc:
        print(f"Configuration error: {exc}", file=sys.stderr)
        return 2
    if args.transcript:
        _print_transcripts(report)
    _print_report(report)
    return 0 if report.pass_k else 1


def main() -> int:
    parser = argparse.ArgumentParser(prog="acmebox-eval")
    sub = parser.add_subparsers(dest="command", required=True)

    run = sub.add_parser("run", help="Run a task k times and report pass^k.")
    run.add_argument("task", help="Task id (tasks/<id>.json) or a path to a task file.")
    run.add_argument("--k", type=int, default=1, help="Number of trials (default 1).")
    run.add_argument(
        "--transcript",
        action="store_true",
        help="Print the full conversation and tool calls for each run.",
    )
    run.set_defaults(func=_cmd_run)

    args = parser.parse_args()
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
