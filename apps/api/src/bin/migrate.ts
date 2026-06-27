import { NodeContext, NodeRuntime } from "@effect/platform-node";
import { PgMigrator } from "@effect/sql-pg";
import { Effect } from "effect";
import { DatabaseLive } from "../db/Database.js";
import { migratorOptions } from "../db/Migrator.js";

// Standalone runner: applies pending migrations then exits.
//   pnpm --filter @repo/api db:migrate        (dev, via tsx)
//   pnpm --filter @repo/api db:migrate:prod   (after `pnpm build`)
const program = PgMigrator.run(migratorOptions).pipe(
  Effect.tap((applied) =>
    Effect.log(
      applied.length === 0
        ? "Database is up to date — no migrations to apply"
        : `Applied ${applied.length} migration(s): ${applied
            .map(([id, name]) => `${id}_${name}`)
            .join(", ")}`,
    ),
  ),
);

program.pipe(
  Effect.provide(DatabaseLive),
  Effect.provide(NodeContext.layer),
  NodeRuntime.runMain,
);
