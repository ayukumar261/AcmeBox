import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { deriveTools } from "./deriver.js";
import { makeRuntime } from "./runtime.js";
import { makeServer } from "./server.js";

/**
 * Entry point: derive tools from the API, stand up the in-process runtime,
 * and serve over stdio. The process speaks MCP on stdin/stdout, so anything
 * written to stdout that is not protocol traffic would corrupt the stream;
 * keep logging on stderr.
 */
const main = async (): Promise<void> => {
  const tools = deriveTools();
  const runtime = await makeRuntime();
  const server = makeServer(tools, (tool, args) =>
    runtime.call(tool.group, tool.endpoint, args, tool.parts),
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);

  console.error(`[acmebox-mcp] ready with ${tools.length} tools`);

  const shutdown = (): void => {
    void runtime.dispose().finally(() => process.exit(0));
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
};

main().catch((error) => {
  console.error("[acmebox-mcp] fatal:", error);
  process.exit(1);
});
