"""The transcript flywheel: judge production chats, mine failures into gold
training data, and (later) train a LoRA adapter on them.

This package is deliberately decoupled from the eval harness's MCP/Postgres
machinery (``src.conversation`` / ``src.mcp`` / ``src.harness``): the judge worker
only needs an OpenAI-compatible client plus MongoDB, so importing ``src.flywheel``
never drags in the MCP SDK or psycopg. It *does* reuse the canonical rulebook
(``src/policy.md``) so the judge grades against the same policy the agent is held
to under eval.
"""
