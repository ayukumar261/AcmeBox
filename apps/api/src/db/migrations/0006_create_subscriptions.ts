import { SqlClient } from "@effect/sql";
import { Effect } from "effect";

// A subscription is owned by a customer (cascade-deleted with them) and pins a
// Plan by id. `delivery_address_id` / `payment_method_id` reference the
// customer's own address / card; they are kept as plain text and validated in
// the repository (a real FK would either block address/card deletes with a raw
// error or violate these NOT NULL columns). The customer's `subscription_id`
// finally becomes a real FK here — ON DELETE SET NULL, mirroring the
// default-address pointer — pointing at the customer's current subscription.
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE IF NOT EXISTS subscriptions (
      id                   text PRIMARY KEY,
      customer_id          text NOT NULL REFERENCES customers (id) ON DELETE CASCADE,

      status               text NOT NULL DEFAULT 'active',
      plan_id              text NOT NULL REFERENCES plans (id),

      delivery_day         text NOT NULL,
      delivery_address_id  text NOT NULL,
      payment_method_id    text NOT NULL,

      next_delivery_date   timestamptz NOT NULL,

      created_at           timestamptz NOT NULL DEFAULT now(),
      updated_at           timestamptz NOT NULL DEFAULT now()
    )
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS subscriptions_customer_id_idx
      ON subscriptions (customer_id)
  `;

  yield* sql`
    ALTER TABLE customers
      ADD CONSTRAINT customers_subscription_fk
      FOREIGN KEY (subscription_id) REFERENCES subscriptions (id)
      ON DELETE SET NULL
  `;
});
