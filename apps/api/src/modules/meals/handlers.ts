import { HttpApiBuilder } from "@effect/platform";
import { Effect } from "effect";
import { Api } from "../../api.js";
import { MealsRepository } from "./repository.js";

export const MealsLive = HttpApiBuilder.group(Api, "meals", (handlers) =>
  Effect.gen(function* () {
    const meals = yield* MealsRepository;
    return handlers
      .handle("list", ({ urlParams }) => meals.list(urlParams))
      .handle("getById", ({ path }) => meals.findById(path.mealId))
      .handle("create", ({ payload }) => meals.create(payload));
  }),
);
