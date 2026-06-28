"""Offline unit tests for the JSONL exporter (no Mongo, no transformers)."""

from __future__ import annotations

import json

from src.flywheel.export import (
    _normalize_tool_call,
    build_system_prompt,
    example_to_record,
    export_dataset,
    is_trainable,
)


def test_normalize_tool_call_parses_string_args_to_object():
    tc = {"id": "c1", "type": "function",
          "function": {"name": "f", "arguments": '{"a": 1}'}}
    assert _normalize_tool_call(tc)["function"]["arguments"] == {"a": 1}


def test_normalize_tool_call_passes_through_object_args():
    tc = {"id": "c1", "function": {"name": "f", "arguments": {"a": 1}}}
    out = _normalize_tool_call(tc)
    assert out["function"]["arguments"] == {"a": 1}
    assert out["type"] == "function"

# A minted gold example as stored in `training_examples`: OpenAI-format messages.
_DOC = {
    "sourceConversationId": "conv-1",
    "verified": True,
    "messages": [
        {"role": "user", "content": "Make my Austin address the default."},
        {"role": "user", "content": "cust_1"},
        {
            "role": "assistant",
            "content": "",
            "tool_calls": [
                {
                    "id": "call_1",
                    "type": "function",
                    "function": {"name": "customers_getById", "arguments": '{"path": {"customerId": "cust_1"}}'},
                }
            ],
        },
        {"role": "tool", "tool_call_id": "call_1", "content": '{"id": "cust_1"}'},
        {"role": "assistant", "content": "Done — Austin is your default. Anything else?"},
    ],
}

_TOOLS = [{"type": "function", "function": {"name": "customers_getById", "parameters": {}}}]


def test_build_system_prompt_includes_preamble_and_policy():
    sp = build_system_prompt("MY POLICY BODY")
    assert sp.startswith("You are a customer-support agent for AcmeBox")
    assert "Policy:\nMY POLICY BODY" in sp


def test_example_to_record_prepends_system_and_attaches_tools():
    rec = example_to_record(_DOC, "SYS", _TOOLS)
    assert rec is not None
    assert rec["messages"][0] == {"role": "system", "content": "SYS"}
    assert rec["messages"][1]["role"] == "user"
    assert rec["tools"] == _TOOLS
    # The OpenAI JSON-string arguments are parsed to an OBJECT — the LFM2.5 chat
    # template iterates them and would throw on a string.
    asst = rec["messages"][3]
    assert asst["tool_calls"][0]["function"]["arguments"] == {"path": {"customerId": "cust_1"}}


def test_example_to_record_drops_unusable():
    # Only a user turn, no assistant target → not trainable.
    doc = {"messages": [{"role": "user", "content": "hi"}]}
    assert example_to_record(doc, "SYS", []) is None


def test_is_trainable():
    assert is_trainable(_DOC["messages"]) is True
    assert is_trainable([{"role": "assistant", "content": "hi"}]) is False  # no user
    assert is_trainable([{"role": "user", "content": "hi"}]) is False  # no assistant


def test_export_dataset_writes_jsonl_and_stats(tmp_path):
    out = tmp_path / "sft.jsonl"
    stats = export_dataset([_DOC, {"messages": []}], out, system_prompt="SYS", tools=_TOOLS)

    assert stats.written == 1
    assert stats.skipped == 1  # the empty doc
    assert stats.assistant_turns == 2
    assert stats.tool_calls == 1
    assert stats.sources == ["conv-1"]

    lines = out.read_text().splitlines()
    assert len(lines) == 1
    record = json.loads(lines[0])  # valid JSON, round-trips
    assert record["messages"][0]["role"] == "system"
    assert record["tools"] == _TOOLS
