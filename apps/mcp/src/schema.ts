import { JSONSchema, Option, type Schema } from "effect";

/**
 * Effect Schema -> JSON Schema helpers.
 *
 * Kept separate from the deriver so the schema translation can be unit-tested
 * in isolation. Nothing here knows about MCP or the API; it only turns the
 * Effect schemas attached to an endpoint into the JSON Schema shape that an
 * MCP tool's `inputSchema` expects.
 */

// JSON Schema is an open-ended object; we only ever read/copy a few keys.
type Json = Record<string, unknown>;

/** A JSON Schema with no input schema at all (endpoint takes nothing). */
const EMPTY_INPUT: Json = {
  type: "object",
  properties: {},
  additionalProperties: false,
};

const toJson = (schema: Option.Option<Schema.Schema<unknown, unknown, never>>): Json | undefined =>
  Option.match(schema, {
    onNone: () => undefined,
    // Cast: JSONSchema.make is happy with any schema; the `never` context
    // bound is satisfied because endpoint schemas carry no requirements.
    onSome: (s) => JSONSchema.make(s as Schema.Schema<unknown>) as unknown as Json,
  });

/**
 * Pull any `$defs` block out of a sub-schema and merge it into a shared root
 * `$defs`, so that `$ref: "#/$defs/X"` pointers still resolve once the
 * sub-schema is nested under a property. Also strips the per-schema `$schema`
 * marker, which is meaningless on a nested fragment.
 */
const hoistDefs = (schema: Json, rootDefs: Json): Json => {
  const copy: Json = { ...schema };
  const defs = copy["$defs"];
  if (defs && typeof defs === "object") {
    Object.assign(rootDefs, defs as Json);
    delete copy["$defs"];
  }
  delete copy["$schema"];
  return copy;
};

export interface EndpointSchemas {
  readonly pathSchema: Option.Option<Schema.Schema<unknown, unknown, never>>;
  readonly urlParamsSchema: Option.Option<Schema.Schema<unknown, unknown, never>>;
  readonly payloadSchema: Option.Option<Schema.Schema<unknown, unknown, never>>;
}

/**
 * Build a single JSON Schema object for an endpoint's inputs. The shape mirrors
 * the typed client call: `{ path?, urlParams?, payload? }`, where each present
 * key carries the JSON Schema derived from that part of the endpoint. Path and
 * payload are required when present; url params are always optional (query
 * strings are optional by convention).
 */
export const buildInputSchema = (ep: EndpointSchemas): Json => {
  const properties: Json = {};
  const required: string[] = [];
  const rootDefs: Json = {};

  const path = toJson(ep.pathSchema);
  if (path) {
    properties["path"] = hoistDefs(path, rootDefs);
    required.push("path");
  }

  const urlParams = toJson(ep.urlParamsSchema);
  if (urlParams) {
    properties["urlParams"] = hoistDefs(urlParams, rootDefs);
  }

  const payload = toJson(ep.payloadSchema);
  if (payload) {
    properties["payload"] = hoistDefs(payload, rootDefs);
    required.push("payload");
  }

  if (Object.keys(properties).length === 0) return EMPTY_INPUT;

  const schema: Json = {
    type: "object",
    properties,
    additionalProperties: false,
  };
  if (required.length > 0) schema["required"] = required;
  if (Object.keys(rootDefs).length > 0) schema["$defs"] = rootDefs;
  return schema;
};
