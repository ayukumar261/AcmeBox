import { HttpApiBuilder } from "@effect/platform";
import { Effect } from "effect";
import { Api } from "../../api.js";
import { SubscriptionsRepository } from "./repository.js";

export const SubscriptionsLive = HttpApiBuilder.group(
  Api,
  "subscriptions",
  (handlers) =>
    Effect.gen(function* () {
      const subscriptions = yield* SubscriptionsRepository;
      return handlers
        .handle("list", ({ urlParams }) => subscriptions.list(urlParams))
        .handle("getById", ({ path }) =>
          subscriptions.findById(path.subscriptionId),
        )
        .handle("create", ({ payload }) => subscriptions.create(payload))
        .handle("update", ({ path, payload }) =>
          subscriptions.update(path.subscriptionId, payload),
        );
    }),
);
