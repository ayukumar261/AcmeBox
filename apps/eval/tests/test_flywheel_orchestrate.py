"""Offline tests for the loop's trigger math + training hook (no LLM, no Mongo)."""

from __future__ import annotations

import time

from src.flywheel.orchestrate import TrainHook, due_for_training


def test_due_for_training_boundaries():
    assert due_for_training(0, 0, 20) is False
    assert due_for_training(19, 0, 20) is False
    assert due_for_training(20, 0, 20) is True        # exactly one batch
    assert due_for_training(45, 20, 20) is True        # 25 new since last fire
    assert due_for_training(35, 20, 20) is False       # only 15 new
    assert due_for_training(5, 0, 0) is False          # guard against every=0


def test_train_hook_noop_when_unset():
    hook = TrainHook(None)
    assert hook.fire("data/sft.jsonl") is None
    assert hook.busy() is False


def test_train_hook_runs_command_and_substitutes_dataset(tmp_path):
    marker = tmp_path / "fired.txt"
    # Write the (substituted) dataset path into a marker file, in the background.
    hook = TrainHook(f"echo {{dataset}} > {marker}")
    proc = hook.fire("/data/sft.jsonl")
    assert proc is not None
    proc.wait(timeout=10)
    assert marker.read_text().strip() == "/data/sft.jsonl"  # {dataset} was substituted


def test_train_hook_single_flight():
    # A long-running hook reports busy until it finishes.
    hook = TrainHook("sleep 1")
    hook.fire("x")
    assert hook.busy() is True
    hook._proc.wait(timeout=5)
    assert hook.busy() is False
