import {
  type AddressId,
  type CustomerId,
  type PaymentMethodId,
  type SubscriptionId,
} from "../customers/schema.js";
import { type PlanId } from "../plans/schema.js";
import {
  type DeliveryDay,
  type Subscription,
  type SubscriptionStatus,
} from "./schema.js";

// Shape of a `subscriptions` row as Postgres hands it back (snake_case columns).
export interface SubscriptionRow {
  readonly id: string;
  readonly customer_id: string;
  readonly status: string;
  readonly plan_id: string;
  readonly delivery_day: string;
  readonly delivery_address_id: string;
  readonly payment_method_id: string;
  readonly next_delivery_date: Date | string;
  readonly created_at: Date | string;
  readonly updated_at: Date | string;
}

const toIso = (value: Date | string): string =>
  (value instanceof Date ? value : new Date(value)).toISOString();

// `status` / `delivery_day` are constrained to their literal unions on the way
// in, so the columns only ever hold a valid member.
export const toSubscription = (row: SubscriptionRow): Subscription => ({
  id: row.id as SubscriptionId,
  customerId: row.customer_id as CustomerId,
  status: row.status as SubscriptionStatus,
  planId: row.plan_id as PlanId,
  deliveryDay: row.delivery_day as DeliveryDay,
  deliveryAddressId: row.delivery_address_id as AddressId,
  paymentMethodId: row.payment_method_id as PaymentMethodId,
  nextDeliveryDate: toIso(row.next_delivery_date),
  updatedAt: toIso(row.updated_at),
  createdAt: toIso(row.created_at),
});
