import { SqlClient } from "@effect/sql";
import { Effect } from "effect";

// Each migration is a `.ts` module that default-exports an Effect using the
// `SqlClient`. Files are applied in ascending numeric order and recorded in the
// `effect_sql_migrations` table, so each runs exactly once.
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE IF NOT EXISTS health_checks (
      id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      status      text NOT NULL,
      checked_at  timestamptz NOT NULL DEFAULT now()
    )
  `;
});
