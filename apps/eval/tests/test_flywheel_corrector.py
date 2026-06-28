"""Offline unit tests for the corrector's pure logic (no teacher/judge calls)."""

from __future__ import annotations

from src.flywheel.corrector import _assemble, build_result_index
from src.flywheel.transcript import render_openai_transcript

# The ORIGINAL (failed) transcript, in AI SDK UIMessage shape: the agent looked up
# the order directly without verifying identity first.
_ORIGINAL = [
    {
        "role": "user",
        "parts": [{"type": "text", "text": "Where is my order ord_1?"}],
    },
    {
        "role": "assistant",
        "parts": [
            {
                "type": "tool-orders_getById",
                "toolName": "orders_getById",
                "input": {"path": {"orderId": "ord_1"}},
                "output": {"id": "ord_1", "status": "delivered"},
            },
            {"type": "text", "text": "It was delivered."},
        ],
    },
]

# What the teacher returns: a corrected conversation that verifies identity first
# (a NEW call → synthesized result), then repeats the real orders_getById lookup
# (same args → should reuse the REAL result).
_TEACHER_OUTPUT = {
    "messages": [
        {"role": "user", "content": "Where is my order ord_1?"},
        {
            "role": "assistant",
            "content": "Happy to help — can I get your customer ID?",
        },
        {"role": "user", "content": "cust_1"},
        {
            "role": "assistant",
            "content": "",
            "tool_calls": [
                {"name": "customers_getById", "arguments": {"path": {"customerId": "cust_1"}}}
            ],
        },
        {"role": "tool", "name": "customers_getById", "content": '{"id": "cust_1"}'},
        {
            "role": "assistant",
            "content": "",
            "tool_calls": [
                {"name": "orders_getById", "arguments": {"path": {"orderId": "ord_1"}}}
            ],
        },
        {"role": "tool", "name": "orders_getById", "content": "TEACHER-INVENTED — should be overwritten"},
        {"role": "assistant", "content": "Your order ord_1 was delivered. Anything else?"},
    ]
}


def test_build_result_index_keys_on_name_and_args():
    index = build_result_index(_ORIGINAL)
    assert index[("orders_getById", '{"path": {"orderId": "ord_1"}}')] == '{"id": "ord_1", "status": "delivered"}'


def test_assemble_reuses_real_result_and_synthesizes_new_one():
    correction = _assemble(_TEACHER_OUTPUT, build_result_index(_ORIGINAL))

    # customers_getById is new → synthesized; orders_getById matches → reused.
    assert correction.reused_results == 1
    assert correction.synthesized_results == 1

    tool_msgs = [m for m in correction.messages if m["role"] == "tool"]
    by_call = {m["tool_call_id"]: m["content"] for m in tool_msgs}
    # The real recorded result was spliced in over the teacher's invented one.
    assert any("status" in c and "delivered" in c for c in by_call.values())
    assert "TEACHER-INVENTED" not in "".join(by_call.values())


def test_assemble_assigns_unique_tool_call_ids_and_links_them():
    correction = _assemble(_TEACHER_OUTPUT, build_result_index(_ORIGINAL))
    call_ids = [
        m["tool_calls"][0]["id"]
        for m in correction.messages
        if m.get("tool_calls")
    ]
    tool_ids = [m["tool_call_id"] for m in correction.messages if m["role"] == "tool"]
    assert call_ids == ["call_1", "call_2"]
    assert tool_ids == call_ids  # every result is linked to its call


def test_assemble_stringifies_arguments():
    correction = _assemble(_TEACHER_OUTPUT, {})
    args = next(
        m["tool_calls"][0]["function"]["arguments"]
        for m in correction.messages
        if m.get("tool_calls")
    )
    assert isinstance(args, str)  # OpenAI format wants a JSON-string


def test_render_openai_transcript_roundtrips():
    correction = _assemble(_TEACHER_OUTPUT, build_result_index(_ORIGINAL))
    rendered = render_openai_transcript(correction.messages)
    assert "USER: Where is my order ord_1?" in rendered
    assert "[tool call] customers_getById(" in rendered
    assert "[tool result]" in rendered
    assert "Anything else?" in rendered
