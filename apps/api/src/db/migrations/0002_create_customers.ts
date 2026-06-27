import { SqlClient } from "@effect/sql";
import { Effect } from "effect";

// The canonical customer record. `addresses` and `payment_methods` are owned
// sub-aggregates that get their own tables when those endpoints land; for now
// the relationship columns (subscription / default ids) are nullable and unused.
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE IF NOT EXISTS customers (
      id                         text PRIMARY KEY,

      email                      text NOT NULL UNIQUE,
      email_verified             boolean NOT NULL DEFAULT false,
      phone                      text,
      phone_verified             boolean NOT NULL DEFAULT false,
      first_name                 text NOT NULL,
      last_name                  text NOT NULL,

      locale                     text NOT NULL,
      timezone                   text NOT NULL,
      country                    text NOT NULL,

      subscription_id            text,
      default_address_id         text,
      default_payment_method_id  text,

      created_at                 timestamptz NOT NULL DEFAULT now(),
      updated_at                 timestamptz NOT NULL DEFAULT now()
    )
  `;

  // Callers are commonly identified by phone, so index it for lookups.
  yield* sql`
    CREATE INDEX IF NOT EXISTS customers_phone_idx ON customers (phone)
  `;
});
