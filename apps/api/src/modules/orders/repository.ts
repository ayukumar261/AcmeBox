import { SqlClient } from "@effect/sql";
import { Effect } from "effect";
import { randomUUID } from "node:crypto";
import { DatabaseLive } from "../../db/Database.js";
import {
  AddressNotFound,
  type AddressId,
  type CustomerId,
  type PaymentMethodId,
  PaymentMethodNotFound,
} from "../customers/schema.js";
import { MealNotFound } from "../meals/schema.js";
import { type PlanId, PlanNotFound } from "../plans/schema.js";
import { SubscriptionNotFound } from "../subscriptions/schema.js";
import { type OrderRow, toOrder } from "./row.js";
import {
  type CreateOrderPayload,
  FulfillmentNotEditable,
  InvalidOrderTransition,
  type OrderId,
  OrderItemsMismatch,
  type OrderLine,
  type OrderListQuery,
  OrderNotFound,
  type OrderStatus,
  ShipmentDetailsRequired,
  type UpdateOrderPayload,
} from "./schema.js";

// The only transitions the lifecycle allows: forward through the happy path,
// plus canceling a box that hasn't shipped yet. `delivered` / `canceled` are
// terminal (absent keys), and a `shipped` box can no longer be canceled.
const ALLOWED_TRANSITIONS: Record<OrderStatus, readonly OrderStatus[]> = {
  pending: ["shipped", "canceled"],
  shipped: ["delivered"],
  delivered: [],
  canceled: [],
};

export class OrdersRepository extends Effect.Service<OrdersRepository>()(
  "OrdersRepository",
  {
    // Shares the single DatabaseLive pool with the other repositories (Layer
    // dedupes by reference).
    dependencies: [DatabaseLive],
    effect: Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      // The order is generated from a subscription, which already knows its
      // customer and plan — derive both from it rather than trusting the client.
      const loadSubscription = (subscriptionId: string) =>
        Effect.gen(function* () {
          const rows = yield* sql<{
            readonly customer_id: string;
            readonly plan_id: string;
          }>`
            SELECT customer_id, plan_id FROM subscriptions
            WHERE id = ${subscriptionId}
          `;
          const row = rows[0];
          if (row === undefined) {
            return yield* new SubscriptionNotFound({ subscriptionId });
          }
          return row;
        });

      // Fulfillment targets must belong to the order's own customer.
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

      // Every referenced meal must exist. Retired meals (is_active = false) are
      // fine — meal rows are never deleted, so historical orders still resolve.
      const ensureMealsExist = (items: readonly OrderLine[]) =>
        Effect.gen(function* () {
          const ids = [...new Set(items.map((item) => item.mealId))];
          for (const mealId of ids) {
            const rows = yield* sql<{ readonly one: number }>`
              SELECT 1 AS one FROM meals WHERE id = ${mealId}
            `;
            if (rows.length === 0) {
              return yield* new MealNotFound({ mealId });
            }
          }
        });

      // The box's total meal quantity must match what the plan ships per week.
      const ensureItemsMatchPlan = (
        planId: PlanId,
        items: readonly OrderLine[],
      ) =>
        Effect.gen(function* () {
          const rows = yield* sql<{ readonly meals_per_week: number }>`
            SELECT meals_per_week FROM plans WHERE id = ${planId}
          `;
          const row = rows[0];
          if (row === undefined) {
            return yield* new PlanNotFound({ planId });
          }
          const actual = items.reduce((sum, item) => sum + item.quantity, 0);
          if (actual !== row.meals_per_week) {
            return yield* new OrderItemsMismatch({
              expected: row.meals_per_week,
              actual,
            });
          }
        });

      const list = (query: OrderListQuery) =>
        Effect.gen(function* () {
          const filters = [
            query.customerId !== undefined
              ? sql`customer_id = ${query.customerId}`
              : undefined,
            query.subscriptionId !== undefined
              ? sql`subscription_id = ${query.subscriptionId}`
              : undefined,
            query.status !== undefined
              ? sql`status = ${query.status}`
              : undefined,
          ].filter((f) => f !== undefined);

          const where =
            filters.length > 0 ? sql`WHERE ${sql.and(filters)}` : sql``;

          const rows = yield* sql<OrderRow>`
            SELECT * FROM orders ${where}
            ORDER BY created_at DESC LIMIT 100
          `;
          return rows.map(toOrder);
        }).pipe(Effect.catchTag("SqlError", Effect.die));

      const findById = (id: OrderId) =>
        Effect.gen(function* () {
          const rows = yield* sql<OrderRow>`
            SELECT * FROM orders WHERE id = ${id}
          `;
          const row = rows[0];
          if (row === undefined) {
            return yield* new OrderNotFound({ orderId: id });
          }
          return toOrder(row);
        }).pipe(Effect.catchTag("SqlError", Effect.die));

      const create = (payload: CreateOrderPayload) =>
        Effect.gen(function* () {
          const subscription = yield* loadSubscription(payload.subscriptionId);
          const customerId = subscription.customer_id as CustomerId;

          yield* ensureAddressOwned(customerId, payload.addressId);
          yield* ensurePaymentMethodOwned(customerId, payload.paymentMethodId);
          yield* ensureMealsExist(payload.items);
          yield* ensureItemsMatchPlan(
            subscription.plan_id as PlanId,
            payload.items,
          );

          const id = `ord_${randomUUID()}`;
          // `items` binds as a single jsonb param — serialize it ourselves and
          // cast, so pg doesn't read the JS array as a Postgres array literal.
          yield* sql`
            INSERT INTO orders
              (id, subscription_id, customer_id, address_id, payment_method_id,
               delivery_date, price, currency, items)
            VALUES (
              ${id}, ${payload.subscriptionId}, ${customerId},
              ${payload.addressId}, ${payload.paymentMethodId},
              ${payload.deliveryDate}, ${payload.price}, ${payload.currency},
              ${JSON.stringify(payload.items)}::jsonb
            )
          `;

          const rows = yield* sql<OrderRow>`
            SELECT * FROM orders WHERE id = ${id}
          `;
          return toOrder(rows[0]!);
        }).pipe(Effect.catchTag("SqlError", Effect.die));

      const update = (id: OrderId, patch: UpdateOrderPayload) =>
        Effect.gen(function* () {
          const rows = yield* sql<OrderRow>`
            SELECT * FROM orders WHERE id = ${id}
          `;
          const row = rows[0];
          if (row === undefined) {
            return yield* new OrderNotFound({ orderId: id });
          }
          const customerId = row.customer_id as CustomerId;
          const from = row.status as OrderStatus;

          // A status change is the lifecycle. Only the allowed forward / cancel
          // moves are valid; the terminal states have nowhere to go.
          if (patch.status !== undefined && patch.status !== from) {
            if (!ALLOWED_TRANSITIONS[from].includes(patch.status)) {
              return yield* new InvalidOrderTransition({
                orderId: id,
                from,
                to: patch.status,
              });
            }
            // A box can't leave the warehouse without a carrier + tracking
            // number — supplied in this patch or already on the row.
            if (patch.status === "shipped") {
              const carrier = patch.carrier ?? row.carrier;
              const trackingNumber =
                patch.trackingNumber ?? row.tracking_number;
              if (carrier === null || trackingNumber === null) {
                return yield* new ShipmentDetailsRequired({ orderId: id });
              }
            }
          }

          // Fulfillment is locked once the box ships — only editable while
          // still pending.
          const editsFulfillment =
            patch.addressId !== undefined ||
            patch.paymentMethodId !== undefined ||
            patch.deliveryDate !== undefined;
          if (editsFulfillment && from !== "pending") {
            return yield* new FulfillmentNotEditable({
              orderId: id,
              status: from,
            });
          }
          if (patch.addressId !== undefined) {
            yield* ensureAddressOwned(customerId, patch.addressId);
          }
          if (patch.paymentMethodId !== undefined) {
            yield* ensurePaymentMethodOwned(customerId, patch.paymentMethodId);
          }

          // Coalesce each column to its existing value when the patch omits it.
          yield* sql`
            UPDATE orders SET
              status            = ${patch.status ?? row.status},
              carrier           = ${patch.carrier !== undefined ? patch.carrier : row.carrier},
              tracking_number   = ${patch.trackingNumber !== undefined ? patch.trackingNumber : row.tracking_number},
              address_id        = ${patch.addressId ?? row.address_id},
              payment_method_id = ${patch.paymentMethodId ?? row.payment_method_id},
              delivery_date     = ${patch.deliveryDate ?? row.delivery_date},
              updated_at        = now()
            WHERE id = ${id}
          `;

          const updated = yield* sql<OrderRow>`
            SELECT * FROM orders WHERE id = ${id}
          `;
          return toOrder(updated[0]!);
        }).pipe(Effect.catchTag("SqlError", Effect.die));

      return { list, findById, create, update } as const;
    }),
  },
) {}
