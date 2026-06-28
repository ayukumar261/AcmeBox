"""Ephemeral PostgreSQL lifecycle for a single eval run.

An "ephemeral instance" is just a freshly created database inside the existing
local Postgres (the Docker container on host port 5433). For each run we:

    create_db -> migrate -> seed -> (caller runs the conversation) -> drop_db

Migration reuses the repo's own tooling (``pnpm --filter @repo/api db:migrate``)
with ``DATABASE_URL`` overridden, so the schema can never drift from production.
"""

from __future__ import annotations

import os
import subprocess
import uuid
from collections.abc import Iterator, Mapping, Sequence
from contextlib import contextmanager
from typing import Any
from urllib.parse import urlsplit, urlunsplit

import psycopg
from psycopg import sql
from psycopg.types.json import Jsonb

from .config import HarnessConfig

# Tables are seeded in this order so plain INSERTs satisfy FKs where possible.
# customers <-> addresses is a *circular* FK (customers.default_address_id and
# addresses.customer_id), so seeding runs with FK triggers disabled regardless
# (see ``seed``); this ordering just keeps things tidy and deterministic. Mirrors
# the app seed's order (apps/api/src/db/seed/run.ts): parents before children.
_SEED_TABLE_ORDER = [
    "customers",
    "addresses",
    "payment_methods",
    "plans",
    "subscriptions",
    "meals",
    "orders",
    "payments",
    "health_checks",
]


def _db_url(admin_url: str, db_name: str) -> str:
    """Return ``admin_url`` with its database path swapped for ``db_name``."""

    parts = urlsplit(admin_url)
    return urlunsplit(parts._replace(path=f"/{db_name}"))


def create_db(cfg: HarnessConfig) -> tuple[str, str]:
    """Create a uniquely named empty database. Returns ``(name, url)``."""

    name = f"eval_{uuid.uuid4().hex[:8]}"
    with psycopg.connect(cfg.pg_admin_url, autocommit=True) as conn:
        conn.execute(sql.SQL("CREATE DATABASE {}").format(sql.Identifier(name)))
    return name, _db_url(cfg.pg_admin_url, name)


def drop_db(cfg: HarnessConfig, name: str) -> None:
    """Drop the database, terminating any lingering connections (FORCE)."""

    with psycopg.connect(cfg.pg_admin_url, autocommit=True) as conn:
        conn.execute(
            sql.SQL("DROP DATABASE IF EXISTS {} WITH (FORCE)").format(
                sql.Identifier(name)
            )
        )


def migrate(cfg: HarnessConfig, db_url: str) -> None:
    """Apply all migrations to ``db_url`` via the repo's migrate script."""

    env = {**os.environ, "DATABASE_URL": db_url}
    subprocess.run(
        ["pnpm", "--filter", "@repo/api", "db:migrate"],
        cwd=str(cfg.repo_root),
        env=env,
        check=True,
    )


def seed(db_url: str, data: Mapping[str, Sequence[Mapping[str, Any]]]) -> None:
    """Insert seed rows from a ``{table: [row, ...]}`` mapping.

    FK constraint triggers are disabled for the transaction
    (``session_replication_role = replica``) so the circular customers/addresses
    references can be inserted in any order without ordering gymnastics. The
    ``postgres`` superuser in the Docker image is allowed to set this.
    """

    ordered = sorted(
        data.items(),
        key=lambda kv: _SEED_TABLE_ORDER.index(kv[0])
        if kv[0] in _SEED_TABLE_ORDER
        else len(_SEED_TABLE_ORDER),
    )

    with psycopg.connect(db_url) as conn:
        with conn.transaction():
            conn.execute("SET session_replication_role = replica")
            for table, rows in ordered:
                for row in rows:
                    _insert_row(conn, table, row)
            conn.execute("SET session_replication_role = DEFAULT")


def _adapt(value: Any) -> Any:
    """Coerce a seed value into something psycopg can bind.

    A ``jsonb`` column (the only one in the schema is ``orders.items``) arrives
    from the task JSON as a dict or a list-of-dicts, which psycopg can't adapt on
    its own — wrap those in ``Jsonb`` so they serialize as JSON. A list of scalars
    (the ``text[]`` columns ``meals.steps`` / ``meals.ingredients``) is left alone,
    since psycopg already maps it to a Postgres array.
    """

    if isinstance(value, dict):
        return Jsonb(value)
    if isinstance(value, list) and any(isinstance(item, dict) for item in value):
        return Jsonb(value)
    return value


def _insert_row(
    conn: psycopg.Connection, table: str, row: Mapping[str, Any]
) -> None:
    columns = list(row.keys())
    stmt = sql.SQL("INSERT INTO {table} ({cols}) VALUES ({vals})").format(
        table=sql.Identifier(table),
        cols=sql.SQL(", ").join(sql.Identifier(c) for c in columns),
        vals=sql.SQL(", ").join(sql.Placeholder() for _ in columns),
    )
    conn.execute(stmt, [_adapt(row[c]) for c in columns])


@contextmanager
def ephemeral_db(
    cfg: HarnessConfig, seed_data: Mapping[str, Sequence[Mapping[str, Any]]]
) -> Iterator[str]:
    """Create + migrate + seed a database, yield its URL, and always drop it."""

    name, url = create_db(cfg)
    try:
        migrate(cfg, url)
        seed(url, seed_data)
        yield url
    finally:
        drop_db(cfg, name)
