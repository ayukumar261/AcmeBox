"""Offline unit tests for the tool-catalog renderer."""

from __future__ import annotations

from src.flywheel.tools import _render_schema, render_catalog

# Shaped like the MCP server's OpenAI tool specs (nested path/payload JSON Schema).
_TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "customers_getById",
            "description": "Get a customer by id.\nMore detail ignored.",
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {
                        "type": "object",
                        "properties": {"customerId": {"type": "string"}},
                        "required": ["customerId"],
                    }
                },
                "required": ["path"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "orders_update",
            "description": "Update an order.",
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {
                        "type": "object",
                        "properties": {"orderId": {"type": "string"}},
                        "required": ["orderId"],
                    },
                    "payload": {
                        "type": "object",
                        "properties": {
                            "status": {"enum": ["pending", "shipped", "delivered", "canceled"]},
                            "note": {"type": "string"},
                        },
                        "required": ["status"],
                    },
                },
                "required": ["path", "payload"],
            },
        },
    },
]


def test_render_schema_objects_mark_optional_with_question_mark():
    schema = _TOOLS[1]["function"]["parameters"]
    rendered = _render_schema(schema)
    assert "path: {orderId: string}" in rendered
    # `note` is optional, `status` is required.
    assert "note?: string" in rendered
    assert "status: pending|shipped|delivered|canceled" in rendered


def test_render_schema_arrays():
    assert _render_schema({"type": "array", "items": {"type": "string"}}) == "string[]"


def test_render_catalog_one_line_per_tool_with_first_description_line():
    text = render_catalog(_TOOLS)
    lines = text.splitlines()
    assert len(lines) == 2
    assert lines[0].startswith("- customers_getById(path: {customerId: string}): Get a customer by id.")
    assert "More detail ignored" not in text  # only the first description line
    assert lines[1].startswith("- orders_update(")


def test_render_catalog_empty():
    assert render_catalog([]) == ""
