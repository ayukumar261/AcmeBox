import { SqlClient } from "@effect/sql";
import { Effect } from "effect";

// Plans are catalog data — the menu of buyable meal-kit configs and their
// per-market price, shared across all customers. Immutable once created (a
// Subscription pins config + price by id); only `active` flips, to retire a plan
// without disturbing the subscriptions already running on it.
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE IF NOT EXISTS plans (
      id                 text PRIMARY KEY,
      name               text NOT NULL,

      meals_per_week     integer NOT NULL,
      servings_per_meal  integer NOT NULL,

      currency           text NOT NULL,
      country            text NOT NULL,
      price_per_serving  integer NOT NULL,
      shipping_fee       integer NOT NULL,

      active             boolean NOT NULL DEFAULT true,

      created_at         timestamptz NOT NULL DEFAULT now(),
      updated_at         timestamptz NOT NULL DEFAULT now()
    )
  `;

  // The catalog is browsed by market and live status, so index that pair.
  yield* sql`
    CREATE INDEX IF NOT EXISTS plans_active_country_idx
      ON plans (active, country)
  `;
});
