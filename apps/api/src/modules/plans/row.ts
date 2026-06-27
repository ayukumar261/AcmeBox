import {
  type Currency,
  type MealsPerWeek,
  type Plan,
  type PlanId,
  type ServingsPerMeal,
} from "./schema.js";

// Shape of a `plans` row as Postgres hands it back (snake_case columns).
export interface PlanRow {
  readonly id: string;
  readonly name: string;
  readonly meals_per_week: number;
  readonly servings_per_meal: number;
  readonly currency: string;
  readonly country: string;
  readonly price_per_serving: number;
  readonly shipping_fee: number;
  readonly active: boolean;
  readonly created_at: Date | string;
  readonly updated_at: Date | string;
}

const toIso = (value: Date | string): string =>
  (value instanceof Date ? value : new Date(value)).toISOString();

// The literal-union columns (currency / meals / servings) are constrained to
// valid values on the way in, so the columns only ever hold a member of the set.
export const toPlan = (row: PlanRow): Plan => ({
  id: row.id as PlanId,
  name: row.name,
  mealsPerWeek: row.meals_per_week as MealsPerWeek,
  servingsPerMeal: row.servings_per_meal as ServingsPerMeal,
  currency: row.currency as Currency,
  country: row.country,
  pricePerServing: row.price_per_serving,
  shippingFee: row.shipping_fee,
  active: row.active,
  updatedAt: toIso(row.updated_at),
  createdAt: toIso(row.created_at),
});
