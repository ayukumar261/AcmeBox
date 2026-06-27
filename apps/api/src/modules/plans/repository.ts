import { SqlClient } from "@effect/sql";
import { Effect } from "effect";
import { randomUUID } from "node:crypto";
import { DatabaseLive } from "../../db/Database.js";
import {
  type CreatePlanPayload,
  type PlanId,
  type PlanListQuery,
  PlanNotFound,
  type UpdatePlanPayload,
} from "./schema.js";
import { type PlanRow, toPlan } from "./row.js";

export class PlansRepository extends Effect.Service<PlansRepository>()(
  "PlansRepository",
  {
    dependencies: [DatabaseLive],
    effect: Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      const list = (query: PlanListQuery) =>
        Effect.gen(function* () {
          // AND-combine whichever filters were supplied; none → recent plans.
          const filters = [
            query.active !== undefined
              ? sql`active = ${query.active}`
              : undefined,
            query.country !== undefined
              ? sql`country = ${query.country}`
              : undefined,
            query.currency !== undefined
              ? sql`currency = ${query.currency}`
              : undefined,
          ].filter((f) => f !== undefined);

          const where =
            filters.length > 0 ? sql`WHERE ${sql.and(filters)}` : sql``;

          const rows = yield* sql<PlanRow>`
            SELECT * FROM plans ${where} ORDER BY created_at DESC LIMIT 100
          `;
          return rows.map(toPlan);
        }).pipe(Effect.catchTag("SqlError", Effect.die));

      const findById = (id: PlanId) =>
        Effect.gen(function* () {
          const rows = yield* sql<PlanRow>`
            SELECT * FROM plans WHERE id = ${id}
          `;
          const row = rows[0];
          if (row === undefined) {
            return yield* new PlanNotFound({ planId: id });
          }
          return toPlan(row);
        }).pipe(Effect.catchTag("SqlError", Effect.die));

      const create = (payload: CreatePlanPayload) =>
        Effect.gen(function* () {
          const id = `plan_${randomUUID()}`;
          yield* sql`
            INSERT INTO plans
              (id, name, meals_per_week, servings_per_meal, currency, country,
               price_per_serving, active)
            VALUES (
              ${id}, ${payload.name}, ${payload.mealsPerWeek},
              ${payload.servingsPerMeal}, ${payload.currency}, ${payload.country},
              ${payload.pricePerServing},
              ${payload.active ?? true}
            )
          `;
          const rows = yield* sql<PlanRow>`
            SELECT * FROM plans WHERE id = ${id}
          `;
          return toPlan(rows[0]!);
        }).pipe(Effect.catchTag("SqlError", Effect.die));

      const update = (id: PlanId, patch: UpdatePlanPayload) =>
        Effect.gen(function* () {
          const rows = yield* sql<PlanRow>`
            SELECT * FROM plans WHERE id = ${id}
          `;
          const row = rows[0];
          if (row === undefined) {
            return yield* new PlanNotFound({ planId: id });
          }

          // Only `active` is mutable; config + price are pinned for life.
          yield* sql`
            UPDATE plans SET
              active     = ${patch.active ?? row.active},
              updated_at = now()
            WHERE id = ${id}
          `;

          const updated = yield* sql<PlanRow>`
            SELECT * FROM plans WHERE id = ${id}
          `;
          return toPlan(updated[0]!);
        }).pipe(Effect.catchTag("SqlError", Effect.die));

      return { list, findById, create, update } as const;
    }),
  },
) {}
