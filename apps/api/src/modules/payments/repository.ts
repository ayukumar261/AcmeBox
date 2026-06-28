import { SqlClient } from "@effect/sql";
import { Effect } from "effect";
import { randomUUID } from "node:crypto";
import { DatabaseLive } from "../../db/Database.js";
import {
  type CustomerId,
  type PaymentMethodId,
  PaymentMethodNotFound,
} from "../customers/schema.js";
import { type OrderId, OrderNotFound } from "../orders/schema.js";
import { type PaymentRow, toPayment } from "./row.js";
import {
  type CreatePaymentPayload,
  InvalidPaymentTransition,
  type PaymentId,
  type PaymentListQuery,
  PaymentNotFound,
  type PaymentStatus,
  type RefundPaymentPayload,
  type UpdatePaymentPayload,
} from "./schema.js";

// The only lifecycle moves the charge allows: a pending charge settles either
// way; `succeeded` can later be refunded (via the dedicated refund path, not a
// status patch); `failed` / `refunded` are terminal (empty lists).
const ALLOWED_TRANSITIONS: Record<PaymentStatus, readonly PaymentStatus[]> = {
  pending: ["succeeded", "failed"],
  succeeded: [],
  failed: [],
  refunded: [],
};

export class PaymentsRepository extends Effect.Service<PaymentsRepository>()(
  "PaymentsRepository",
  {
    // Shares the single DatabaseLive pool with the other repositories (Layer
    // dedupes by reference).
    dependencies: [DatabaseLive],
    effect: Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      // A payment charges an order, which already knows its customer,
      // subscription, frozen price, and card — derive all of them from it
      // rather than trusting the client.
      const loadOrder = (orderId: string) =>
        Effect.gen(function* () {
          const rows = yield* sql<{
            readonly customer_id: string;
            readonly subscription_id: string;
            readonly price: number;
            readonly currency: string;
            readonly payment_method_id: string;
          }>`
            SELECT customer_id, subscription_id, price, currency,
                   payment_method_id
            FROM orders WHERE id = ${orderId}
          `;
          const row = rows[0];
          if (row === undefined) {
            return yield* new OrderNotFound({ orderId });
          }
          return row;
        });

      // The card charged must belong to the order's own customer.
      const ensurePaymentMethodOwned = (
        customerId: CustomerId,
        paymentMethodId: PaymentMethodId,
      ) =>
        Effect.gen(function* () {
          const rows = yield* sql<{ readonly one: number }>`
            SELECT 1 AS one FROM payment_methods
            WHERE id = ${paymentMethodId} AND customer_id = ${customerId}
          `;
          if (rows.length === 0) {
            return yield* new PaymentMethodNotFound({
              customerId,
              paymentMethodId,
            });
          }
        });

      const list = (query: PaymentListQuery) =>
        Effect.gen(function* () {
          const filters = [
            query.customerId !== undefined
              ? sql`customer_id = ${query.customerId}`
              : undefined,
            query.subscriptionId !== undefined
              ? sql`subscription_id = ${query.subscriptionId}`
              : undefined,
            query.orderId !== undefined
              ? sql`order_id = ${query.orderId}`
              : undefined,
            query.status !== undefined
              ? sql`status = ${query.status}`
              : undefined,
          ].filter((f) => f !== undefined);

          const where =
            filters.length > 0 ? sql`WHERE ${sql.and(filters)}` : sql``;

          const rows = yield* sql<PaymentRow>`
            SELECT * FROM payments ${where}
            ORDER BY created_at DESC LIMIT 100
          `;
          return rows.map(toPayment);
        }).pipe(Effect.catchTag("SqlError", Effect.die));

      const findById = (id: PaymentId) =>
        Effect.gen(function* () {
          const rows = yield* sql<PaymentRow>`
            SELECT * FROM payments WHERE id = ${id}
          `;
          const row = rows[0];
          if (row === undefined) {
            return yield* new PaymentNotFound({ paymentId: id });
          }
          return toPayment(row);
        }).pipe(Effect.catchTag("SqlError", Effect.die));

      const create = (payload: CreatePaymentPayload) =>
        Effect.gen(function* () {
          const order = yield* loadOrder(payload.orderId);
          const customerId = order.customer_id as CustomerId;
          // Default the card to the one the order was placed with; an explicit
          // override must still belong to the same customer.
          const paymentMethodId = (payload.paymentMethodId ??
            order.payment_method_id) as PaymentMethodId;
          yield* ensurePaymentMethodOwned(customerId, paymentMethodId);

          const id = `pay_${randomUUID()}`;
          yield* sql`
            INSERT INTO payments
              (id, customer_id, order_id, subscription_id, payment_method_id,
               amount, currency)
            VALUES (
              ${id}, ${customerId}, ${payload.orderId},
              ${order.subscription_id}, ${paymentMethodId},
              ${order.price}, ${order.currency}
            )
          `;

          const rows = yield* sql<PaymentRow>`
            SELECT * FROM payments WHERE id = ${id}
          `;
          return toPayment(rows[0]!);
        }).pipe(Effect.catchTag("SqlError", Effect.die));

      const update = (id: PaymentId, patch: UpdatePaymentPayload) =>
        Effect.gen(function* () {
          const rows = yield* sql<PaymentRow>`
            SELECT * FROM payments WHERE id = ${id}
          `;
          const row = rows[0];
          if (row === undefined) {
            return yield* new PaymentNotFound({ paymentId: id });
          }
          const from = row.status as PaymentStatus;

          // A status change settles the charge. Only the allowed moves are
          // valid; the terminal states have nowhere to go.
          if (patch.status !== undefined && patch.status !== from) {
            if (!ALLOWED_TRANSITIONS[from].includes(patch.status)) {
              return yield* new InvalidPaymentTransition({
                paymentId: id,
                from,
                to: patch.status,
              });
            }
          }

          // Stamp processedAt when the charge settles, unless the patch sets it
          // explicitly. A charge that's still pending keeps its NULL.
          const settling =
            patch.status === "succeeded" || patch.status === "failed";
          const processedAt =
            patch.processedAt !== undefined
              ? patch.processedAt
              : settling && row.processed_at === null
                ? new Date().toISOString()
                : row.processed_at;

          // Coalesce each column to its existing value when the patch omits it.
          yield* sql`
            UPDATE payments SET
              status         = ${patch.status ?? row.status},
              processor_ref  = ${patch.processorRef !== undefined ? patch.processorRef : row.processor_ref},
              failure_reason = ${patch.failureReason !== undefined ? patch.failureReason : row.failure_reason},
              processed_at   = ${processedAt},
              updated_at     = now()
            WHERE id = ${id}
          `;

          const updated = yield* sql<PaymentRow>`
            SELECT * FROM payments WHERE id = ${id}
          `;
          return toPayment(updated[0]!);
        }).pipe(Effect.catchTag("SqlError", Effect.die));

      // A refund returns the full charge. Only a `succeeded` payment can be
      // refunded; anything else is an invalid transition. Whether the customer
      // is *allowed* a refund (bad ingredients, lifetime cap) is the support
      // agent's call per policy.md — not enforced here.
      const refund = (id: PaymentId, payload: RefundPaymentPayload) =>
        Effect.gen(function* () {
          const rows = yield* sql<PaymentRow>`
            SELECT * FROM payments WHERE id = ${id}
          `;
          const row = rows[0];
          if (row === undefined) {
            return yield* new PaymentNotFound({ paymentId: id });
          }
          const from = row.status as PaymentStatus;
          if (from !== "succeeded") {
            return yield* new InvalidPaymentTransition({
              paymentId: id,
              from,
              to: "refunded",
            });
          }

          yield* sql`
            UPDATE payments SET
              status        = 'refunded',
              refund_reason = ${payload.reason},
              refunded_at   = now(),
              updated_at    = now()
            WHERE id = ${id}
          `;

          const updated = yield* sql<PaymentRow>`
            SELECT * FROM payments WHERE id = ${id}
          `;
          return toPayment(updated[0]!);
        }).pipe(Effect.catchTag("SqlError", Effect.die));

      return { list, findById, create, update, refund } as const;
    }),
  },
) {}
