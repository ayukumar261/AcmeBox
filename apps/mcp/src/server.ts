import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import type { DerivedTool } from "./deriver.js";

/**
 * Builds the MCP server from a set of derived tools and a dispatch function.
 *
 * Uses the low-level `Server` (rather than the high-level `McpServer`) because
 * our input schemas are JSON Schema produced from Effect Schema, which the
 * low-level tool-listing API accepts directly without a Zod round-trip.
 */

export type Dispatch = (
  tool: DerivedTool,
  args: Record<string, unknown>,
) => Promise<unknown>;

export const makeServer = (tools: readonly DerivedTool[], dispatch: Dispatch): Server => {
  const byName = new Map(tools.map((t) => [t.name, t]));

  const server = new Server(
    { name: "acmebox", version: "0.0.0" },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: tools.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const tool = byName.get(request.params.name);
    if (!tool) {
      return {
        isError: true,
        content: [{ type: "text", text: `Unknown tool: ${request.params.name}` }],
      };
    }
    try {
      const result = await dispatch(tool, request.params.arguments ?? {});
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { isError: true, content: [{ type: "text", text: message }] };
    }
  });

  return server;
};
