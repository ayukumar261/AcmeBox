import { Schema } from "effect";
import {
  AddressId,
  CustomerId,
  PaymentMethodId,
  SubscriptionId,
} from "../customers/schema.js";
import { PlanId } from "../plans/schema.js";

// --- Scalars -----------------------------------------------------------------

/** ISO 8601 in UTC, e.g. "2026-06-27T18:30:00Z". A plain string on the wire. */
const IsoTimestamp = Schema.String;

// --- Enums -------------------------------------------------------------------

/** Lifecycle of a subscription. `canceled` is terminal. */
export const SubscriptionStatus = Schema.Literal(
  "active",
  "paused",
  "canceled",
);
export type SubscriptionStatus = typeof SubscriptionStatus.Type;

/** Day the box is scheduled to arrive. */
export const DeliveryDay = Schema.Literal(
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
);
export type DeliveryDay = typeof DeliveryDay.Type;

// --- Canonical record --------------------------------------------------------

export const Subscription = Schema.Struct({
  id: SubscriptionId,
  customerId: CustomerId,

  status: SubscriptionStatus,

  /** Which plan this is on — source of truth for config + price. */
  planId: PlanId,

  // Fulfillment — references records that live on the Customer.
  deliveryDay: DeliveryDay,
  deliveryAddressId: AddressId,
  paymentMethodId: PaymentMethodId,

  /** Next box scheduled to ship; advances each delivery cycle. */
  nextDeliveryDate: IsoTimestamp,

  updatedAt: IsoTimestamp,
  createdAt: IsoTimestamp,
});
export type Subscription = typeof Subscription.Type;

// --- Request payloads --------------------------------------------------------

/** Fields accepted when signing a customer up. `status` starts `active` and
 *  timestamps are server-controlled, so neither is accepted here. */
export const CreateSubscriptionPayload = Schema.Struct({
  customerId: CustomerId,
  planId: PlanId,
  deliveryDay: DeliveryDay,
  deliveryAddressId: AddressId,
  paymentMethodId: PaymentMethodId,
  nextDeliveryDate: IsoTimestamp,
});
export type CreateSubscriptionPayload =
  typeof CreateSubscriptionPayload.Type;

/** Every field optional — send only what changed. `status` drives the lifecycle
 *  (active ↔ paused, either → canceled); the rest reschedule or switch plan. */
export const UpdateSubscriptionPayload = Schema.Struct({
  status: Schema.optional(SubscriptionStatus),
  planId: Schema.optional(PlanId),
  deliveryDay: Schema.optional(DeliveryDay),
  deliveryAddressId: Schema.optional(AddressId),
  paymentMethodId: Schema.optional(PaymentMethodId),
  nextDeliveryDate: Schema.optional(IsoTimestamp),
});
export type UpdateSubscriptionPayload =
  typeof UpdateSubscriptionPayload.Type;

/** Filters for `GET /subscriptions` — AND-combined; none → recent rows. */
export const SubscriptionListQuery = Schema.Struct({
  customerId: Schema.optional(CustomerId),
  status: Schema.optional(SubscriptionStatus),
});
export type SubscriptionListQuery = typeof SubscriptionListQuery.Type;

// --- Errors ------------------------------------------------------------------

export class SubscriptionNotFound extends Schema.TaggedError<SubscriptionNotFound>()(
  "SubscriptionNotFound",
  { subscriptionId: Schema.String },
) {}

/** A customer may have only one live (non-canceled) subscription at a time. */
export class CustomerAlreadySubscribed extends Schema.TaggedError<CustomerAlreadySubscribed>()(
  "CustomerAlreadySubscribed",
  { customerId: Schema.String, subscriptionId: Schema.String },
) {}

/** The referenced plan is retired — open subs keep running, no new signups. */
export class PlanInactive extends Schema.TaggedError<PlanInactive>()(
  "PlanInactive",
  { planId: Schema.String },
) {}

/** Requested a transition the lifecycle doesn't allow (e.g. out of canceled). */
export class InvalidSubscriptionTransition extends Schema.TaggedError<InvalidSubscriptionTransition>()(
  "InvalidSubscriptionTransition",
  {
    subscriptionId: Schema.String,
    from: SubscriptionStatus,
    to: SubscriptionStatus,
  },
) {}
