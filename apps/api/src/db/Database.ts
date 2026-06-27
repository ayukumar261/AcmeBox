import { PgClient } from "@effect/sql-pg";
import { Config, Redacted } from "effect";

// Defaults match the local Docker Compose Postgres in `docker-compose.yml`
// (host port 5433, db `acmebox`, user/password `postgres`). Set `DATABASE_URL`
// to point at any other instance — that always wins over the default.
const DEFAULT_DATABASE_URL =
  "postgres://postgres:postgres@localhost:5433/acmebox";

// The Postgres client layer. Providing this makes both `PgClient` and the
// generic `SqlClient` available to any Effect in the application.
export const DatabaseLive = PgClient.layerConfig({
  url: Config.redacted("DATABASE_URL").pipe(
    Config.withDefault(Redacted.make(DEFAULT_DATABASE_URL)),
  ),
});
