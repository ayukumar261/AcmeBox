import { SqlClient } from "@effect/sql";
import { Effect } from "effect";

// A payment is the record of charging a customer for a single order. It is
// generated from an order (real FK; order rows persist) and owned by a customer
// (cascade-deleted with them). `payment_method_id` references the customer's own
// card but is kept as plain text and validated in the repository — the same
// rationale as `orders`. `amount` is a snapshot in minor units, copied from the
// order's frozen price at charge time. The processor / failure / refund columns
// stay NULL until the relevant lifecycle step. A `succeeded` charge can be fully
// refunded (status `refunded`, `refund_reason` + `refunded_at` set).
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE IF NOT EXISTS payments (
      id                 text PRIMARY KEY,
      customer_id        text NOT NULL REFERENCES customers (id) ON DELETE CASCADE,
      order_id           text NOT NULL REFERENCES orders (id),
      subscription_id    text NOT NULL REFERENCES subscriptions (id),

      payment_method_id  text NOT NULL,

      status             text NOT NULL DEFAULT 'pending',

      amount             integer NOT NULL,
      currency           text NOT NULL,

      processor_ref      text,
      failure_reason     text,
      refund_reason      text,

      processed_at       timestamptz,
      refunded_at        timestamptz,

      created_at         timestamptz NOT NULL DEFAULT now(),
      updated_at         timestamptz NOT NULL DEFAULT now()
    )
  `;

  // Payments are listed by customer and by order, so index both.
  yield* sql`
    CREATE INDEX IF NOT EXISTS payments_customer_id_idx
      ON payments (customer_id)
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS payments_order_id_idx
      ON payments (order_id)
  `;

  // Backs the support agent's lifetime-refund count
  // (customer_id + status = 'refunded').
  yield* sql`
    CREATE INDEX IF NOT EXISTS payments_customer_id_status_idx
      ON payments (customer_id, status)
  `;
});
