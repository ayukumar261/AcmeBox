# AcmeBox Eval Harness

A [tau-bench](https://github.com/sierra-research/tau2-bench)-style benchmark for
the AcmeBox support agent. Each task:

1. spins up an **ephemeral PostgreSQL database** (a fresh DB in the local Docker
   Postgres on port 5433), migrates it with the repo's own migrations, and seeds
   it from the task file;
2. launches the AcmeBox **MCP server** (`apps/mcp`) pointed at that database;
3. runs an **agent ⇄ simulated-user** conversation (both LLMs, OpenAI-compatible);
4. grades the **end state**: the final DB rows + the required tool calls.

Grading is fully deterministic — no LLM judge. Each task can be run `k` times to
report **pass^k** (all k trials passed), tau-bench's reliability metric.

## Prerequisites

- The monorepo's Postgres running: `pnpm db:up` (from the repo root).
- `pnpm` + Node on `PATH` (the harness shells out to `pnpm --filter ...` for
  migrations and to launch the MCP server).
- [Poetry](https://python-poetry.org/) and Python ≥ 3.11.

## Setup

```bash
cd apps/eval
poetry install
cp .env.example .env   # then fill in AGENT_* and USER_* model vars
```

The agent-under-test and the simulated user have **separate base URLs and
models** (`AGENT_*` vs `USER_*`), so you can hold the user model fixed while
benchmarking different agent models. They **share one API key** (`API_KEY`).
Nothing is hardcoded to a provider — point the `*_BASE_URL` at OpenAI,
Anthropic's OpenAI-compatible endpoint, a local server, etc.

## Run an evaluation

```bash
poetry run acmebox-eval run update_default_address --k 3
```

Prints per-run check results and the final `pass^3`.

## Offline checks (no API keys needed)

```bash
poetry run pytest          # harness: create → migrate → seed → drop
poetry run pytest -m mcp   # MCP smoke test: addresses_setDefault flips the DB
```

## Adding a task

Drop a JSON file in `src/tasks/`:

- `seed` — `{table: [rows...]}` inserted into the fresh DB (FK checks relaxed
  during seed, so order doesn't matter).
- `user.instructions` — the persona/goal for the simulated customer.
- `evaluation_criteria.db_check` — expected final column values (the truth).
  Each check locates one row by `id` (primary-key shorthand) **or** `where` (an
  AND-equality match on any columns — use this when the row's id is assigned at
  runtime). `expect` maps snake_case columns to required values. An expected
  value may be a literal, or a `$ref` that resolves to another row's value:
  `{"$ref": {"table": ..., "where": {...}, "column": "id"}}` — this lets a check
  assert a cross-row link, e.g. that a customer's `default_address_id` points at
  a just-created address. A `where`/`$ref` lookup must match exactly one row. To
  assert a row was **deleted**, set `"absent": true` (with no `expect`) — the
  check passes only if no row matches.
- `evaluation_criteria.tools` — required tool calls (subset-matched, including
  the nested `path`/`payload` shape MCP tools use).

See `tasks/update_default_address.json` for a worked example, and
`tasks/add_new_default_address.json` for `where` + `$ref` in action.
