"""Offline unit tests for the flywheel's pure helpers (no API keys, no Mongo)."""

from __future__ import annotations

import pytest

from src.flywheel.llm import extract_json
from src.flywheel.transcript import (
    extract_tool_calls,
    has_user_text,
    render_transcript,
)

# A UIMessage-shaped conversation like the web app stores: a user text turn, then
# an assistant turn that calls a tool (with input + output) and replies.
_MESSAGES = [
    {
        "id": "m1",
        "role": "user",
        "parts": [{"type": "text", "text": "Hi, make my Austin address the default."}],
    },
    {
        "id": "m2",
        "role": "assistant",
        "parts": [
            {
                "type": "tool-customers_getById",
                "toolName": "customers_getById",
                "input": {"path": {"customerId": "cust_1"}},
                "output": {"id": "cust_1", "default_address_id": "addr_old"},
            },
            {"type": "reasoning", "text": "internal scratchpad — must not leak"},
            {"type": "text", "text": "Done — Austin is now your default."},
        ],
    },
]


def test_render_includes_tool_calls_and_results():
    rendered = render_transcript(_MESSAGES)
    assert "USER: Hi, make my Austin address the default." in rendered
    assert "[tool call] customers_getById(" in rendered
    assert "cust_1" in rendered  # the argument
    assert "[tool result]" in rendered
    assert "ASSISTANT: Done — Austin is now your default." in rendered


def test_render_omits_reasoning():
    assert "scratchpad" not in render_transcript(_MESSAGES)


def test_render_truncates_huge_results():
    big = [
        {
            "id": "m",
            "role": "assistant",
            "parts": [
                {
                    "type": "tool-meals_list",
                    "toolName": "meals_list",
                    "input": {},
                    "output": "x" * 5000,
                }
            ],
        }
    ]
    assert "…(truncated)" in render_transcript(big)


def test_tool_error_renders_instead_of_result():
    msgs = [
        {
            "id": "m",
            "role": "assistant",
            "parts": [
                {
                    "type": "dynamic-tool",
                    "toolName": "orders_update",
                    "input": {"path": {"orderId": "ord_1"}},
                    "errorText": "order is shipped; cannot edit",
                }
            ],
        }
    ]
    out = render_transcript(msgs)
    assert "[tool error] order is shipped; cannot edit" in out
    assert "[tool result]" not in out


def test_extract_tool_calls():
    calls = extract_tool_calls(_MESSAGES)
    assert [c["name"] for c in calls] == ["customers_getById"]
    assert calls[0]["input"] == {"path": {"customerId": "cust_1"}}


def test_has_user_text():
    assert has_user_text(_MESSAGES) is True
    assert has_user_text([{"role": "assistant", "parts": [{"type": "text", "text": "hi"}]}]) is False
    assert has_user_text([{"role": "user", "parts": [{"type": "text", "text": "   "}]}]) is False


@pytest.mark.parametrize(
    "raw",
    [
        '{"passed": true, "critique": "ok"}',
        '```json\n{"passed": true, "critique": "ok"}\n```',
        'Sure! Here is the verdict:\n{"passed": true, "critique": "ok"} Hope that helps.',
        '{"critique": "has a } brace inside the string", "passed": true}',
    ],
)
def test_extract_json_tolerant(raw):
    parsed = extract_json(raw)
    assert parsed["passed"] is True


def test_extract_json_raises_on_garbage():
    with pytest.raises(ValueError):
        extract_json("no json here at all")
