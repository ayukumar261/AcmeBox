import { HttpApiBuilder } from "@effect/platform";
import { Effect, Layer } from "effect";
import { Api } from "./api.js";
import { AddressesLive } from "./modules/addresses/handlers.js";
import { AddressesRepository } from "./modules/addresses/repository.js";
import { CustomersLive } from "./modules/customers/handlers.js";
import { CustomersRepository } from "./modules/customers/repository.js";
import { MealsLive } from "./modules/meals/handlers.js";
import { MealsRepository } from "./modules/meals/repository.js";
import { PaymentMethodsLive } from "./modules/payment-methods/handlers.js";
import { PaymentMethodsRepository } from "./modules/payment-methods/repository.js";
import { PlansLive } from "./modules/plans/handlers.js";
import { PlansRepository } from "./modules/plans/repository.js";
import { SubscriptionsLive } from "./modules/subscriptions/handlers.js";
import { SubscriptionsRepository } from "./modules/subscriptions/repository.js";

// --- Handlers ----------------------------------------------------------------

const HealthLive = HttpApiBuilder.group(Api, "health", (handlers) =>
  handlers.handle("check", () =>
    Effect.succeed({ status: "ok" as const, uptime: process.uptime() }),
  ),
);

// The fully-wired API as a single Layer: every group's handlers plus the
// repositories they depend on. This is the composition root for the REST
// server (see index.ts) and is also consumed in-process by @repo/mcp, which
// turns the same Api into MCP tools. Keeping it here — separate from index.ts —
// means importing it does not start an HTTP server.
export const ApiLive = HttpApiBuilder.api(Api).pipe(
  Layer.provide(HealthLive),
  Layer.provide(CustomersLive),
  Layer.provide(AddressesLive),
  Layer.provide(PaymentMethodsLive),
  Layer.provide(PlansLive),
  Layer.provide(MealsLive),
  Layer.provide(SubscriptionsLive),
  Layer.provide(CustomersRepository.Default),
  Layer.provide(AddressesRepository.Default),
  Layer.provide(PaymentMethodsRepository.Default),
  Layer.provide(PlansRepository.Default),
  Layer.provide(MealsRepository.Default),
  Layer.provide(SubscriptionsRepository.Default),
);
