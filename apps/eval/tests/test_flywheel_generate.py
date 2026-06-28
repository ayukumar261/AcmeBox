"""Offline tests for the scenario generator's pure pieces (no infra, no LLM)."""

from __future__ import annotations

from src.flywheel.scenarios import author_scenario, load_fixtures
from src.flywheel.transcript import (
    extract_tool_calls,
    has_user_text,
    messages_openai_to_ui,
    render_transcript,
)

# The agent's OpenAI-format history as run_conversation would capture it
# (system at [0], then interleaved user / assistant+tool_calls / tool results).
_OPENAI = [
    {"role": "system", "content": "policy + agent preamble"},
    {"role": "user", "content": "pause my subscription please"},
    {
        "role": "assistant",
        "content": "Sure — what's your customer ID?",
    },
    {"role": "user", "content": "cust_3"},
    {
        "role": "assistant",
        "content": "",
        "tool_calls": [
            {"id": "call_1", "type": "function",
             "function": {"name": "subscriptions_list", "arguments": '{"urlParams": {"customerId": "cust_3"}}'}}
        ],
    },
    {"role": "tool", "tool_call_id": "call_1", "content": '[{"id": "sub_paused", "status": "paused"}]'},
    {"role": "assistant", "content": "Your subscription is already paused. Anything else?"},
]


def test_converter_merges_tool_call_with_result_and_drops_system():
    ui = messages_openai_to_ui(_OPENAI)
    # system dropped; first turn is the customer
    assert ui[0] == {"role": "user", "parts": [{"type": "text", "text": "pause my subscription please"}]}

    # the tool call became one part carrying BOTH input and output
    tool_parts = [p for m in ui for p in m["parts"] if str(p.get("type", "")).startswith("tool-")]
    assert len(tool_parts) == 1
    part = tool_parts[0]
    assert part["toolName"] == "subscriptions_list"
    assert part["input"] == {"urlParams": {"customerId": "cust_3"}}  # JSON string parsed to object
    assert part["output"] == '[{"id": "sub_paused", "status": "paused"}]'


def test_converted_transcript_is_consumable_by_existing_helpers():
    ui = messages_openai_to_ui(_OPENAI)
    # The judge/corrector read this exact shape — make sure their helpers work.
    assert has_user_text(ui) is True
    assert [c["name"] for c in extract_tool_calls(ui)] == ["subscriptions_list"]
    rendered = render_transcript(ui)
    assert "USER: pause my subscription please" in rendered
    assert "[tool call] subscriptions_list(" in rendered
    assert "[tool result]" in rendered


def test_load_fixtures_present_and_coherent():
    fixtures = {f.id: f for f in load_fixtures()}
    assert {"active_pending", "delivered_refund", "paused_expired"} <= set(fixtures)
    fx = fixtures["active_pending"]
    assert fx.customer_id == "cust_1"
    assert fx.seed["customers"][0]["id"] == "cust_1"
    assert fx.description  # non-empty, feeds the author


class _FakeLLM:
    def __init__(self, reply: str) -> None:
        self.reply = reply

    def complete(self, messages, *, temperature=0.0, max_tokens=None) -> str:
        return self.reply


def test_author_scenario_builds_task_with_empty_criteria():
    fixture = {f.id: f for f in load_fixtures()}["active_pending"]
    fake = _FakeLLM('{"goal": "reschedule my next box", "instructions": "You are Sam Rivera (cust_1)..."}')
    task, goal = author_scenario(fake, fixture, "POLICY", index=2)

    assert goal == "reschedule my next box"
    assert task.id == "gen_active_pending_3"
    assert task.user.instructions.startswith("You are Sam Rivera")
    assert task.seed == fixture.seed
    # No deterministic key — the LLM judge grades these.
    assert task.evaluation_criteria.db_check == []
    assert task.evaluation_criteria.tools == []
