import {
  HttpApiBuilder,
  HttpApiSwagger,
  HttpMiddleware,
} from "@effect/platform";
import { NodeHttpServer, NodeRuntime } from "@effect/platform-node";
import { Effect, Layer } from "effect";
import { createServer } from "node:http";
import { Api } from "./api.js";
import { AddressesLive } from "./modules/addresses/handlers.js";
import { AddressesRepository } from "./modules/addresses/repository.js";
import { CustomersLive } from "./modules/customers/handlers.js";
import { CustomersRepository } from "./modules/customers/repository.js";
import { PaymentMethodsLive } from "./modules/payment-methods/handlers.js";
import { PaymentMethodsRepository } from "./modules/payment-methods/repository.js";
import { PlansLive } from "./modules/plans/handlers.js";
import { PlansRepository } from "./modules/plans/repository.js";
import { SubscriptionsLive } from "./modules/subscriptions/handlers.js";
import { SubscriptionsRepository } from "./modules/subscriptions/repository.js";

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
  Layer.provide(AddressesLive),
  Layer.provide(PaymentMethodsLive),
  Layer.provide(PlansLive),
  Layer.provide(SubscriptionsLive),
  Layer.provide(CustomersRepository.Default),
  Layer.provide(AddressesRepository.Default),
  Layer.provide(PaymentMethodsRepository.Default),
  Layer.provide(PlansRepository.Default),
  Layer.provide(SubscriptionsRepository.Default),
);

// --- Server ------------------------------------------------------------------

const ServerLive = HttpApiBuilder.serve(HttpMiddleware.logger).pipe(
  Layer.provide(HttpApiSwagger.layer({ path: "/docs" })),
  Layer.provide(ApiLive),
  Layer.provide(NodeHttpServer.layer(createServer, { port: PORT })),
);

Layer.launch(ServerLive).pipe(NodeRuntime.runMain);
