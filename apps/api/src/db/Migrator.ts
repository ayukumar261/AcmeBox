import { PgMigrator } from "@effect/sql-pg";
import { NodeContext } from "@effect/platform-node";
import { Layer } from "effect";
import { fileURLToPath } from "node:url";

// Resolved relative to *this* module, so it works both under `tsx` (points at
// `src/db/migrations` with `.ts` files) and after `tsc` (points at
// `dist/db/migrations` with the compiled `.js` files).
const migrationsDirectory = fileURLToPath(
  new URL("migrations", import.meta.url),
);

// Shared options consumed by both the layer below and the `bin/migrate` CLI.
// To also dump a `_schema.sql` snapshot after migrating, add
// `schemaDirectory: migrationsDirectory` — that requires `pg_dump` on PATH.
export const migratorOptions = {
  loader: PgMigrator.fromFileSystem(migrationsDirectory),
};

// Applies any pending migrations when this layer is built. Requires a
// `DatabaseLive` (PgClient) to be provided alongside it. The filesystem +
// command executor it needs are supplied here via `NodeContext`.
export const MigratorLive = PgMigrator.layer(migratorOptions).pipe(
  Layer.provide(NodeContext.layer),
);
