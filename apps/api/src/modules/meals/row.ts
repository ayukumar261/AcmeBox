import { type Meal, type MealId } from "./schema.js";

// Shape of a `meals` row as Postgres hands it back (snake_case columns). The
// `steps` / `ingredients` text[] columns come back as JS string arrays.
export interface MealRow {
  readonly id: string;
  readonly name: string;
  readonly steps: readonly string[];
  readonly ingredients: readonly string[];
  readonly is_active: boolean;
  readonly created_at: Date | string;
  readonly updated_at: Date | string;
}

const toIso = (value: Date | string): string =>
  (value instanceof Date ? value : new Date(value)).toISOString();

export const toMeal = (row: MealRow): Meal => ({
  id: row.id as MealId,
  name: row.name,
  steps: row.steps,
  ingredients: row.ingredients,
  isActive: row.is_active,
  updatedAt: toIso(row.updated_at),
  createdAt: toIso(row.created_at),
});
