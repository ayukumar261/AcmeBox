import { Api } from "@repo/api/api";
import { Option } from "effect";
import { buildInputSchema, type EndpointSchemas } from "./schema.js";

/** Which request parts an endpoint declares, so dispatch can supply empty
 *  objects for declared-but-omitted parts (the typed client wants the key
 *  present even when a part has only optional fields, e.g. query strings). */
export interface ToolParts {
  readonly path: boolean;
  readonly urlParams: boolean;
  readonly payload: boolean;
}

/**
 * The core of this package: walk the `Api` definition and emit one descriptor
 * per endpoint. Nothing here is hand-maintained per endpoint. Add a route to
 * the REST API and it shows up here automatically on the next start.
 */

export interface DerivedTool {
  /** Unique MCP tool name, e.g. `customers_getById`. */
  readonly name: string;
  /** Short human description shown to the model. */
  readonly description: string;
  /** JSON Schema for the tool's arguments (`{ path?, urlParams?, payload? }`). */
  readonly inputSchema: Record<string, unknown>;
  /** The API group this endpoint belongs to, e.g. `customers`. */
  readonly group: string;
  /** The endpoint name within the group, e.g. `getById`. */
  readonly endpoint: string;
  /** Request parts this endpoint declares. */
  readonly parts: ToolParts;
}

// The typed reflection surface of HttpApi is heavy; at this boundary we read
// the runtime shape structurally. `groups` and `endpoints` are plain records.
interface EndpointShape extends EndpointSchemas {
  readonly name: string;
  readonly method: string;
  readonly path: unknown;
}
interface GroupShape {
  readonly identifier: string;
  readonly endpoints: Record<string, EndpointShape>;
}

const groups = (Api as unknown as { groups: Record<string, GroupShape> }).groups;

export const deriveTools = (): DerivedTool[] => {
  const tools: DerivedTool[] = [];
  for (const group of Object.values(groups)) {
    for (const ep of Object.values(group.endpoints)) {
      tools.push({
        name: `${group.identifier}_${ep.name}`,
        description: `${ep.method} ${String(ep.path)} (group: ${group.identifier}, endpoint: ${ep.name})`,
        inputSchema: buildInputSchema(ep),
        group: group.identifier,
        endpoint: ep.name,
        parts: {
          path: Option.isSome(ep.pathSchema),
          urlParams: Option.isSome(ep.urlParamsSchema),
          payload: Option.isSome(ep.payloadSchema),
        },
      });
    }
  }
  return tools;
};
