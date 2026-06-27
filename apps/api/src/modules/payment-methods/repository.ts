import { SqlClient } from "@effect/sql";
import { Effect } from "effect";
import { randomUUID } from "node:crypto";
import { DatabaseLive } from "../../db/Database.js";
import { CustomersRepository } from "../customers/repository.js";
import {
  type CreatePaymentMethodPayload,
  type CustomerId,
  CustomerNotFound,
  type PaymentMethodId,
  PaymentMethodNotFound,
} from "../customers/schema.js";
import { type PaymentMethodRow, toPaymentMethod } from "./row.js";

export class PaymentMethodsRepository extends Effect.Service<PaymentMethodsRepository>()(
  "PaymentMethodsRepository",
  {
    // Shares the single DatabaseLive pool with the other repositories (Layer
    // dedupes by reference); CustomersRepository is reused to return a full
    // Customer from `setDefault`.
    dependencies: [DatabaseLive, CustomersRepository.Default],
    effect: Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const customers = yield* CustomersRepository;

      const ensureCustomer = (customerId: CustomerId) =>
        Effect.gen(function* () {
          const rows = yield* sql<{ readonly one: number }>`
            SELECT 1 AS one FROM customers WHERE id = ${customerId}
          `;
          if (rows.length === 0) {
            return yield* new CustomerNotFound({ customerId });
          }
        });

      const list = (customerId: CustomerId) =>
        Effect.gen(function* () {
          yield* ensureCustomer(customerId);
          const rows = yield* sql<PaymentMethodRow>`
            SELECT * FROM payment_methods
            WHERE customer_id = ${customerId}
            ORDER BY created_at ASC
          `;
          return rows.map(toPaymentMethod);
        }).pipe(Effect.catchTag("SqlError", Effect.die));

      const create = (
        customerId: CustomerId,
        payload: CreatePaymentMethodPayload,
      ) =>
        Effect.gen(function* () {
          yield* ensureCustomer(customerId);
          const id = `pm_${randomUUID()}`;
          yield* sql`
            INSERT INTO payment_methods
              (id, customer_id, brand, last4, expiry_month, expiry_year)
            VALUES (
              ${id}, ${customerId}, ${payload.brand}, ${payload.last4},
              ${payload.expiryMonth}, ${payload.expiryYear}
            )
          `;
          const rows = yield* sql<PaymentMethodRow>`
            SELECT * FROM payment_methods WHERE id = ${id}
          `;
          return toPaymentMethod(rows[0]!);
        }).pipe(Effect.catchTag("SqlError", Effect.die));

      const remove = (customerId: CustomerId, paymentMethodId: PaymentMethodId) =>
        Effect.gen(function* () {
          const deleted = yield* sql<{ readonly id: string }>`
            DELETE FROM payment_methods
            WHERE id = ${paymentMethodId} AND customer_id = ${customerId}
            RETURNING id
          `;
          if (deleted.length === 0) {
            return yield* new PaymentMethodNotFound({
              customerId,
              paymentMethodId,
            });
          }
          // The customers.default_payment_method_id FK clears itself on delete.
        }).pipe(Effect.catchTag("SqlError", Effect.die));

      const setDefault = (
        customerId: CustomerId,
        paymentMethodId: PaymentMethodId,
      ) =>
        Effect.gen(function* () {
          const rows = yield* sql<{ readonly one: number }>`
            SELECT 1 AS one FROM payment_methods
            WHERE id = ${paymentMethodId} AND customer_id = ${customerId}
          `;
          if (rows.length === 0) {
            // Surface the more specific cause: missing customer vs missing card.
            yield* ensureCustomer(customerId);
            return yield* new PaymentMethodNotFound({
              customerId,
              paymentMethodId,
            });
          }
          yield* sql`
            UPDATE customers
            SET default_payment_method_id = ${paymentMethodId}, updated_at = now()
            WHERE id = ${customerId}
          `;
          return yield* customers.findById(customerId);
        }).pipe(Effect.catchTag("SqlError", Effect.die));

      return { list, create, remove, setDefault } as const;
    }),
  },
) {}
