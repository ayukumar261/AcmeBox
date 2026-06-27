import { type Address, type AddressId } from "../customers/schema.js";

// Shape of an `addresses` row as Postgres hands it back (snake_case columns).
// Shared so both the addresses endpoints and customer hydration map it the same.
export interface AddressRow {
  readonly id: string;
  readonly customer_id: string;
  readonly line1: string;
  readonly line2: string | null;
  readonly city: string;
  readonly region: string;
  readonly postal_code: string;
  readonly country: string;
  readonly delivery_notes: string | null;
  readonly created_at: Date | string;
  readonly updated_at: Date | string;
}

// Optional fields are omitted when null so the JSON stays clean.
export const toAddress = (row: AddressRow): Address => ({
  id: row.id as AddressId,
  line1: row.line1,
  ...(row.line2 !== null ? { line2: row.line2 } : {}),
  city: row.city,
  region: row.region,
  postalCode: row.postal_code,
  country: row.country,
  ...(row.delivery_notes !== null ? { deliveryNotes: row.delivery_notes } : {}),
});
