import { SqlClient } from "@effect/sql";
import { Effect } from "effect";

// Tokenized card summaries — never a full PAN. Owned by a customer
// (cascade-deleted with them). The customer's `default_payment_method_id`
// becomes a real FK with ON DELETE SET NULL, mirroring `default_address_id`.
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE IF NOT EXISTS payment_methods (
      id            text PRIMARY KEY,
      customer_id   text NOT NULL REFERENCES customers (id) ON DELETE CASCADE,

      brand         text NOT NULL,
      last4         text NOT NULL,
      expiry_month  integer NOT NULL,
      expiry_year   integer NOT NULL,

      created_at    timestamptz NOT NULL DEFAULT now()
    )
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS payment_methods_customer_id_idx
      ON payment_methods (customer_id)
  `;

  yield* sql`
    ALTER TABLE customers
      ADD CONSTRAINT customers_default_payment_method_fk
      FOREIGN KEY (default_payment_method_id) REFERENCES payment_methods (id)
      ON DELETE SET NULL
  `;
});
