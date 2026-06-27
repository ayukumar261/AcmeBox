import {
  HttpApiBuilder,
  HttpApiSwagger,
  HttpMiddleware,
} from "@effect/platform";
import { NodeHttpServer, NodeRuntime } from "@effect/platform-node";
import { Effect, Layer } from "effect";
import { createServer } from "node:http";
import { Api } from "./api.js";
import { CustomersLive } from "./customers/handlers.js";
import { CustomersRepository } from "./customers/repository.js";

const PORT = Number(process.env.PORT ?? 3000);

// --- Handlers ----------------------------------------------------------------

const HealthLive = HttpApiBuilder.group(Api, "health", (handlers) =>
  handlers.handle("check", () =>
    Effect.succeed({ status: "ok" as const, uptime: process.uptime() }),
  ),
);

const ApiLive = HttpApiBuilder.api(Api).pipe(
  Layer.provide(HealthLive),
  Layer.provide(CustomersLive),
  Layer.provide(CustomersRepository.Default),
);

// --- Server ------------------------------------------------------------------

const ServerLive = HttpApiBuilder.serve(HttpMiddleware.logger).pipe(
  Layer.provide(HttpApiSwagger.layer({ path: "/docs" })),
  Layer.provide(ApiLive),
  Layer.provide(NodeHttpServer.layer(createServer, { port: PORT })),
);

Layer.launch(ServerLive).pipe(NodeRuntime.runMain);
