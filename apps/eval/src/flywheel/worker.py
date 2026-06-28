"""The judge worker: poll MongoDB for un-judged transcripts and grade them.

Polling (rather than Mongo change streams) is deliberate — the local
docker-compose Mongo is a standalone server, and change streams require a replica
set. Polling also backfills transcripts that were written before the worker
existed, and is trivially restartable: a transcript is "done" once it carries a
``judge`` subdoc at the current ``JUDGE_VERSION``.

Commands::

    acmebox-flywheel judge            # one pass over everything un-judged, then exit
    acmebox-flywheel judge --loop     # keep polling (use --interval to tune)
    acmebox-flywheel judge --dry-run  # judge + print, but write nothing
    acmebox-flywheel judge --rejudge  # re-grade everything (e.g. after a rubric change)
    acmebox-flywheel render           # just print the rendered transcripts (no LLM)
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable

from .config import (
    JUDGE_VERSION,
    ConfigError,
    MongoConfig,
    judge_model,
    load_env,
    read_policy,
    teacher_model,
)
from .corrector import Correction, correct_transcript
from .export import (
    DEFAULT_OUT,
    DEFAULT_TOKENIZER,
    build_system_prompt,
    export_dataset,
    render_with_template,
    write_stats_sidecar,
)
from .judge import Verdict, judge_transcript
from .llm import LLM
from .mongo import Store
from .transcript import has_user_text, render_transcript


def _unjudged_filter() -> dict[str, Any]:
    """Docs never judged, or judged by an older rubric version."""

    return {
        "$or": [
            {"judged": {"$ne": True}},
            {"judge.version": {"$exists": False}},
            {"judge.version": {"$lt": JUDGE_VERSION}},
        ]
    }


def _select(store: Store, *, rejudge: bool, conversation_id: str | None, limit: int | None) -> Iterable[dict[str, Any]]:
    if conversation_id:
        query: dict[str, Any] = {"conversationId": conversation_id}
    elif rejudge:
        query = {}
    else:
        query = _unjudged_filter()
    cursor = store.conversations.find(query).sort("createdAt", 1)
    if limit:
        cursor = cursor.limit(limit)
    return cursor


def _write_verdict(store: Store, doc: dict[str, Any], verdict: Verdict, model: str) -> None:
    judge_doc = verdict.to_doc(model)
    judge_doc["judgedAt"] = datetime.now(timezone.utc)
    store.conversations.update_one(
        {"_id": doc["_id"]},
        {"$set": {"judged": True, "judge": judge_doc}},
    )


def _print_verdict(conversation_id: str, verdict: Verdict) -> None:
    status = "PASS" if verdict.passed else "FAIL"
    print(f"\n[{status}] {conversation_id}  (confidence {verdict.confidence:.2f})")
    print(f"  request: {verdict.request_summary}")
    if verdict.policy_violations:
        for v in verdict.policy_violations:
            mark = "✗" if v["severity"] == "blocker" else "·"
            print(f"  {mark} {v['severity']}: {v['rule']} — {v['evidence']}")
    print(f"  critique: {verdict.critique}")


def _judge_pass(
    store: Store,
    llm: LLM,
    policy: str,
    model: str,
    *,
    rejudge: bool,
    conversation_id: str | None,
    limit: int | None,
    dry_run: bool,
) -> int:
    """Judge every selected transcript once. Returns the number judged."""

    judged = 0
    for doc in _select(store, rejudge=rejudge, conversation_id=conversation_id, limit=limit):
        cid = doc.get("conversationId", str(doc.get("_id")))
        messages = doc.get("messages") or []
        if not has_user_text(messages):
            print(f"[skip] {cid}: no customer text")
            continue

        transcript_text = render_transcript(messages)
        try:
            verdict = judge_transcript(llm, transcript_text, policy)
        except Exception as exc:  # noqa: BLE001 — one bad transcript shouldn't kill the loop
            print(f"[error] {cid}: judge failed: {exc}", file=sys.stderr)
            continue

        _print_verdict(cid, verdict)
        if not dry_run:
            _write_verdict(store, doc, verdict, model)
        judged += 1
    return judged


def _render_pass(store: Store, *, conversation_id: str | None, limit: int | None) -> int:
    shown = 0
    for doc in _select(store, rejudge=True, conversation_id=conversation_id, limit=limit):
        cid = doc.get("conversationId", str(doc.get("_id")))
        print(f"\n{'=' * 60}\n{cid}\n{'=' * 60}")
        print(render_transcript(doc.get("messages") or []))
        shown += 1
    return shown


def _cmd_judge(args: argparse.Namespace) -> int:
    load_env()
    try:
        cfg = judge_model()
    except ConfigError as exc:
        print(f"Configuration error: {exc}", file=sys.stderr)
        return 2

    store = Store(MongoConfig.from_env())
    try:
        store.ping()
    except Exception as exc:  # noqa: BLE001
        print(f"Could not reach MongoDB: {exc}", file=sys.stderr)
        return 2
    store.ensure_indexes()

    llm = LLM(cfg)
    policy = read_policy()

    if not args.loop:
        n = _judge_pass(
            store, llm, policy, cfg.model,
            rejudge=args.rejudge, conversation_id=args.conversation,
            limit=args.limit, dry_run=args.dry_run,
        )
        print(f"\nJudged {n} transcript(s).")
        store.close()
        return 0

    print(f"Polling every {args.interval}s (Ctrl-C to stop)…")
    try:
        while True:
            n = _judge_pass(
                store, llm, policy, cfg.model,
                rejudge=False, conversation_id=None,
                limit=args.limit, dry_run=args.dry_run,
            )
            if n:
                print(f"… judged {n}, sleeping {args.interval}s")
            time.sleep(args.interval)
    except KeyboardInterrupt:
        print("\nStopped.")
    finally:
        store.close()
    return 0


def _cmd_render(args: argparse.Namespace) -> int:
    load_env()
    store = Store(MongoConfig.from_env())
    try:
        store.ping()
    except Exception as exc:  # noqa: BLE001
        print(f"Could not reach MongoDB: {exc}", file=sys.stderr)
        return 2
    n = _render_pass(store, conversation_id=args.conversation, limit=args.limit)
    print(f"\nRendered {n} transcript(s).")
    store.close()
    return 0


def _training_doc(
    doc: dict[str, Any], correction: Correction, verdict: Verdict, teacher_name: str
) -> dict[str, Any]:
    judge = doc.get("judge", {})
    return {
        "sourceConversationId": doc.get("conversationId"),
        "customerId": doc.get("customerId"),
        "teacherModel": teacher_name,
        "judgeCritique": judge.get("critique"),
        "requestSummary": judge.get("requestSummary"),
        "messages": correction.messages,
        "toolCallCount": sum(1 for m in correction.messages if m.get("tool_calls")),
        "reusedResults": correction.reused_results,
        "synthesizedResults": correction.synthesized_results,
        "verified": verdict.passed,
        "verifierVersion": JUDGE_VERSION,
        "createdAt": datetime.now(timezone.utc),
    }


def _correct_pass(
    store: Store,
    teacher: LLM,
    judge: LLM,
    policy: str,
    teacher_name: str,
    *,
    retry: bool,
    conversation_id: str | None,
    limit: int | None,
    dry_run: bool,
) -> int:
    """Rewrite failed transcripts into verified gold examples. Returns minted count."""

    query: dict[str, Any] = {"judge.passed": False}
    if conversation_id:
        query["conversationId"] = conversation_id
    elif retry:
        query["correctionStatus"] = {"$ne": "minted"}
    else:
        query["correctionStatus"] = {"$exists": False}

    minted = 0
    for doc in store.conversations.find(query).sort("createdAt", 1).limit(limit or 0):
        cid = doc.get("conversationId", str(doc.get("_id")))
        critique = doc.get("judge", {}).get("critique", "")
        try:
            correction, verdict = correct_transcript(
                teacher, judge,
                policy=policy,
                original_messages=doc.get("messages") or [],
                critique=critique,
            )
        except Exception as exc:  # noqa: BLE001 — a bad rewrite shouldn't kill the loop
            print(f"[error] {cid}: correction failed: {exc}", file=sys.stderr)
            if not dry_run:
                store.conversations.update_one(
                    {"_id": doc["_id"]},
                    {"$set": {"correctionStatus": "error", "correctedAt": datetime.now(timezone.utc)}},
                )
            continue

        status = "minted" if verdict.passed else "rejected"
        print(
            f"[{status}] {cid}  (verified={verdict.passed}, "
            f"reused={correction.reused_results}, synth={correction.synthesized_results})"
        )
        if not verdict.passed:
            print(f"  verifier still fails: {verdict.critique}")

        if not dry_run:
            if verdict.passed:
                store.training_examples.update_one(
                    {"sourceConversationId": cid},
                    {"$set": _training_doc(doc, correction, verdict, teacher_name)},
                    upsert=True,
                )
            store.conversations.update_one(
                {"_id": doc["_id"]},
                {"$set": {"correctionStatus": status, "correctedAt": datetime.now(timezone.utc)}},
            )
        if verdict.passed:
            minted += 1
    return minted


def _cmd_correct(args: argparse.Namespace) -> int:
    load_env()
    try:
        judge_cfg = judge_model()
        teacher_cfg = teacher_model()
    except ConfigError as exc:
        print(f"Configuration error: {exc}", file=sys.stderr)
        return 2

    store = Store(MongoConfig.from_env())
    try:
        store.ping()
    except Exception as exc:  # noqa: BLE001
        print(f"Could not reach MongoDB: {exc}", file=sys.stderr)
        return 2
    store.ensure_indexes()

    teacher = LLM(teacher_cfg)
    judge = LLM(judge_cfg)
    policy = read_policy()

    def one_pass() -> int:
        return _correct_pass(
            store, teacher, judge, policy, teacher_cfg.model,
            retry=args.retry, conversation_id=args.conversation,
            limit=args.limit, dry_run=args.dry_run,
        )

    if not args.loop:
        n = one_pass()
        print(f"\nMinted {n} training example(s).")
        store.close()
        return 0

    print(f"Polling every {args.interval}s (Ctrl-C to stop)…")
    try:
        while True:
            n = one_pass()
            if n:
                print(f"… minted {n}, sleeping {args.interval}s")
            time.sleep(args.interval)
    except KeyboardInterrupt:
        print("\nStopped.")
    finally:
        store.close()
    return 0


def _cmd_export(args: argparse.Namespace) -> int:
    load_env()
    store = Store(MongoConfig.from_env())
    try:
        store.ping()
    except Exception as exc:  # noqa: BLE001
        print(f"Could not reach MongoDB: {exc}", file=sys.stderr)
        return 2
    store.ensure_indexes()

    query: dict[str, Any] = {} if args.include_unverified else {"verified": True}
    docs = list(store.training_examples.find(query).sort("createdAt", 1))
    store.close()

    if len(docs) < args.min:
        print(
            f"Only {len(docs)} example(s) available (need --min {args.min}); not exporting.",
            file=sys.stderr,
        )
        return 1

    out_path = Path(args.out)
    stats = export_dataset(docs, out_path, system_prompt=build_system_prompt())
    meta_path = write_stats_sidecar(out_path, stats, args.model)

    print(f"Wrote {stats.written} example(s) to {out_path}  (skipped {stats.skipped})")
    print(f"  assistant turns: {stats.assistant_turns}   tool calls: {stats.tool_calls}")
    print(f"  ~max tokens/example: {stats.approx_max_tokens} (char/4 estimate)")
    print(f"  stats: {meta_path}")

    if args.render_sample and stats.written:
        _render_samples(out_path, args.render_sample, args.model)
    return 0


def _render_samples(out_path: Path, k: int, model: str) -> None:
    """Apply the real LFM2.5 template to the first k records, to prove fidelity."""

    records = [json.loads(line) for line in out_path.read_text().splitlines()[:k]]
    try:
        for i, record in enumerate(records, start=1):
            text, mask_ok, n_asst, n_total = render_with_template(record, model)
            print(f"\n{'=' * 60}\nRendered example {i} via {model} chat template\n{'=' * 60}")
            print(text[:1600] + (" …(truncated)" if len(text) > 1600 else ""))
            if mask_ok:
                print(f"\n  assistant-only loss: SUPPORTED — {n_asst}/{n_total} tokens are assistant targets")
            else:
                print("\n  assistant-only loss: template exposes no generation markers; "
                      "Phase 4 will need a custom completion-only collator")
    except ImportError:
        print(
            "\n(transformers not installed — skipping template render. "
            "`uv pip install transformers` to verify the LFM2.5 template + loss mask.)",
            file=sys.stderr,
        )


def _write_json(path: Path, data: dict[str, Any]) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2) + "\n")
    return path


def _print_task_line(task_id: str, pass_k: bool, pass_count: int) -> None:
    print(f"  {'PASS' if pass_k else 'FAIL'}  {task_id}  (pass^k {pass_count})")


def _cmd_suite(args: argparse.Namespace) -> int:
    """Run the whole benchmark suite for one model (handy for a baseline)."""

    load_env()
    from ..config import HarnessConfig  # heavy eval imports, kept out of judge/correct
    from .gate import discover_tasks, run_suite

    cfg = HarnessConfig.from_env()
    tasks = discover_tasks(args.tasks or None)
    print(f"Running {len(tasks)} task(s) x k={args.k} against model '{args.model}'…")
    result = run_suite(
        cfg, tasks, model=args.model, k=args.k,
        concurrency=args.concurrency, base_url=args.base_url, on_task=_print_task_line,
    )
    print(f"\nSuite pass^k: {result.pass_count}/{result.total}")
    out = _write_json(Path(args.json), result.to_dict())
    print(f"Wrote {out}")
    return 0


def _cmd_gate(args: argparse.Namespace) -> int:
    """Run the suite for baseline + candidate and decide whether to promote."""

    load_env()
    from ..config import HarnessConfig
    from .gate import SuiteResult, decide, discover_tasks, run_suite

    cfg = HarnessConfig.from_env()
    tasks = discover_tasks(args.tasks or None)

    if args.baseline_json:
        baseline = SuiteResult.from_dict(json.loads(Path(args.baseline_json).read_text()))
        print(f"Baseline loaded from {args.baseline_json}: {baseline.pass_count}/{baseline.total}")
    else:
        print(f"\n== baseline '{args.baseline_model}' ==")
        baseline = run_suite(cfg, tasks, model=args.baseline_model, k=args.k,
                             concurrency=args.concurrency, base_url=args.base_url,
                             on_task=_print_task_line)

    print(f"\n== candidate '{args.candidate_model}' ==")
    candidate = run_suite(cfg, tasks, model=args.candidate_model, k=args.k,
                          concurrency=args.concurrency, base_url=args.base_url,
                          on_task=_print_task_line)

    decision = decide(baseline, candidate, require_improvement=args.require_improvement)

    print("\n" + "=" * 56)
    print(f"baseline : {baseline.pass_count}/{decision.total}")
    print(f"candidate: {candidate.pass_count}/{decision.total}")
    if decision.regressions:
        print(f"regressions : {', '.join(decision.regressions)}")
    if decision.improvements:
        print(f"improvements: {', '.join(decision.improvements)}")
    print(f"\nVERDICT: {'PROMOTE' if decision.promote else 'REJECT'} — {decision.reason}")

    _write_json(Path(args.json), {
        "baseline": baseline.to_dict(),
        "candidate": candidate.to_dict(),
        "decision": decision.to_dict(),
    })
    print(f"Wrote {args.json}")
    return 0 if decision.promote else 1


def _cmd_loop(args: argparse.Namespace) -> int:
    """Autonomous flywheel: generate → judge → correct forever; train every N."""

    from .orchestrate import run_loop  # lazy: pulls the heavy harness stack

    return run_loop(
        gen_batch=args.gen_batch,
        train_every=args.train_every,
        train_cmd=args.train_cmd,
        export_out=args.out,
        concurrency=args.concurrency,
        max_iterations=args.max_iterations,
        max_examples=args.max_examples,
    )


def _cmd_generate(args: argparse.Namespace) -> int:
    """Synthesize fresh scenarios → run them → store transcripts for the judge."""

    load_env()
    from ..config import HarnessConfig  # heavy harness imports kept lazy
    from .generate import generate
    from .scenarios import load_fixtures

    store = Store(MongoConfig.from_env())
    try:
        store.ping()
    except Exception as exc:  # noqa: BLE001
        print(f"Could not reach MongoDB: {exc}", file=sys.stderr)
        return 2
    store.ensure_indexes()
    cfg = HarnessConfig.from_env()

    fixtures = load_fixtures()
    if args.fixture:
        fixtures = [f for f in fixtures if f.id == args.fixture]
        if not fixtures:
            print(f"No fixture named '{args.fixture}'.", file=sys.stderr)
            return 2

    print(f"Generating {args.count} scenario(s) across {len(fixtures)} fixture(s), "
          f"concurrency={args.concurrency}…")
    docs = generate(
        store, cfg,
        count=args.count, concurrency=args.concurrency, fixtures=fixtures,
        dry_run=args.dry_run,
        on_author=lambda i, goal: print(f"  authored #{i + 1}: {goal}"),
        on_done=lambda d: print(
            f"  ran {d['scenario']['taskId']}: {d['messageCount']} msgs, "
            f"{d['toolCallCount']} tool calls"
        ),
    )
    where = "(dry-run, not stored)" if args.dry_run else "→ conversations (source=generated)"
    print(f"\nGenerated {len(docs)} transcript(s) {where}")
    store.close()
    return 0


def _cmd_sync_tools(args: argparse.Namespace) -> int:
    """Dump the live MCP tool catalog to tools_catalog.json.

    The only command that touches MCP — imports are lazy so ``judge`` / ``correct``
    never load the MCP SDK. Needs Postgres + pnpm, like the eval harness.
    """

    import asyncio

    from ..config import HarnessConfig
    from ..mcp import mcp_session, mcp_tools_to_openai
    from .tools import CATALOG_PATH

    load_env()
    print(f"Spawning MCP server against {args.db_url} …")

    async def _dump() -> list[dict[str, Any]]:
        cfg = HarnessConfig.from_env()
        async with mcp_session(cfg, args.db_url) as client:
            return mcp_tools_to_openai(await client.list_tools())

    try:
        tools = asyncio.run(_dump())
    except Exception as exc:  # noqa: BLE001
        print(f"Failed to list MCP tools: {exc}", file=sys.stderr)
        return 1

    CATALOG_PATH.write_text(json.dumps(tools, indent=2) + "\n")
    names = ", ".join(t["function"]["name"] for t in tools)
    print(f"Wrote {len(tools)} tools to {CATALOG_PATH}\n  {names}")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(prog="acmebox-flywheel")
    sub = parser.add_subparsers(dest="command", required=True)

    j = sub.add_parser("judge", help="Judge un-judged transcripts against the policy.")
    j.add_argument("--loop", action="store_true", help="Keep polling instead of exiting after one pass.")
    j.add_argument("--interval", type=float, default=15.0, help="Seconds between polls in --loop (default 15).")
    j.add_argument("--limit", type=int, default=None, help="Cap how many transcripts to process.")
    j.add_argument("--dry-run", action="store_true", help="Judge and print, but write nothing back.")
    j.add_argument("--rejudge", action="store_true", help="Re-grade every transcript, even already-judged ones.")
    j.add_argument("--conversation", default=None, help="Judge a single conversationId.")
    j.set_defaults(func=_cmd_judge)

    c = sub.add_parser("correct", help="Rewrite judge-failed transcripts into verified gold examples.")
    c.add_argument("--loop", action="store_true", help="Keep polling instead of exiting after one pass.")
    c.add_argument("--interval", type=float, default=30.0, help="Seconds between polls in --loop (default 30).")
    c.add_argument("--limit", type=int, default=None, help="Cap how many transcripts to process.")
    c.add_argument("--dry-run", action="store_true", help="Rewrite + verify + print, but write nothing back.")
    c.add_argument("--retry", action="store_true", help="Also retry transcripts previously rejected or errored.")
    c.add_argument("--conversation", default=None, help="Correct a single conversationId.")
    c.set_defaults(func=_cmd_correct)

    r = sub.add_parser("render", help="Print rendered transcripts (no LLM call).")
    r.add_argument("--limit", type=int, default=None)
    r.add_argument("--conversation", default=None)
    r.set_defaults(func=_cmd_render)

    e = sub.add_parser("export", help="Export minted gold examples to trainer-ready JSONL.")
    e.add_argument("--out", default=str(DEFAULT_OUT), help=f"Output JSONL path (default {DEFAULT_OUT}).")
    e.add_argument("--min", type=int, default=10, help="Refuse to export if fewer than N examples (batch gate; default 10).")
    e.add_argument("--include-unverified", action="store_true", help="Include examples that failed the verifier.")
    e.add_argument("--render-sample", type=int, default=0, metavar="K", help="Apply the real LFM2.5 template to K examples to verify fidelity + loss mask.")
    e.add_argument("--model", default=DEFAULT_TOKENIZER, help="Tokenizer/model id for --render-sample and the stats sidecar.")
    e.set_defaults(func=_cmd_export)

    lp = sub.add_parser("loop", help="Run the flywheel autonomously: generate→judge→correct, train every N.")
    lp.add_argument("--gen-batch", type=int, default=4, help="Scenarios generated per iteration (default 4).")
    lp.add_argument("--train-every", type=int, default=10, help="Fire the training hook every N new verified examples (default 10).")
    lp.add_argument("--train-cmd", default=os.environ.get("TRAIN_CMD"), help="Shell command to run on each batch; '{dataset}' is replaced with the JSONL path. Runs in the background (non-blocking).")
    lp.add_argument("--out", default=None, help="JSONL path exported on each trigger (default data/sft.jsonl).")
    lp.add_argument("--concurrency", type=int, default=3, help="Concurrent conversation runs per generate batch.")
    lp.add_argument("--max-iterations", type=int, default=None, help="Stop after this many loop iterations.")
    lp.add_argument("--max-examples", type=int, default=None, help="Stop once this many verified examples exist.")
    lp.set_defaults(func=_cmd_loop)

    gen = sub.add_parser("generate", help="Synthesize new scenarios (Together author → Liquid agent) into Mongo.")
    gen.add_argument("--count", type=int, default=5, help="How many scenarios to generate.")
    gen.add_argument("--concurrency", type=int, default=3, help="Concurrent conversation runs.")
    gen.add_argument("--fixture", default=None, help="Limit to a single seed fixture id.")
    gen.add_argument("--dry-run", action="store_true", help="Run + print, but don't write to Mongo.")
    gen.set_defaults(func=_cmd_generate)

    su = sub.add_parser("suite", help="Run the whole benchmark suite for one model (e.g. a baseline).")
    su.add_argument("--model", required=True, help="AGENT_MODEL to evaluate (base id or adapter name).")
    su.add_argument("--k", type=int, default=1, help="Trials per task (pass^k).")
    su.add_argument("--concurrency", type=int, default=1, help="Concurrent trials per task.")
    su.add_argument("--base-url", default=None, help="Override AGENT_BASE_URL (else from .env).")
    su.add_argument("--tasks", nargs="*", default=None, help="Limit to these task ids (default: all).")
    su.add_argument("--json", default="data/evals/suite.json", help="Where to write results.")
    su.set_defaults(func=_cmd_suite)

    g = sub.add_parser("gate", help="Run suite for baseline + candidate; promote iff no regression.")
    g.add_argument("--baseline-model", default=os.environ.get("BASE_MODEL", "LiquidAI/LFM2.5-8B-A1B"),
                   help="Baseline AGENT_MODEL (the currently-served model).")
    g.add_argument("--candidate-model", required=True, help="Candidate AGENT_MODEL (the trained adapter name).")
    g.add_argument("--baseline-json", default=None, help="Reuse a prior `suite` result instead of re-running baseline.")
    g.add_argument("--k", type=int, default=1, help="Trials per task (pass^k).")
    g.add_argument("--concurrency", type=int, default=1, help="Concurrent trials per task.")
    g.add_argument("--base-url", default=None, help="Override AGENT_BASE_URL for both runs (same vLLM serving base+adapter).")
    g.add_argument("--tasks", nargs="*", default=None, help="Limit to these task ids (default: all).")
    g.add_argument("--require-improvement", action="store_true", help="Promote only if at least one task flips fail→pass.")
    g.add_argument("--json", default="data/evals/gate.json", help="Where to write the verdict.")
    g.set_defaults(func=_cmd_gate)

    s = sub.add_parser(
        "sync-tools",
        help="Dump the MCP tool catalog to tools_catalog.json (needs Postgres + pnpm).",
    )
    s.add_argument(
        "--db-url",
        default=os.environ.get(
            "FLYWHEEL_TOOLS_DB_URL",
            "postgres://postgres:postgres@localhost:5433/acmebox",
        ),
        help="Postgres URL the MCP server connects to (any migrated AcmeBox DB).",
    )
    s.set_defaults(func=_cmd_sync_tools)

    args = parser.parse_args()
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
