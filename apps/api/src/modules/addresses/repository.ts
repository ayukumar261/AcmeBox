import { SqlClient } from "@effect/sql";
import { Effect } from "effect";
import { randomUUID } from "node:crypto";
import { DatabaseLive } from "../../db/Database.js";
import { CustomersRepository } from "../customers/repository.js";
import {
  AddressNotFound,
  type CreateAddressPayload,
  type CustomerId,
  CustomerNotFound,
  type AddressId,
  type UpdateAddressPayload,
} from "../customers/schema.js";
import { type AddressRow, toAddress } from "./row.js";

export class AddressesRepository extends Effect.Service<AddressesRepository>()(
  "AddressesRepository",
  {
    // Shares the single DatabaseLive pool with CustomersRepository (Layer dedupes
    // by reference); CustomersRepository is reused to return a full Customer from
    // `setDefault`.
    dependencies: [DatabaseLive, CustomersRepository.Default],
    effect: Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const customers = yield* CustomersRepository;

      // Fail with CustomerNotFound if the customer doesn't exist.
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
          const rows = yield* sql<AddressRow>`
            SELECT * FROM addresses
            WHERE customer_id = ${customerId}
            ORDER BY created_at ASC
          `;
          return rows.map(toAddress);
        }).pipe(Effect.catchTag("SqlError", Effect.die));

      const create = (customerId: CustomerId, payload: CreateAddressPayload) =>
        Effect.gen(function* () {
          yield* ensureCustomer(customerId);
          const id = `adr_${randomUUID()}`;
          yield* sql`
            INSERT INTO addresses
              (id, customer_id, line1, line2, city, region, postal_code,
               country, delivery_notes)
            VALUES (
              ${id}, ${customerId}, ${payload.line1}, ${payload.line2 ?? null},
              ${payload.city}, ${payload.region}, ${payload.postalCode},
              ${payload.country}, ${payload.deliveryNotes ?? null}
            )
          `;
          const rows = yield* sql<AddressRow>`
            SELECT * FROM addresses WHERE id = ${id}
          `;
          return toAddress(rows[0]!);
        }).pipe(Effect.catchTag("SqlError", Effect.die));

      const update = (
        customerId: CustomerId,
        addressId: AddressId,
        patch: UpdateAddressPayload,
      ) =>
        Effect.gen(function* () {
          const rows = yield* sql<AddressRow>`
            SELECT * FROM addresses
            WHERE id = ${addressId} AND customer_id = ${customerId}
          `;
          const row = rows[0];
          if (row === undefined) {
            return yield* new AddressNotFound({ customerId, addressId });
          }

          // Coalesce each column to its existing value when the patch omits it.
          yield* sql`
            UPDATE addresses SET
              line1          = ${patch.line1 ?? row.line1},
              line2          = ${patch.line2 !== undefined ? patch.line2 : row.line2},
              city           = ${patch.city ?? row.city},
              region         = ${patch.region ?? row.region},
              postal_code    = ${patch.postalCode ?? row.postal_code},
              country        = ${patch.country ?? row.country},
              delivery_notes = ${patch.deliveryNotes !== undefined ? patch.deliveryNotes : row.delivery_notes},
              updated_at     = now()
            WHERE id = ${addressId}
          `;

          const updated = yield* sql<AddressRow>`
            SELECT * FROM addresses WHERE id = ${addressId}
          `;
          return toAddress(updated[0]!);
        }).pipe(Effect.catchTag("SqlError", Effect.die));

      const remove = (customerId: CustomerId, addressId: AddressId) =>
        Effect.gen(function* () {
          const deleted = yield* sql<{ readonly id: string }>`
            DELETE FROM addresses
            WHERE id = ${addressId} AND customer_id = ${customerId}
            RETURNING id
          `;
          if (deleted.length === 0) {
            return yield* new AddressNotFound({ customerId, addressId });
          }
          // The customers.default_address_id FK clears itself on delete.
        }).pipe(Effect.catchTag("SqlError", Effect.die));

      const setDefault = (customerId: CustomerId, addressId: AddressId) =>
        Effect.gen(function* () {
          const rows = yield* sql<{ readonly one: number }>`
            SELECT 1 AS one FROM addresses
            WHERE id = ${addressId} AND customer_id = ${customerId}
          `;
          if (rows.length === 0) {
            // Surface the more specific cause: missing customer vs missing address.
            yield* ensureCustomer(customerId);
            return yield* new AddressNotFound({ customerId, addressId });
          }
          yield* sql`
            UPDATE customers
            SET default_address_id = ${addressId}, updated_at = now()
            WHERE id = ${customerId}
          `;
          return yield* customers.findById(customerId);
        }).pipe(Effect.catchTag("SqlError", Effect.die));

      return { list, create, update, remove, setDefault } as const;
    }),
  },
) {}
