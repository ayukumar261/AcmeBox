import { SqlClient } from "@effect/sql";
import { Effect } from "effect";
import { randomUUID } from "node:crypto";
import { DatabaseLive } from "../../db/Database.js";
import {
  AddressNotFound,
  type AddressId,
  type CustomerId,
  CustomerNotFound,
  type PaymentMethodId,
  PaymentMethodNotFound,
  type SubscriptionId,
} from "../customers/schema.js";
import { type PlanId, PlanNotFound } from "../plans/schema.js";
import { type SubscriptionRow, toSubscription } from "./row.js";
import {
  type CreateSubscriptionPayload,
  CustomerAlreadySubscribed,
  InvalidSubscriptionTransition,
  PlanInactive,
  type SubscriptionListQuery,
  SubscriptionNotFound,
  type SubscriptionStatus,
  type UpdateSubscriptionPayload,
} from "./schema.js";

export class SubscriptionsRepository extends Effect.Service<SubscriptionsRepository>()(
  "SubscriptionsRepository",
  {
    // Shares the single DatabaseLive pool with the other repositories (Layer
    // dedupes by reference).
    dependencies: [DatabaseLive],
    effect: Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      const ensureCustomer = (customerId: CustomerId) =>
        Effect.gen(function* () {
          const rows = yield* sql<{ readonly one: number }>`
            SELECT 1 AS one FROM customers WHERE id = ${customerId}
          `;
          if (rows.length === 0) {
            return yield* new CustomerNotFound({ customerId });
          }
        });

      // The plan must exist and still be sellable to start or switch onto it.
      const ensurePlanActive = (planId: PlanId) =>
        Effect.gen(function* () {
          const rows = yield* sql<{ readonly active: boolean }>`
            SELECT active FROM plans WHERE id = ${planId}
          `;
          const row = rows[0];
          if (row === undefined) {
            return yield* new PlanNotFound({ planId });
          }
          if (!row.active) {
            return yield* new PlanInactive({ planId });
          }
        });

      // Fulfillment targets must belong to the subscription's own customer.
      const ensureAddressOwned = (
        customerId: CustomerId,
        addressId: AddressId,
      ) =>
        Effect.gen(function* () {
          const rows = yield* sql<{ readonly one: number }>`
            SELECT 1 AS one FROM addresses
            WHERE id = ${addressId} AND customer_id = ${customerId}
          `;
          if (rows.length === 0) {
            return yield* new AddressNotFound({ customerId, addressId });
          }
        });

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

      const findById = (id: SubscriptionId) =>
        Effect.gen(function* () {
          const rows = yield* sql<SubscriptionRow>`
            SELECT * FROM subscriptions WHERE id = ${id}
          `;
          const row = rows[0];
          if (row === undefined) {
            return yield* new SubscriptionNotFound({ subscriptionId: id });
          }
          return toSubscription(row);
        }).pipe(Effect.catchTag("SqlError", Effect.die));

      const list = (query: SubscriptionListQuery) =>
        Effect.gen(function* () {
          const filters = [
            query.customerId !== undefined
              ? sql`customer_id = ${query.customerId}`
              : undefined,
            query.status !== undefined
              ? sql`status = ${query.status}`
              : undefined,
          ].filter((f) => f !== undefined);

          const where =
            filters.length > 0 ? sql`WHERE ${sql.and(filters)}` : sql``;

          const rows = yield* sql<SubscriptionRow>`
            SELECT * FROM subscriptions ${where}
            ORDER BY created_at DESC LIMIT 100
          `;
          return rows.map(toSubscription);
        }).pipe(Effect.catchTag("SqlError", Effect.die));

      const create = (payload: CreateSubscriptionPayload) =>
        Effect.gen(function* () {
          yield* ensureCustomer(payload.customerId);

          // One live subscription per customer: block a second while a
          // non-canceled one is on file.
          const existing = yield* sql<{ readonly id: string }>`
            SELECT id FROM subscriptions
            WHERE customer_id = ${payload.customerId} AND status <> 'canceled'
            LIMIT 1
          `;
          if (existing.length > 0) {
            return yield* new CustomerAlreadySubscribed({
              customerId: payload.customerId,
              subscriptionId: existing[0]!.id,
            });
          }

          yield* ensurePlanActive(payload.planId);
          yield* ensureAddressOwned(
            payload.customerId,
            payload.deliveryAddressId,
          );
          yield* ensurePaymentMethodOwned(
            payload.customerId,
            payload.paymentMethodId,
          );

          const id = `sub_${randomUUID()}`;
          yield* sql`
            INSERT INTO subscriptions
              (id, customer_id, plan_id, delivery_day, delivery_address_id,
               payment_method_id, next_delivery_date)
            VALUES (
              ${id}, ${payload.customerId}, ${payload.planId},
              ${payload.deliveryDay}, ${payload.deliveryAddressId},
              ${payload.paymentMethodId}, ${payload.nextDeliveryDate}
            )
          `;

          // Point the customer at its current subscription.
          yield* sql`
            UPDATE customers
            SET subscription_id = ${id}, updated_at = now()
            WHERE id = ${payload.customerId}
          `;

          const rows = yield* sql<SubscriptionRow>`
            SELECT * FROM subscriptions WHERE id = ${id}
          `;
          return toSubscription(rows[0]!);
        }).pipe(Effect.catchTag("SqlError", Effect.die));

      const update = (id: SubscriptionId, patch: UpdateSubscriptionPayload) =>
        Effect.gen(function* () {
          const rows = yield* sql<SubscriptionRow>`
            SELECT * FROM subscriptions WHERE id = ${id}
          `;
          const row = rows[0];
          if (row === undefined) {
            return yield* new SubscriptionNotFound({ subscriptionId: id });
          }
          const customerId = row.customer_id as CustomerId;
          const from = row.status as SubscriptionStatus;

          // A status change is the lifecycle: active ↔ paused, either → canceled.
          // canceled is terminal — nothing transitions out of it.
          if (
            patch.status !== undefined &&
            patch.status !== from &&
            from === "canceled"
          ) {
            return yield* new InvalidSubscriptionTransition({
              subscriptionId: id,
              from,
              to: patch.status,
            });
          }

          if (patch.planId !== undefined) {
            yield* ensurePlanActive(patch.planId);
          }
          if (patch.deliveryAddressId !== undefined) {
            yield* ensureAddressOwned(customerId, patch.deliveryAddressId);
          }
          if (patch.paymentMethodId !== undefined) {
            yield* ensurePaymentMethodOwned(customerId, patch.paymentMethodId);
          }

          // Coalesce each column to its existing value when the patch omits it.
          yield* sql`
            UPDATE subscriptions SET
              status              = ${patch.status ?? row.status},
              plan_id             = ${patch.planId ?? row.plan_id},
              delivery_day        = ${patch.deliveryDay ?? row.delivery_day},
              delivery_address_id = ${patch.deliveryAddressId ?? row.delivery_address_id},
              payment_method_id   = ${patch.paymentMethodId ?? row.payment_method_id},
              next_delivery_date  = ${patch.nextDeliveryDate ?? row.next_delivery_date},
              updated_at          = now()
            WHERE id = ${id}
          `;

          // Canceling frees the customer to resubscribe: clear the pointer if it
          // still references this subscription.
          if (patch.status === "canceled" && from !== "canceled") {
            yield* sql`
              UPDATE customers
              SET subscription_id = NULL, updated_at = now()
              WHERE id = ${customerId} AND subscription_id = ${id}
            `;
          }

          const updated = yield* sql<SubscriptionRow>`
            SELECT * FROM subscriptions WHERE id = ${id}
          `;
          return toSubscription(updated[0]!);
        }).pipe(Effect.catchTag("SqlError", Effect.die));

      return { findById, list, create, update } as const;
    }),
  },
) {}
