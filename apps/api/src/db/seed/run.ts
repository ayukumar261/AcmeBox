/**
 * The seed program: wipe the app tables and repopulate them with the
 * deterministic dataset from `./data.ts`.
 *
 * The recipe mirrors the eval harness (apps/eval/src/harness.py `seed`): run the
 * whole thing in one transaction with FK triggers disabled
 * (`session_replication_role = replica`) so the circular customers <-> addresses
 * /payment_methods /subscriptions default pointers can be inserted in any order.
 * Inserts use the tagged template (same binding rules the repositories prove
 * out): `text[]` columns bind a JS array directly; `jsonb` binds
 * `JSON.stringify(...)::jsonb`.
 */

import { SqlClient } from "@effect/sql";
import { Effect } from "effect";
import {
  type AddressRow,
  buildSeed,
  type CustomerRow,
  type MealRow,
  type OrderRow,
  type PaymentMethodRow,
  type PaymentRow,
  type PlanRow,
  type SubscriptionRow,
} from "./data.js";

// Tables this seed owns and resets on every run. `health_checks` is infra/probe
// data, not part of the chat world, so it is intentionally left untouched.
const TRUNCATE_TARGETS =
  "payments, orders, subscriptions, meals, plans, " +
  "payment_methods, addresses, customers";

export const seedProgram = Effect.gen(function* () {
  // Safety rail: `pnpm db:seed` truncates. The default DATABASE_URL is local; if
  // someone points it at a remote DB, refuse unless they explicitly opt in. The
  // eval harness overrides DATABASE_URL to a local ephemeral DB, so it's fine.
  const dbUrl = process.env.DATABASE_URL;
  if (
    dbUrl !== undefined &&
    !/(localhost|127\.0\.0\.1)/.test(dbUrl) &&
    process.env.SEED_FORCE !== "1"
  ) {
    return yield* Effect.dieMessage(
      `Refusing to seed a non-local DATABASE_URL (${dbUrl}). ` +
        `It would TRUNCATE those tables. Re-run with SEED_FORCE=1 to override.`,
    );
  }

  const sql = yield* SqlClient.SqlClient;
  const data = buildSeed();

  const insertCustomer = (c: CustomerRow) =>
    sql`
      INSERT INTO customers
        (id, email, email_verified, phone, phone_verified, first_name,
         last_name, locale, timezone, country, subscription_id,
         default_address_id, default_payment_method_id, created_at, updated_at)
      VALUES
        (${c.id}, ${c.email}, ${c.email_verified}, ${c.phone},
         ${c.phone_verified}, ${c.first_name}, ${c.last_name}, ${c.locale},
         ${c.timezone}, ${c.country}, ${c.subscription_id},
         ${c.default_address_id}, ${c.default_payment_method_id},
         ${c.created_at}, ${c.updated_at})
    `;

  const insertAddress = (a: AddressRow) =>
    sql`
      INSERT INTO addresses
        (id, customer_id, line1, line2, city, region, postal_code, country,
         delivery_notes, created_at, updated_at)
      VALUES
        (${a.id}, ${a.customer_id}, ${a.line1}, ${a.line2}, ${a.city},
         ${a.region}, ${a.postal_code}, ${a.country}, ${a.delivery_notes},
         ${a.created_at}, ${a.updated_at})
    `;

  const insertPaymentMethod = (p: PaymentMethodRow) =>
    sql`
      INSERT INTO payment_methods
        (id, customer_id, brand, last4, expiry_month, expiry_year, created_at)
      VALUES
        (${p.id}, ${p.customer_id}, ${p.brand}, ${p.last4}, ${p.expiry_month},
         ${p.expiry_year}, ${p.created_at})
    `;

  const insertPlan = (p: PlanRow) =>
    sql`
      INSERT INTO plans
        (id, name, meals_per_week, servings_per_meal, currency, country,
         price_per_serving, active, created_at, updated_at)
      VALUES
        (${p.id}, ${p.name}, ${p.meals_per_week}, ${p.servings_per_meal},
         ${p.currency}, ${p.country}, ${p.price_per_serving}, ${p.active},
         ${p.created_at}, ${p.updated_at})
    `;

  const insertSubscription = (s: SubscriptionRow) =>
    sql`
      INSERT INTO subscriptions
        (id, customer_id, status, plan_id, delivery_day, delivery_address_id,
         payment_method_id, next_delivery_date, created_at, updated_at)
      VALUES
        (${s.id}, ${s.customer_id}, ${s.status}, ${s.plan_id}, ${s.delivery_day},
         ${s.delivery_address_id}, ${s.payment_method_id},
         ${s.next_delivery_date}, ${s.created_at}, ${s.updated_at})
    `;

  // `steps` / `ingredients` bind as JS arrays; pg serializes them into text[].
  const insertMeal = (m: MealRow) =>
    sql`
      INSERT INTO meals (id, name, steps, ingredients, is_active, created_at, updated_at)
      VALUES
        (${m.id}, ${m.name}, ${m.steps}, ${m.ingredients}, ${m.is_active},
         ${m.created_at}, ${m.updated_at})
    `;

  // `items` is a single jsonb param — serialize and cast, like orders/repository.
  const insertOrder = (o: OrderRow) =>
    sql`
      INSERT INTO orders
        (id, subscription_id, customer_id, status, address_id, payment_method_id,
         delivery_date, price, currency, items, carrier, tracking_number,
         created_at, updated_at)
      VALUES
        (${o.id}, ${o.subscription_id}, ${o.customer_id}, ${o.status},
         ${o.address_id}, ${o.payment_method_id}, ${o.delivery_date}, ${o.price},
         ${o.currency}, ${JSON.stringify(o.items)}::jsonb, ${o.carrier},
         ${o.tracking_number}, ${o.created_at}, ${o.updated_at})
    `;

  const insertPayment = (p: PaymentRow) =>
    sql`
      INSERT INTO payments
        (id, customer_id, order_id, subscription_id, payment_method_id, status,
         amount, currency, processor_ref, failure_reason, refund_reason,
         processed_at, refunded_at, created_at, updated_at)
      VALUES
        (${p.id}, ${p.customer_id}, ${p.order_id}, ${p.subscription_id},
         ${p.payment_method_id}, ${p.status}, ${p.amount}, ${p.currency},
         ${p.processor_ref}, ${p.failure_reason}, ${p.refund_reason},
         ${p.processed_at}, ${p.refunded_at}, ${p.created_at}, ${p.updated_at})
    `;

  yield* sql.withTransaction(
    Effect.gen(function* () {
      yield* sql.unsafe("SET session_replication_role = replica");
      yield* sql.unsafe(
        `TRUNCATE ${TRUNCATE_TARGETS} RESTART IDENTITY CASCADE`,
      );

      for (const r of data.customers) yield* insertCustomer(r);
      for (const r of data.addresses) yield* insertAddress(r);
      for (const r of data.payment_methods) yield* insertPaymentMethod(r);
      for (const r of data.plans) yield* insertPlan(r);
      for (const r of data.subscriptions) yield* insertSubscription(r);
      for (const r of data.meals) yield* insertMeal(r);
      for (const r of data.orders) yield* insertOrder(r);
      for (const r of data.payments) yield* insertPayment(r);

      yield* sql.unsafe("SET session_replication_role = DEFAULT");
    }),
  );

  yield* Effect.log(
    `Seeded ${data.customers.length} customers, ` +
      `${data.addresses.length} addresses, ` +
      `${data.payment_methods.length} payment methods, ` +
      `${data.plans.length} plans, ${data.meals.length} meals, ` +
      `${data.subscriptions.length} subscriptions, ` +
      `${data.orders.length} orders, ${data.payments.length} payments.`,
  );
  yield* Effect.log(
    "Chat as a hero customer: cust_1 (Sam Rivera), cust_2 (Alex Chen), " +
      "cust_3 (Jordan Lee), cust_4 (Taylor Kim).",
  );
});
