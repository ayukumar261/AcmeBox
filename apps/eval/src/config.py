"""Environment-driven configuration for the eval harness.

Nothing here hardcodes an LLM provider: the agent-under-test and the simulated
user each read their own ``*_BASE_URL`` / ``*_API_KEY`` / ``*_MODEL`` trio, so
the same task suite can be pointed at OpenAI, Anthropic's OpenAI-compatible
endpoint, a local vLLM server, etc., purely via env vars.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

# ``config.py`` lives at apps/eval/src/config.py; the repo root is three parents
# up (src -> eval -> apps -> repo).
_DEFAULT_REPO_ROOT = Path(__file__).resolve().parents[3]

# Admin connection used only to CREATE/DROP ephemeral databases. Points at the
# maintenance ``postgres`` database on the local Docker instance (host port 5433,
# per the repo's docker-compose.yml).
DEFAULT_PG_ADMIN_URL = "postgres://postgres:postgres@localhost:5433/postgres"


class ConfigError(RuntimeError):
    """Raised when a required environment variable is missing."""


@dataclass(frozen=True)
class ModelConfig:
    """OpenAI-compatible endpoint config for one conversational role."""

    base_url: str
    api_key: str
    model: str

    @classmethod
    def from_env(cls, prefix: str) -> "ModelConfig":
        """Build from ``{prefix}_BASE_URL`` / ``{prefix}_MODEL`` + ``API_KEY``.

        ``prefix`` is e.g. ``"AGENT"`` or ``"USER"``. The base URL and model are
        per-role; the API key is shared via a single ``API_KEY`` (the agent and
        user always authenticate with the same key). Raises ``ConfigError`` with
        an actionable message if any var is unset, so a misconfigured run fails
        fast instead of midway through a conversation.
        """

        missing: list[str] = []

        def require(name: str) -> str:
            value = os.environ.get(name, "").strip()
            if not value:
                missing.append(name)
            return value

        base_url = require(f"{prefix}_BASE_URL")
        model = require(f"{prefix}_MODEL")
        api_key = require("API_KEY")

        if missing:
            raise ConfigError(
                f"Missing required env var(s) for the {prefix.lower()} model: "
                + ", ".join(missing)
                + ". See apps/eval/.env.example."
            )

        return cls(base_url=base_url, api_key=api_key, model=model)


@dataclass(frozen=True)
class HarnessConfig:
    """Process-level settings shared across tasks."""

    pg_admin_url: str
    repo_root: Path

    @classmethod
    def from_env(cls) -> "HarnessConfig":
        return cls(
            pg_admin_url=os.environ.get("EVAL_PG_ADMIN_URL", DEFAULT_PG_ADMIN_URL),
            repo_root=Path(
                os.environ.get("EVAL_REPO_ROOT", str(_DEFAULT_REPO_ROOT))
            ).resolve(),
        )


def agent_model() -> ModelConfig:
    return ModelConfig.from_env("AGENT")


def user_model() -> ModelConfig:
    return ModelConfig.from_env("USER")
