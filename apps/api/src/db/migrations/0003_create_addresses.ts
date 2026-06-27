import { SqlClient } from "@effect/sql";
import { Effect } from "effect";

// Addresses are owned by a customer (cascade-deleted with them). The customer's
// `default_address_id` becomes a real FK here with ON DELETE SET NULL, so
// deleting the default address clears the pointer automatically.
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE IF NOT EXISTS addresses (
      id             text PRIMARY KEY,
      customer_id    text NOT NULL REFERENCES customers (id) ON DELETE CASCADE,

      line1          text NOT NULL,
      line2          text,
      city           text NOT NULL,
      region         text NOT NULL,
      postal_code    text NOT NULL,
      country        text NOT NULL,
      delivery_notes text,

      created_at     timestamptz NOT NULL DEFAULT now(),
      updated_at     timestamptz NOT NULL DEFAULT now()
    )
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS addresses_customer_id_idx
      ON addresses (customer_id)
  `;

  yield* sql`
    ALTER TABLE customers
      ADD CONSTRAINT customers_default_address_fk
      FOREIGN KEY (default_address_id) REFERENCES addresses (id)
      ON DELETE SET NULL
  `;
});
