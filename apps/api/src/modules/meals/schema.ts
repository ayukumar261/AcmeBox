import { Schema } from "effect";

// --- Scalars -----------------------------------------------------------------

/** ISO 8601 in UTC, e.g. "2026-06-27T18:30:00Z". A plain string on the wire. */
const IsoTimestamp = Schema.String;

// --- Branded ID --------------------------------------------------------------

export const MealId = Schema.String.pipe(Schema.brand("MealId"));
export type MealId = typeof MealId.Type;

// --- Canonical record --------------------------------------------------------

/** Every meal a customer could ever have selected — an append-only catalog. A
 *  meal's recipe is fixed once created (historical orders reference it as-is);
 *  the catalog only grows. Mirrors the immutability stance of `Plan`. */
export const Meal = Schema.Struct({
  id: MealId,
  name: Schema.String,

  /** Ordered steps. */
  steps: Schema.Array(Schema.String),

  /** What's needed to cook it. */
  ingredients: Schema.Array(Schema.String),

  /** Offerable this week. Retired meals stay `false` but are never deleted, so
   *  historical orders that reference them still resolve. Mirrors `Plan.active`. */
  isActive: Schema.Boolean,

  updatedAt: IsoTimestamp,
  createdAt: IsoTimestamp,
});
export type Meal = typeof Meal.Type;

// --- Request payloads --------------------------------------------------------

/** Fields accepted when adding a meal to the catalog. Timestamps are
 *  server-controlled; `isActive` defaults to true (new meals are offerable). */
export const CreateMealPayload = Schema.Struct({
  name: Schema.String,
  steps: Schema.Array(Schema.String),
  ingredients: Schema.Array(Schema.String),
  isActive: Schema.optional(Schema.Boolean),
});
export type CreateMealPayload = typeof CreateMealPayload.Type;

/** Catalog filters for `GET /meals` — no filter → recent meals. */
export const MealListQuery = Schema.Struct({
  isActive: Schema.optional(Schema.BooleanFromString),
});
export type MealListQuery = typeof MealListQuery.Type;

// --- Errors ------------------------------------------------------------------

export class MealNotFound extends Schema.TaggedError<MealNotFound>()(
  "MealNotFound",
  { mealId: Schema.String },
) {}
