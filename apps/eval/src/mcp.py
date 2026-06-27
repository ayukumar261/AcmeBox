"""The MCP boundary: spawn the server and bridge its tools to OpenAI.

Two tightly-coupled halves:

* **Client** -- launch the AcmeBox MCP server (``apps/mcp``) over stdio for one
  run. Its in-process runtime imports ``@repo/api`` and connects to whatever
  ``DATABASE_URL`` it is given, so one server per task with that var pointed at
  the task's ephemeral database keeps tool calls on isolated state. Protocol
  travels on stdout; the server logs on stderr.
* **Bridge** -- convert MCP tool descriptors (whose ``inputSchema`` is already
  JSON Schema with the nested ``{"path": ..., "payload": ...}`` shape) into the
  OpenAI function-calling format, and parse tool-call arguments back. The nesting
  is preserved end to end, so parsed args go straight back to ``call_tool``.
"""

from __future__ import annotations

import json
import os
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from dataclasses import dataclass
from typing import Any

from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client

from .config import HarnessConfig

# --- Client ------------------------------------------------------------------


@dataclass
class ToolResult:
    """Outcome of one MCP tool call, as captured for grading."""

    name: str
    arguments: dict[str, Any]
    text: str
    is_error: bool


class McpClient:
    """Thin async wrapper over an initialized MCP ``ClientSession``."""

    def __init__(self, session: ClientSession) -> None:
        self._session = session

    async def list_tools(self) -> list[Any]:
        result = await self._session.list_tools()
        return list(result.tools)

    async def call_tool(self, name: str, arguments: dict[str, Any]) -> ToolResult:
        result = await self._session.call_tool(name, arguments)
        return ToolResult(
            name=name,
            arguments=arguments,
            text=_render_content(result),
            is_error=bool(getattr(result, "isError", False)),
        )


def _render_content(result: Any) -> str:
    """Flatten an MCP CallToolResult into a string for the agent transcript."""

    parts: list[str] = []
    for block in getattr(result, "content", []) or []:
        text = getattr(block, "text", None)
        if text is not None:
            parts.append(text)
    if not parts:
        structured = getattr(result, "structuredContent", None)
        if structured is not None:
            parts.append(str(structured))
    return "\n".join(parts)


@asynccontextmanager
async def mcp_session(
    cfg: HarnessConfig, db_url: str
) -> AsyncIterator[McpClient]:
    """Launch the MCP server against ``db_url`` and yield a ready client."""

    params = StdioServerParameters(
        # ``--silent`` suppresses pnpm's lifecycle banner ("> tsx src/index.ts"),
        # which would otherwise pollute the stdio MCP protocol stream.
        command="pnpm",
        args=["--silent", "--filter", "@repo/mcp", "start"],
        cwd=str(cfg.repo_root),
        env={**os.environ, "DATABASE_URL": db_url},
    )
    async with stdio_client(params) as (read, write):
        async with ClientSession(read, write) as session:
            await session.initialize()
            yield McpClient(session)


# --- OpenAI tool bridge ------------------------------------------------------


def mcp_tools_to_openai(tools: list[Any]) -> list[dict[str, Any]]:
    """Convert a list of MCP tool descriptors into OpenAI tool specs."""

    openai_tools: list[dict[str, Any]] = []
    for tool in tools:
        openai_tools.append(
            {
                "type": "function",
                "function": {
                    "name": tool.name,
                    "description": tool.description or "",
                    "parameters": tool.inputSchema,
                },
            }
        )
    return openai_tools


def parse_tool_arguments(raw: str | None) -> dict[str, Any]:
    """Parse the JSON string arguments from an OpenAI tool call.

    Returns ``{}`` for empty/omitted arguments; preserves the ``path``/``payload``
    nesting verbatim for MCP.
    """

    if not raw:
        return {}
    parsed = json.loads(raw)
    if not isinstance(parsed, dict):
        raise ValueError(f"Tool arguments must be a JSON object, got: {raw!r}")
    return parsed
