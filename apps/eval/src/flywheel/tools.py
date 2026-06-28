"""The tool catalog the judge and teacher reason about.

The judge can't tell a correct tool call from a hallucinated one if it only sees
the calls that happen to appear in a transcript — it would be guessing each
tool's name and argument shape. So it (and the teacher) get the *real* catalog:
every tool the agent could call, with its JSON-Schema arguments.

The catalog is a committed snapshot (``tools_catalog.json``) generated from the
live MCP server by ``acmebox-flywheel sync-tools``. Keeping it as a snapshot means
the judge/teacher runtime never has to spawn the MCP server (no pnpm/Postgres) —
it just reads a file. Re-run ``sync-tools`` whenever the MCP tools change.
"""

from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path
from typing import Any

CATALOG_PATH = Path(__file__).resolve().parent / "tools_catalog.json"


def load_catalog() -> list[dict[str, Any]]:
    """Return the OpenAI-format tool specs, or ``[]`` if the snapshot is absent."""

    if not CATALOG_PATH.exists():
        return []
    data = json.loads(CATALOG_PATH.read_text())
    return data if isinstance(data, list) else []


def _render_schema(schema: Any) -> str:
    """Compact one-line rendering of a JSON Schema node.

    Objects become ``{field: type, optional?: type}`` (``?`` marks non-required),
    arrays become ``type[]``, enums become ``a|b|c`` — enough for the judge to
    spot an out-of-schema argument (e.g. an invalid order status) without dumping
    the full schema.
    """

    if not isinstance(schema, dict):
        return "any"
    if "enum" in schema and isinstance(schema["enum"], list):
        return "|".join(str(v) for v in schema["enum"])

    schema_type = schema.get("type")
    if schema_type == "object" or "properties" in schema:
        props = schema.get("properties", {})
        if not isinstance(props, dict) or not props:
            return "object"
        required = set(schema.get("required", []) or [])
        fields = [
            f"{key}{'' if key in required else '?'}: {_render_schema(val)}"
            for key, val in props.items()
        ]
        return "{" + ", ".join(fields) + "}"
    if schema_type == "array":
        return _render_schema(schema.get("items", {})) + "[]"
    if isinstance(schema_type, list):
        return "|".join(schema_type)
    if isinstance(schema_type, str):
        return schema_type
    return "any"


def render_catalog(tools: list[dict[str, Any]]) -> str:
    """One line per tool: ``- name(args): first line of description``."""

    lines: list[str] = []
    for tool in tools:
        fn = tool.get("function", tool) if isinstance(tool, dict) else {}
        name = fn.get("name")
        if not name:
            continue
        # The top-level parameters object reads better as a call signature —
        # name(path: {...}, payload: {...}) — than as a bare brace block.
        sig = _render_schema(fn.get("parameters", {}))
        sig = f"({sig[1:-1]})" if sig.startswith("{") and sig.endswith("}") else f"({sig})"
        desc = (fn.get("description") or "").strip().splitlines()
        first = desc[0].strip() if desc else ""
        lines.append(f"- {name}{sig}: {first}" if first else f"- {name}{sig}")
    return "\n".join(lines)


@lru_cache(maxsize=1)
def catalog_text() -> str:
    """Rendered catalog for prompts (cached). Empty string if no snapshot."""

    return render_catalog(load_catalog())
