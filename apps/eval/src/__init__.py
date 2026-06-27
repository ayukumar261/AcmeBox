"""AcmeBox evaluation harness.

A tau-bench-style benchmark: each task spins up an ephemeral PostgreSQL database,
seeds it, points the AcmeBox MCP server at it, runs an agent<->simulated-user
conversation, and grades the *end state* of the database plus the required tool
calls. See ``cli.py`` for the entry point.
"""

__all__ = ["__version__"]

__version__ = "0.1.0"
