# @repo/mcp

An MCP (Model Context Protocol) server that exposes the AcmeBox REST API as tools an AI agent can call.

## What this is

This package does not define tools by hand. It reads the same `Api` definition that the REST server uses (`@repo/api`) and turns every endpoint into one MCP tool automatically. A tool named `customers_getById` maps to the `getById` endpoint in the `customers` group, and its argument schema is generated from the endpoint's path, query, and payload schemas.

Because of that, adding an endpoint to the REST API is all you need to do. The matching tool appears the next time this server starts. There is no per-tool code to write or keep in sync.

Calls run in process. When a tool is invoked, the server builds the API's own request handler in memory and routes the call straight into it. There is no network hop and no separate API server to point at, but the call still goes through the exact same handlers, validation, and error handling as the HTTP API.

## Prerequisites

- Node 18 or newer
- pnpm
- The monorepo installed from the root: `pnpm install`

Because dispatch is in process, this server talks to the database directly, the same way the REST API does. Make sure Postgres is up and migrated before you start it:

```bash
pnpm db:up
pnpm db:migrate
```

## Running it

From the repo root:

```bash
# Run the server (reload on change)
pnpm --filter @repo/mcp dev

# Run once, no watch
pnpm --filter @repo/mcp start

# Type-check only
pnpm --filter @repo/mcp build
```

Both `dev` and `start` run the TypeScript source through `tsx`. This is on purpose: the server imports `@repo/api` across the workspace, and that package exposes its `api` and `layers` entries as source so the whole monorepo shares one toolchain. Running through `tsx` resolves those imports without a separate build step. If you later want a pre-compiled production bundle, switch `@repo/api`'s subpath exports to point at its built `dist` output and bundle from there.

The server speaks MCP over stdio. It uses stdin and stdout for protocol traffic, so all logging goes to stderr. You will see a line like `ready with N tools` on stderr once it is connected.

## Connecting an MCP client

Point any MCP client at the server as a stdio command. For a client that reads a JSON config (for example Claude Desktop), the entry looks like this:

```json
{
  "mcpServers": {
    "acmebox": {
      "command": "pnpm",
      "args": ["--filter", "@repo/mcp", "start"],
      "cwd": "/absolute/path/to/AcmeBox"
    }
  }
}
```

Make sure the database is up and migrated first (see Prerequisites), since tool calls run against it in process.

## How it stays in sync

The tool list is generated from `@repo/api` at startup. The flow is:

1. `deriver.ts` walks the `Api` groups and endpoints and produces one tool descriptor each.
2. `schema.ts` turns each endpoint's Effect schemas into the JSON Schema that the tool advertises as its input.
3. `runtime.ts` builds the in-process client and dispatches each tool call to the real handler.
4. `server.ts` and `index.ts` wire those pieces to an MCP stdio server.

So the one thing to remember: define your routes in `@repo/api` as usual, and the tools follow. If you later want to hide certain endpoints or add higher level workflow tools, layer that on top of the derived set rather than editing tools one by one.
