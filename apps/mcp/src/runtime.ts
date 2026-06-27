import {
  FetchHttpClient,
  HttpApiBuilder,
  HttpApiClient,
  HttpServer,
} from "@effect/platform";
import { Api } from "@repo/api/api";
import { ApiLive } from "@repo/api/layers";
import { Effect, Layer } from "effect";
import type { ToolParts } from "./deriver.js";

/**
 * In-process dispatch.
 *
 * The MCP server does not talk to the REST API over the network. Instead it
 * builds the API's own request handler in this process (`toWebHandler`) and
 * routes a typed client straight into it. Every tool call therefore runs the
 * exact same handler, schema validation, and error mapping as the HTTP server,
 * with no socket and no auth round-trip.
 *
 * The wiring trick: `HttpApiClient` normally issues real HTTP requests via
 * `FetchHttpClient`. We override its `Fetch` tag with a function that hands the
 * request to the in-process handler, so "fetch" never leaves the process.
 */

// Base URL is required so the typed client can build absolute request URLs.
// The host is irrelevant; the in-process handler routes purely by path.
const BASE_URL = "http://acmebox.internal";

// `toWebHandler` needs the API layer plus the platform's default services
// (HttpPlatform, FileSystem, Path, Etag). `HttpServer.layerContext` supplies
// them without standing up an actual server.
const buildHandler = () =>
  HttpApiBuilder.toWebHandler(Layer.mergeAll(ApiLive, HttpServer.layerContext));

export interface McpRuntime {
  /** Invoke an endpoint by group + endpoint name with the caller's args. */
  readonly call: (
    group: string,
    endpoint: string,
    args: Record<string, unknown>,
    parts: ToolParts,
  ) => Promise<unknown>;
  /** Tear down the in-process API runtime. */
  readonly dispose: () => Promise<void>;
}

// A client whose calls are `client[group][endpoint](args) => Effect<Success, Error>`.
type RpcClient = Record<string, Record<string, (args: unknown) => Effect.Effect<unknown, unknown>>>;

export const makeRuntime = async (): Promise<McpRuntime> => {
  const { handler, dispose } = buildHandler();

  const inProcessFetch: typeof fetch = (input, init) =>
    handler(input instanceof Request ? input : new Request(input, init));

  const InProcessHttpClient = FetchHttpClient.layer.pipe(
    Layer.provide(Layer.succeed(FetchHttpClient.Fetch, inProcessFetch)),
  );

  const client = (await Effect.runPromise(
    HttpApiClient.make(Api, { baseUrl: BASE_URL }).pipe(
      Effect.provide(InProcessHttpClient),
    ),
  )) as unknown as RpcClient;

  return {
    call: (group, endpoint, args, parts) => {
      const groupClient = client[group];
      const fn = groupClient?.[endpoint];
      if (!fn) {
        return Promise.reject(new Error(`No client method for ${group}.${endpoint}`));
      }
      // The typed client expects each declared request part to be present as an
      // object, even when the caller omitted it (e.g. an all-optional query).
      // Default declared parts to {}; schema validation still runs on the way in.
      const callArgs: Record<string, unknown> = { ...args };
      if (parts.path && callArgs["path"] == null) callArgs["path"] = {};
      if (parts.urlParams && callArgs["urlParams"] == null) callArgs["urlParams"] = {};
      if (parts.payload && callArgs["payload"] == null) callArgs["payload"] = {};
      return Effect.runPromise(fn(callArgs));
    },
    dispose,
  };
};
