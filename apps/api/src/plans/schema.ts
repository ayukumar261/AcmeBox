import { Schema } from "effect";

// --- Scalars -----------------------------------------------------------------

/** ISO 8601 in UTC, e.g. "2026-06-27T18:30:00Z". A plain string on the wire. */
const IsoTimestamp = Schema.String;

/** ISO 3166-1 alpha-2, e.g. "US". */
const CountryCode = Schema.String;

// --- Branded ID --------------------------------------------------------------

export const PlanId = Schema.String.pipe(Schema.brand("PlanId"));
export type PlanId = typeof PlanId.Type;

// --- Enums -------------------------------------------------------------------

/** ISO 4217. Closed set on purpose — one per launch market. Widen as you grow. */
export const Currency = Schema.Literal("USD", "EUR", "GBP", "CAD", "AUD");
export type Currency = typeof Currency.Type;

// The two config dimensions price scales on. Co-located with Plan (rather than
// in subscriptions/) so the runtime Schema modules stay acyclic — subscriptions
// imports PlanId from here, never the other way around.

/** Recipes shipped per week. */
export const MealsPerWeek = Schema.Literal(2, 3, 4, 5);
export type MealsPerWeek = typeof MealsPerWeek.Type;

/** Servings per recipe. */
export const ServingsPerMeal = Schema.Literal(2, 4);
export type ServingsPerMeal = typeof ServingsPerMeal.Type;

/**
 * Money in minor units (cents) as an integer — never a float. Box total =
 * pricePerServing × mealsPerWeek × servingsPerMeal + shippingFee stays exact.
 */
const Money = Schema.Number;

/** Minor-unit money accepted from clients: a non-negative integer. */
const MoneyInput = Schema.Number.pipe(Schema.int(), Schema.nonNegative());

// --- Canonical record --------------------------------------------------------

export const Plan = Schema.Struct({
  id: PlanId,
  name: Schema.String,

  mealsPerWeek: MealsPerWeek,
  servingsPerMeal: ServingsPerMeal,

  currency: Currency,
  country: CountryCode,
  pricePerServing: Money,
  shippingFee: Money,

  active: Schema.Boolean,

  updatedAt: IsoTimestamp,
  createdAt: IsoTimestamp,
});
export type Plan = typeof Plan.Type;

// --- Request payloads --------------------------------------------------------

/** Fields accepted when adding a plan to the catalog. Timestamps are
 *  server-controlled; `active` defaults to true (new plans are sellable). */
export const CreatePlanPayload = Schema.Struct({
  name: Schema.String,
  mealsPerWeek: MealsPerWeek,
  servingsPerMeal: ServingsPerMeal,
  currency: Currency,
  country: CountryCode,
  pricePerServing: MoneyInput,
  shippingFee: MoneyInput,
  active: Schema.optional(Schema.Boolean),
});
export type CreatePlanPayload = typeof CreatePlanPayload.Type;

/** Config and price are immutable once a plan ships — only the retirement flag
 *  flips. Send `active` to retire (false) or re-list (true); omit for a no-op. */
export const UpdatePlanPayload = Schema.Struct({
  active: Schema.optional(Schema.Boolean),
});
export type UpdatePlanPayload = typeof UpdatePlanPayload.Type;

/** Catalog filters for `GET /plans` — AND-combined; no filter → recent plans. */
export const PlanListQuery = Schema.Struct({
  active: Schema.optional(Schema.BooleanFromString),
  country: Schema.optional(CountryCode),
  currency: Schema.optional(Currency),
});
export type PlanListQuery = typeof PlanListQuery.Type;

// --- Errors ------------------------------------------------------------------

export class PlanNotFound extends Schema.TaggedError<PlanNotFound>()(
  "PlanNotFound",
  { planId: Schema.String },
) {}
