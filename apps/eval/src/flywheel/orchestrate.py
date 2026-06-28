"""Phase 6: the autonomous loop — generate data forever, train every N examples.

``run_loop`` repeats **generate → judge → correct**, accumulating verified gold
examples in ``training_examples``. Every ``train_every`` newly-minted examples it
exports the full set to JSONL and fires a training hook — WITHOUT pausing
generation (the hook runs as a background process, single-flight so two trainings
never overlap). It stops on Ctrl-C, an optional cap, or when generation stops
producing anything (the practical "out of API credits" signal).

The actual GPU training is delegated to ``train_cmd`` (a shell command with a
``{dataset}`` placeholder) because it runs on a separate pod. The loop owns the
cadence and the data; the hook is where the pod automation plugs in.

The trigger math (``due_for_training``) and the hook (``TrainHook``) are pure and
unit-tested; the heavy harness imports live inside ``run_loop``.
"""

from __future__ import annotations

import subprocess
from pathlib import Path


def due_for_training(verified_count: int, last_triggered_at: int, every: int) -> bool:
    """True once ``every`` new verified examples have accrued since the last fire."""

    return every > 0 and (verified_count - last_triggered_at) >= every


class TrainHook:
    """Fires the user's training command in the background, one run at a time."""

    def __init__(self, cmd: str | None) -> None:
        self.cmd = cmd
        self._proc: subprocess.Popen | None = None

    def busy(self) -> bool:
        """True if a previously-fired training is still running."""

        return self._proc is not None and self._proc.poll() is None

    def fire(self, dataset_path: str | Path) -> subprocess.Popen | None:
        """Launch ``cmd`` (``{dataset}`` → ``dataset_path``) detached. No-op if unset."""

        if not self.cmd:
            return None
        cmd = self.cmd.replace("{dataset}", str(dataset_path))
        self._proc = subprocess.Popen(cmd, shell=True)
        return self._proc


def run_loop(
    *,
    gen_batch: int = 4,
    train_every: int = 20,
    train_cmd: str | None = None,
    export_out: str | None = None,
    concurrency: int = 3,
    max_iterations: int | None = None,
    max_examples: int | None = None,
    stall_limit: int = 3,
) -> int:
    """Drive the flywheel autonomously until a stop condition is hit."""

    from ..config import HarnessConfig, agent_model, user_model
    from .config import (
        ConfigError,
        MongoConfig,
        author_model,
        judge_model,
        load_env,
        read_policy,
        teacher_model,
    )
    from .export import (
        DEFAULT_OUT,
        DEFAULT_TOKENIZER,
        build_system_prompt,
        export_dataset,
        write_stats_sidecar,
    )
    from .generate import generate
    from .llm import LLM
    from .mongo import Store
    # Reuse the worker's judge/correct passes (already loaded — we're called from it).
    from .worker import _correct_pass, _judge_pass

    load_env()
    out_path = Path(export_out or DEFAULT_OUT)

    # Preflight: every role must be configured before we burn a single API call.
    try:
        judge_cfg, teacher_cfg = judge_model(), teacher_model()
        author_model()
        agent_model()
        user_model()
    except ConfigError as exc:
        print(
            f"Configuration error: {exc}\n"
            "The loop needs AGENT_* + USER_* + API_KEY (the agent and customer sim) "
            "and JUDGE_* (the judge; author and teacher fall back to it). "
            "See apps/eval/.env.example."
        )
        return 2

    store = Store(MongoConfig.from_env())
    try:
        store.ping()
    except Exception as exc:  # noqa: BLE001
        print(f"Could not reach MongoDB: {exc}")
        return 2
    store.ensure_indexes()

    cfg = HarnessConfig.from_env()
    policy = read_policy()
    judge_llm, teacher_llm = LLM(judge_cfg), LLM(teacher_cfg)
    hook = TrainHook(train_cmd)

    def verified_count() -> int:
        return store.training_examples.count_documents({"verified": True})

    # Fire at absolute multiples of ``train_every`` (e.g. at 10, 20, 30 verified),
    # not at start+train_every. Flooring the baseline to the previous multiple
    # means a partially-populated store triggers at the next round number rather
    # than ``train_every`` examples after wherever the loop happened to start.
    start = verified_count()
    last_trigger = (start // train_every) * train_every if train_every > 0 else start
    iteration = stalls = 0
    print(f"Loop started. train_every={train_every}, gen_batch={gen_batch}. Ctrl-C to stop.")

    try:
        while True:
            iteration += 1
            print(f"\n=== iteration {iteration} (verified so far: {verified_count()}) ===")

            generated = len(generate(store, cfg, count=gen_batch, concurrency=concurrency))
            judged = _judge_pass(store, judge_llm, policy, judge_cfg.model,
                                 rejudge=False, conversation_id=None, limit=None, dry_run=False)
            minted = _correct_pass(store, teacher_llm, judge_llm, policy, teacher_cfg.model,
                                   retry=False, conversation_id=None, limit=None, dry_run=False)
            total = verified_count()
            print(f"[loop] generated={generated} judged={judged} minted={minted} verified_total={total}")

            if due_for_training(total, last_trigger, train_every) and not hook.busy():
                docs = list(store.training_examples.find({"verified": True}).sort("createdAt", 1))
                stats = export_dataset(docs, out_path, system_prompt=build_system_prompt())
                write_stats_sidecar(out_path, stats, DEFAULT_TOKENIZER)
                last_trigger = total
                if hook.cmd:
                    print(f"[loop] >>> TRAIN TRIGGER at {total} examples → {out_path} "
                          f"({stats.written} rows); firing: {hook.cmd}")
                    hook.fire(out_path)
                else:
                    print(f"[loop] >>> batch ready: {stats.written} rows at {out_path} "
                          "(no --train-cmd set; train manually)")
            elif due_for_training(total, last_trigger, train_every) and hook.busy():
                print("[loop] training threshold hit, but a training run is still active — deferring.")

            stalls = stalls + 1 if generated == 0 else 0
            if stalls >= stall_limit:
                print(f"\n[loop] generated nothing for {stalls} iterations — likely out of API "
                      "credits or a stalled endpoint. Stopping.")
                break
            if max_examples and total >= max_examples:
                print(f"\n[loop] reached --max-examples {max_examples}. Stopping.")
                break
            if max_iterations and iteration >= max_iterations:
                print(f"\n[loop] reached --max-iterations {max_iterations}. Stopping.")
                break
    except KeyboardInterrupt:
        print("\n[loop] stopped by user.")
    finally:
        store.close()
    return 0
