import { SqlClient } from "@effect/sql";
import { Effect } from "effect";
import { randomUUID } from "node:crypto";
import { DatabaseLive } from "../../db/Database.js";
import {
  type CreateMealPayload,
  type MealId,
  type MealListQuery,
  MealNotFound,
} from "./schema.js";
import { type MealRow, toMeal } from "./row.js";

export class MealsRepository extends Effect.Service<MealsRepository>()(
  "MealsRepository",
  {
    dependencies: [DatabaseLive],
    effect: Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      const list = (query: MealListQuery) =>
        Effect.gen(function* () {
          // AND-combine whichever filters were supplied; none → recent meals.
          const filters = [
            query.isActive !== undefined
              ? sql`is_active = ${query.isActive}`
              : undefined,
          ].filter((f) => f !== undefined);

          const where =
            filters.length > 0 ? sql`WHERE ${sql.and(filters)}` : sql``;

          const rows = yield* sql<MealRow>`
            SELECT * FROM meals ${where} ORDER BY created_at DESC LIMIT 100
          `;
          return rows.map(toMeal);
        }).pipe(Effect.catchTag("SqlError", Effect.die));

      const findById = (id: MealId) =>
        Effect.gen(function* () {
          const rows = yield* sql<MealRow>`
            SELECT * FROM meals WHERE id = ${id}
          `;
          const row = rows[0];
          if (row === undefined) {
            return yield* new MealNotFound({ mealId: id });
          }
          return toMeal(row);
        }).pipe(Effect.catchTag("SqlError", Effect.die));

      const create = (payload: CreateMealPayload) =>
        Effect.gen(function* () {
          const id = `meal_${randomUUID()}`;
          // `steps` / `ingredients` bind as single params; pg serializes each
          // JS array into a Postgres text[].
          yield* sql`
            INSERT INTO meals
              (id, name, steps, ingredients, is_active)
            VALUES (
              ${id}, ${payload.name}, ${payload.steps}, ${payload.ingredients},
              ${payload.isActive ?? true}
            )
          `;
          const rows = yield* sql<MealRow>`
            SELECT * FROM meals WHERE id = ${id}
          `;
          return toMeal(rows[0]!);
        }).pipe(Effect.catchTag("SqlError", Effect.die));

      return { list, findById, create } as const;
    }),
  },
) {}
