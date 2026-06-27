import { SqlClient } from "@effect/sql";
import { Effect } from "effect";

// Meals are catalog data — every meal a customer could ever have selected, kept
// for the whole life of the company. Append-only: a meal's recipe is fixed once
// created (historical orders reference it as-is) and rows are never deleted;
// only `is_active` distinguishes what's currently offerable. Mirrors `plans`.
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE IF NOT EXISTS meals (
      id           text PRIMARY KEY,
      name         text NOT NULL,

      steps        text[] NOT NULL,
      ingredients  text[] NOT NULL,

      is_active    boolean NOT NULL DEFAULT true,

      created_at   timestamptz NOT NULL DEFAULT now(),
      updated_at   timestamptz NOT NULL DEFAULT now()
    )
  `;

  // The catalog is browsed by live status, so index it.
  yield* sql`
    CREATE INDEX IF NOT EXISTS meals_is_active_idx
      ON meals (is_active)
  `;
});
