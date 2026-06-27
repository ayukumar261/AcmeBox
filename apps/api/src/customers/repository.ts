import { SqlClient } from "@effect/sql";
import { Effect } from "effect";
import { randomUUID } from "node:crypto";
import { type AddressRow, toAddress } from "../addresses/row.js";
import { DatabaseLive } from "../db/Database.js";
import {
  type Address,
  type AddressId,
  type CreateCustomerPayload,
  type Customer,
  type CustomerId,
  CustomerNotFound,
  type CustomerListQuery,
  EmailAlreadyExists,
  type PaymentMethodId,
  type SubscriptionId,
  type UpdateCustomerPayload,
} from "./schema.js";

// Shape of a `customers` row as Postgres hands it back (snake_case columns).
interface CustomerRow {
  readonly id: string;
  readonly email: string;
  readonly email_verified: boolean;
  readonly phone: string | null;
  readonly phone_verified: boolean;
  readonly first_name: string;
  readonly last_name: string;
  readonly locale: string;
  readonly timezone: string;
  readonly country: string;
  readonly subscription_id: string | null;
  readonly default_address_id: string | null;
  readonly default_payment_method_id: string | null;
  readonly created_at: Date | string;
  readonly updated_at: Date | string;
}

const toIso = (value: Date | string): string =>
  (value instanceof Date ? value : new Date(value)).toISOString();

// Map a row plus its loaded addresses to the canonical record. Payment methods
// stay empty until their own endpoints exist; optional fields are omitted when
// null so the JSON stays clean.
const toCustomer = (
  row: CustomerRow,
  addresses: ReadonlyArray<Address>,
): Customer => ({
  id: row.id as CustomerId,
  email: row.email,
  emailVerified: row.email_verified,
  ...(row.phone !== null ? { phone: row.phone } : {}),
  phoneVerified: row.phone_verified,
  firstName: row.first_name,
  lastName: row.last_name,
  updatedAt: toIso(row.updated_at),
  createdAt: toIso(row.created_at),
  locale: row.locale,
  timezone: row.timezone,
  country: row.country,
  ...(row.subscription_id !== null
    ? { subscriptionId: row.subscription_id as SubscriptionId }
    : {}),
  addresses,
  ...(row.default_address_id !== null
    ? { defaultAddressId: row.default_address_id as AddressId }
    : {}),
  paymentMethods: [],
  ...(row.default_payment_method_id !== null
    ? { defaultPaymentMethodId: row.default_payment_method_id as PaymentMethodId }
    : {}),
});

export class CustomersRepository extends Effect.Service<CustomersRepository>()(
  "CustomersRepository",
  {
    dependencies: [DatabaseLive],
    effect: Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      // Load a row's owned addresses and assemble the canonical record.
      const hydrate = (row: CustomerRow) =>
        Effect.gen(function* () {
          const addressRows = yield* sql<AddressRow>`
            SELECT * FROM addresses
            WHERE customer_id = ${row.id}
            ORDER BY created_at ASC
          `;
          return toCustomer(row, addressRows.map(toAddress));
        });

      const findById = (id: CustomerId) =>
        Effect.gen(function* () {
          const rows = yield* sql<CustomerRow>`
            SELECT * FROM customers WHERE id = ${id}
          `;
          const row = rows[0];
          if (row === undefined) {
            return yield* new CustomerNotFound({ customerId: id });
          }
          return yield* hydrate(row);
        }).pipe(Effect.catchTag("SqlError", Effect.die));

      const list = (query: CustomerListQuery) =>
        Effect.gen(function* () {
          // AND-combine whichever filters were supplied; no filters → recent rows.
          const where =
            query.email !== undefined && query.phone !== undefined
              ? sql`WHERE email = ${query.email} AND phone = ${query.phone}`
              : query.email !== undefined
                ? sql`WHERE email = ${query.email}`
                : query.phone !== undefined
                  ? sql`WHERE phone = ${query.phone}`
                  : sql``;

          const rows = yield* sql<CustomerRow>`
            SELECT * FROM customers ${where} ORDER BY created_at DESC LIMIT 100
          `;
          return yield* Effect.forEach(rows, hydrate);
        }).pipe(Effect.catchTag("SqlError", Effect.die));

      const create = (payload: CreateCustomerPayload) =>
        Effect.gen(function* () {
          // Pre-check keeps the unique-email violation as a clean 409 rather
          // than leaking a raw SQL error.
          const existing = yield* sql<{ readonly one: number }>`
            SELECT 1 AS one FROM customers WHERE email = ${payload.email}
          `;
          if (existing.length > 0) {
            return yield* new EmailAlreadyExists({ email: payload.email });
          }

          const id = `cus_${randomUUID()}`;
          yield* sql`
            INSERT INTO customers
              (id, email, phone, first_name, last_name, locale, timezone, country)
            VALUES (
              ${id}, ${payload.email}, ${payload.phone ?? null},
              ${payload.firstName}, ${payload.lastName},
              ${payload.locale}, ${payload.timezone}, ${payload.country}
            )
          `;

          const rows = yield* sql<CustomerRow>`
            SELECT * FROM customers WHERE id = ${id}
          `;
          return yield* hydrate(rows[0]!);
        }).pipe(Effect.catchTag("SqlError", Effect.die));

      const update = (id: CustomerId, patch: UpdateCustomerPayload) =>
        Effect.gen(function* () {
          const rows = yield* sql<CustomerRow>`
            SELECT * FROM customers WHERE id = ${id}
          `;
          const row = rows[0];
          if (row === undefined) {
            return yield* new CustomerNotFound({ customerId: id });
          }

          // Coalesce each column to its existing value when the patch omits it.
          yield* sql`
            UPDATE customers SET
              phone      = ${patch.phone !== undefined ? patch.phone : row.phone},
              first_name = ${patch.firstName ?? row.first_name},
              last_name  = ${patch.lastName ?? row.last_name},
              locale     = ${patch.locale ?? row.locale},
              timezone   = ${patch.timezone ?? row.timezone},
              country    = ${patch.country ?? row.country},
              updated_at = now()
            WHERE id = ${id}
          `;

          const updated = yield* sql<CustomerRow>`
            SELECT * FROM customers WHERE id = ${id}
          `;
          return yield* hydrate(updated[0]!);
        }).pipe(Effect.catchTag("SqlError", Effect.die));

      return { findById, list, create, update } as const;
    }),
  },
) {}
