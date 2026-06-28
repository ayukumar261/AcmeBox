import { NodeContext, NodeRuntime } from "@effect/platform-node";
import { Effect } from "effect";
import { DatabaseLive } from "../db/Database.js";
import { seedProgram } from "../db/seed/run.js";

// Standalone runner: wipes the app tables and loads deterministic dev data,
// then exits. Mirrors `bin/migrate.ts`.
//   pnpm --filter @repo/api db:seed        (dev, via tsx)
//   pnpm --filter @repo/api db:seed:prod   (after `pnpm build`)
//   SEED_CUSTOMERS=250 pnpm --filter @repo/api db:seed   (scale the volume)
seedProgram.pipe(
  Effect.provide(DatabaseLive),
  Effect.provide(NodeContext.layer),
  NodeRuntime.runMain,
);
