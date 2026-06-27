import { SqlClient } from "@effect/sql";
import { Effect } from "effect";

// Shipping fee is no longer part of a plan's price model — box total is now
// pricePerServing × mealsPerWeek × servingsPerMeal. Drop the column so the
// NOT NULL constraint stops blocking inserts that no longer supply it.
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`ALTER TABLE plans DROP COLUMN IF EXISTS shipping_fee`;
});
