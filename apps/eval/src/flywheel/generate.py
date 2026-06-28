"""Phase 6 (data source): synthesize fresh transcripts to feed the flywheel.

For each scenario: an author model writes a persona+goal grounded in a seed
fixture (``scenarios.py``); the harness provisions a fresh ephemeral DB + MCP from
that fixture's data; a Together "customer" (``USER_*``) and the Liquid agent
(``AGENT_*``) converse with real tool execution until the customer stops; the full
interleaved transcript is converted to the web app's UIMessage shape and written
to the ``conversations`` collection tagged ``source: "generated"``.

The judge worker then picks these up exactly like real web chats — no special
casing — and the rest of the flywheel (correct → export → train) follows. The eval
suite is never touched here; it stays held out for the gate.

Heavy eval imports live here (Postgres/MCP), so the worker imports this lazily.
"""

from __future__ import annotations

import asyncio
import uuid
from datetime import datetime, timezone
from typing import Any, Callable

from ..config import HarnessConfig, agent_model, user_model
from ..conversation import LLM as HarnessLLM, Conversation, run_conversation
from ..harness import create_db, drop_db, migrate, seed
from ..mcp import mcp_session
from ..tasks.models import Task
from .config import MongoConfig, author_model, read_policy
from .llm import LLM as AuthorLLM
from .mongo import Store
from .scenarios import Fixture, author_scenario, load_fixtures
from .transcript import messages_openai_to_ui, render_transcript


def _provision(cfg: HarnessConfig, seed_data: Any) -> tuple[str, str]:
    """Create + migrate + seed a fresh DB; drop it and re-raise on failure."""

    name, url = create_db(cfg)
    try:
        migrate(cfg, url)
        seed(url, seed_data)
    except BaseException:
        drop_db(cfg, name)
        raise
    return name, url


async def _run_scenario(
    cfg: HarnessConfig, task: Task, agent: HarnessLLM, user: HarnessLLM
) -> Conversation:
    """One scenario: fresh DB + MCP, run the conversation, tear down. No grading."""

    name, db_url = await asyncio.to_thread(_provision, cfg, task.seed)
    try:
        async with mcp_session(cfg, db_url) as mcp:
            return await run_conversation(task, mcp, agent, user)
    finally:
        await asyncio.to_thread(drop_db, cfg, name)


def build_doc(task: Task, goal: str, fixture: Fixture, convo: Conversation, now: datetime) -> dict[str, Any]:
    """Shape a generated transcript like a web-chat ``conversations`` document."""

    ui = messages_openai_to_ui(convo.messages)
    tool_calls = sum(
        1
        for m in ui
        for p in m["parts"]
        if isinstance(p.get("type"), str) and p["type"].startswith("tool-")
    )
    return {
        "conversationId": str(uuid.uuid4()),
        "source": "generated",
        "scenario": {
            "fixture": fixture.id,
            "goal": goal,
            "taskId": task.id,
            "customerId": fixture.customer_id,
        },
        "customerId": fixture.customer_id,
        "startedAt": now,
        "endedAt": now,
        "messageCount": len(ui),
        "toolCallCount": tool_calls,
        "messages": ui,
        "transcriptText": render_transcript(ui),
        "judged": False,
        "createdAt": now,
        "updatedAt": now,
    }


def generate(
    store: Store,
    cfg: HarnessConfig,
    *,
    count: int,
    concurrency: int = 3,
    fixtures: list[Fixture] | None = None,
    now: datetime | None = None,
    dry_run: bool = False,
    on_author: Callable[[int, str], None] | None = None,
    on_done: Callable[[dict[str, Any]], None] | None = None,
) -> list[dict[str, Any]]:
    """Author ``count`` scenarios, run them concurrently, store the transcripts."""

    policy = read_policy()
    author = AuthorLLM(author_model())
    agent = HarnessLLM(agent_model())
    user = HarnessLLM(user_model())
    pool = fixtures if fixtures is not None else load_fixtures()
    stamp = now or datetime.now(timezone.utc)

    # 1) Author scenarios (sequential — cheap vs. the conversation runs, and the
    #    ordered index nudges variety). One bad author call skips that scenario.
    scenarios: list[tuple[Task, str, Fixture]] = []
    for i in range(count):
        fixture = pool[i % len(pool)]
        try:
            task, goal = author_scenario(author, fixture, policy, index=i)
        except Exception as exc:  # noqa: BLE001
            print(f"[author error] {fixture.id} #{i + 1}: {exc}")
            continue
        scenarios.append((task, goal, fixture))
        if on_author:
            on_author(i, goal)

    # 2) Run the conversations concurrently — each its own ephemeral DB + MCP.
    async def _run_all() -> list[dict[str, Any] | None]:
        sem = asyncio.Semaphore(concurrency)

        async def one(task: Task, goal: str, fixture: Fixture) -> dict[str, Any] | None:
            async with sem:
                try:
                    convo = await _run_scenario(cfg, task, agent, user)
                except Exception as exc:  # noqa: BLE001
                    print(f"[run error] {task.id}: {exc}")
                    return None
            return build_doc(task, goal, fixture, convo, stamp)

        return await asyncio.gather(*(one(t, g, f) for t, g, f in scenarios))

    docs = [d for d in asyncio.run(_run_all()) if d]

    if not dry_run and docs:
        store.conversations.insert_many(docs)
    if on_done:
        for d in docs:
            on_done(d)
    return docs
