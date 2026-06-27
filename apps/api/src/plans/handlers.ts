import { HttpApiBuilder } from "@effect/platform";
import { Effect } from "effect";
import { Api } from "../api.js";
import { PlansRepository } from "./repository.js";

export const PlansLive = HttpApiBuilder.group(Api, "plans", (handlers) =>
  Effect.gen(function* () {
    const plans = yield* PlansRepository;
    return handlers
      .handle("list", ({ urlParams }) => plans.list(urlParams))
      .handle("getById", ({ path }) => plans.findById(path.planId))
      .handle("create", ({ payload }) => plans.create(payload))
      .handle("update", ({ path, payload }) =>
        plans.update(path.planId, payload),
      );
  }),
);
