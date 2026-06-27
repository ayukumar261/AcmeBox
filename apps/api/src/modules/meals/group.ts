import { HttpApiEndpoint, HttpApiGroup } from "@effect/platform";
import { Schema } from "effect";
import {
  CreateMealPayload,
  Meal,
  MealId,
  MealListQuery,
  MealNotFound,
} from "./schema.js";

const MealPath = Schema.Struct({ mealId: MealId });

export const MealsGroup = HttpApiGroup.make("meals")
  // GET /meals?isActive= — browse the catalog.
  .add(
    HttpApiEndpoint.get("list", "/meals")
      .setUrlParams(MealListQuery)
      .addSuccess(Schema.Array(Meal)),
  )
  // GET /meals/:mealId — a single catalog entry.
  .add(
    HttpApiEndpoint.get("getById", "/meals/:mealId")
      .setPath(MealPath)
      .addSuccess(Meal)
      .addError(MealNotFound, { status: 404 }),
  )
  // POST /meals — add a meal to the catalog.
  .add(
    HttpApiEndpoint.post("create", "/meals")
      .setPayload(CreateMealPayload)
      .addSuccess(Meal, { status: 201 }),
  );
