import {
  type PaymentMethod,
  type PaymentMethodId,
} from "../customers/schema.js";

// Shape of a `payment_methods` row as Postgres hands it back (snake_case).
// Shared so both the payment-method endpoints and customer hydration map it
// the same way.
export interface PaymentMethodRow {
  readonly id: string;
  readonly customer_id: string;
  readonly brand: string;
  readonly last4: string;
  readonly expiry_month: number;
  readonly expiry_year: number;
  readonly created_at: Date | string;
}

export const toPaymentMethod = (row: PaymentMethodRow): PaymentMethod => ({
  id: row.id as PaymentMethodId,
  // `brand` is constrained to the Card union on the way in, so the column only
  // ever holds a valid value.
  brand: row.brand as PaymentMethod["brand"],
  last4: row.last4,
  expiryMonth: row.expiry_month,
  expiryYear: row.expiry_year,
});
