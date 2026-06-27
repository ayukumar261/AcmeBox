import {
  HttpApi,
  HttpApiBuilder,
  HttpApiEndpoint,
  HttpApiGroup,
  HttpApiSwagger,
  HttpMiddleware,
} from "@effect/platform";
import { NodeHttpServer, NodeRuntime } from "@effect/platform-node";
import { Effect, Layer, Schema } from "effect";
import { createServer } from "node:http";

const PORT = Number(process.env.PORT ?? 3000);

// --- Schemas -----------------------------------------------------------------

const HealthResponse = Schema.Struct({
  status: Schema.Literal("ok"),
  uptime: Schema.Number,
});

// --- API definition ----------------------------------------------------------

const HealthGroup = HttpApiGroup.make("health").add(
  HttpApiEndpoint.get("check", "/health").addSuccess(HealthResponse),
);

const Api = HttpApi.make("AcmeBoxApi").add(HealthGroup);

// --- Handlers ----------------------------------------------------------------

const HealthLive = HttpApiBuilder.group(Api, "health", (handlers) =>
  handlers.handle("check", () =>
    Effect.succeed({ status: "ok" as const, uptime: process.uptime() }),
  ),
);

const ApiLive = HttpApiBuilder.api(Api).pipe(Layer.provide(HealthLive));

// --- Server ------------------------------------------------------------------

const ServerLive = HttpApiBuilder.serve(HttpMiddleware.logger).pipe(
  Layer.provide(HttpApiSwagger.layer({ path: "/docs" })),
  Layer.provide(ApiLive),
  Layer.provide(NodeHttpServer.layer(createServer, { port: PORT })),
);

Layer.launch(ServerLive).pipe(NodeRuntime.runMain);
