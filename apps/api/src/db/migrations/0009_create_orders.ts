import { SqlClient } from "@effect/sql";
import { Effect } from "effect";

// An order is the record of a single shipped box. It is generated from a
// subscription (real FK; subscription rows persist) and owned by a customer
// (cascade-deleted with them). `address_id` / `payment_method_id` reference the
// customer's own address / card but are kept as plain text and validated in the
// repository — the same rationale as `subscriptions`. `items` is jsonb (an
// array of {mealId, quantity}); `price` is a snapshot in minor units, frozen at
// order time. `carrier` / `tracking_number` stay NULL until the box ships.
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE IF NOT EXISTS orders (
      id                 text PRIMARY KEY,
      subscription_id    text NOT NULL REFERENCES subscriptions (id),
      customer_id        text NOT NULL REFERENCES customers (id) ON DELETE CASCADE,

      status             text NOT NULL DEFAULT 'pending',

      address_id         text NOT NULL,
      payment_method_id  text NOT NULL,

      delivery_date      timestamptz NOT NULL,

      price              integer NOT NULL,
      currency           text NOT NULL,

      items              jsonb NOT NULL,

      carrier            text,
      tracking_number    text,

      created_at         timestamptz NOT NULL DEFAULT now(),
      updated_at         timestamptz NOT NULL DEFAULT now()
    )
  `;

  // Orders are listed by customer and by subscription, so index both.
  yield* sql`
    CREATE INDEX IF NOT EXISTS orders_customer_id_idx
      ON orders (customer_id)
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS orders_subscription_id_idx
      ON orders (subscription_id)
  `;
});
