"""Environment-driven configuration for the transcript flywheel.

Two things are configured here:

* **MongoDB** — where the web app writes production chat transcripts (the
  ``conversations`` collection) and where we write mined gold transcripts (the
  ``training_examples`` collection). Defaults mirror ``docker-compose.yml`` and
  ``apps/web/lib/db/mongo.ts`` so a stock local stack needs no extra config.
* **The judge/teacher model** — a strong, provider-agnostic OpenAI-compatible
  endpoint. Kept on its own ``JUDGE_*`` / ``TEACHER_*`` var trio so it can point
  at a different (stronger) model than the agent-under-test, with its own API key
  falling back to the shared ``API_KEY``.

Like the eval harness, nothing here hardcodes a provider.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

# config.py lives at apps/eval/src/flywheel/config.py; apps/eval is two parents up
# (flywheel -> src -> eval).
_EVAL_ROOT = Path(__file__).resolve().parents[2]
_ENV_FILE = _EVAL_ROOT / ".env"

# Canonical rulebook the agent is held to, shared with the eval harness.
POLICY_PATH = _EVAL_ROOT / "src" / "policy.md"

# Mongo defaults mirror docker-compose.yml + apps/web/lib/db/mongo.ts.
DEFAULT_MONGO_URI = "mongodb://mongo:mongo@localhost:27017/acmebox?authSource=admin"
DEFAULT_MONGO_DB = "acmebox"

CONVERSATIONS_COLLECTION = "conversations"
TRAINING_EXAMPLES_COLLECTION = "training_examples"

# Bump when the judge rubric/prompt changes so previously-judged transcripts can
# be recomputed (the worker re-judges any doc whose ``judge.version`` is lower).
JUDGE_VERSION = 1


class ConfigError(RuntimeError):
    """Raised when a required environment variable is missing."""


def load_env() -> None:
    """Load ``apps/eval/.env`` (simple KEY=VALUE lines), like the eval CLI.

    Mirrors ``src.cli._load_dotenv``: avoids a python-dotenv dependency and lets
    values already exported in the shell win (``setdefault``). Safe to call more
    than once.
    """

    if not _ENV_FILE.exists():
        return
    for line in _ENV_FILE.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


@dataclass(frozen=True)
class ModelConfig:
    """OpenAI-compatible endpoint config for the judge or teacher role."""

    base_url: str
    api_key: str
    model: str

    @classmethod
    def from_env(cls, prefix: str) -> "ModelConfig":
        """Build from ``{prefix}_BASE_URL`` / ``{prefix}_MODEL``.

        The API key is read from ``{prefix}_API_KEY`` and falls back to the shared
        ``API_KEY`` — handy when the judge reuses the same provider/key as the
        simulated user. Raises ``ConfigError`` listing every missing var so a
        misconfigured run fails fast.
        """

        base_url = os.environ.get(f"{prefix}_BASE_URL", "").strip()
        model = os.environ.get(f"{prefix}_MODEL", "").strip()
        api_key = (
            os.environ.get(f"{prefix}_API_KEY")
            or os.environ.get("API_KEY")
            or ""
        ).strip()

        missing = [
            name
            for name, value in (
                (f"{prefix}_BASE_URL", base_url),
                (f"{prefix}_MODEL", model),
            )
            if not value
        ]
        if missing:
            raise ConfigError(
                f"Missing required env var(s) for the {prefix.lower()} model: "
                + ", ".join(missing)
                + ". See apps/eval/.env.example."
            )

        # An empty key is legitimate for some local servers (vLLM ignores it);
        # default to "EMPTY" so the OpenAI client still sends a bearer token.
        return cls(base_url=base_url, api_key=api_key or "EMPTY", model=model)


@dataclass(frozen=True)
class MongoConfig:
    """Connection settings for the transcript store."""

    uri: str
    db: str

    @classmethod
    def from_env(cls) -> "MongoConfig":
        return cls(
            uri=os.environ.get("MONGODB_URI", DEFAULT_MONGO_URI),
            db=os.environ.get("MONGODB_DB", DEFAULT_MONGO_DB),
        )


def judge_model() -> ModelConfig:
    return ModelConfig.from_env("JUDGE")


def teacher_model() -> ModelConfig:
    """The teacher that rewrites failed transcripts (Phase 2).

    Falls back to the judge config when ``TEACHER_*`` is unset, so a single
    strong model can play both roles until you want to split them.
    """

    if os.environ.get("TEACHER_BASE_URL", "").strip():
        return ModelConfig.from_env("TEACHER")
    return judge_model()


def author_model() -> ModelConfig:
    """The model that invents new scenario personas+goals (Phase: generator).

    Falls back to the judge config when ``AUTHOR_*`` is unset, so the same strong
    model can both author scenarios and judge transcripts.
    """

    if os.environ.get("AUTHOR_BASE_URL", "").strip():
        return ModelConfig.from_env("AUTHOR")
    return judge_model()


def read_policy() -> str:
    """Return the canonical agent rulebook (``src/policy.md``)."""

    return POLICY_PATH.read_text().strip()
