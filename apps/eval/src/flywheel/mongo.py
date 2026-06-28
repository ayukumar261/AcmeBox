"""MongoDB access for the flywheel — the Python side of the store the web app
writes to.

Mirrors ``apps/web/lib/db/mongo.ts``: same default URI/db, same ``conversations``
collection. Adds a Python-side handle plus a ``training_examples`` collection for
mined gold transcripts (populated in Phase 2).
"""

from __future__ import annotations

from pymongo import ASCENDING, MongoClient
from pymongo.collection import Collection
from pymongo.database import Database

from .config import (
    CONVERSATIONS_COLLECTION,
    TRAINING_EXAMPLES_COLLECTION,
    MongoConfig,
)


class Store:
    """Thin wrapper over the AcmeBox Mongo database."""

    def __init__(self, cfg: MongoConfig) -> None:
        self._client: MongoClient = MongoClient(cfg.uri)
        self._db: Database = self._client[cfg.db]

    @property
    def conversations(self) -> Collection:
        return self._db[CONVERSATIONS_COLLECTION]

    @property
    def training_examples(self) -> Collection:
        return self._db[TRAINING_EXAMPLES_COLLECTION]

    def ensure_indexes(self) -> None:
        """Create the indexes the flywheel relies on (idempotent).

        ``judged`` powers the worker's "what's unjudged?" scan; the unique index
        on ``sourceConversationId`` keeps the corrector from minting two gold
        examples from the same failed transcript.
        """

        self.conversations.create_index([("judged", ASCENDING)])
        self.conversations.create_index([("judge.passed", ASCENDING)])
        self.training_examples.create_index(
            [("sourceConversationId", ASCENDING)], unique=True, sparse=True
        )

    def ping(self) -> None:
        """Raise if the server is unreachable (fail fast at startup)."""

        self._client.admin.command("ping")

    def close(self) -> None:
        self._client.close()
