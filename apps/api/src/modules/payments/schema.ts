import { Schema } from "effect";
import {
  CustomerId,
  PaymentMethodId,
  SubscriptionId,
} from "../customers/schema.js";
import { OrderId } from "../orders/schema.js";
import { Currency } from "../plans/schema.js";

// --- Scalars -----------------------------------------------------------------

/** ISO 8601 in UTC, e.g. "2026-06-27T18:30:00Z". A plain string on the wire. */
const IsoTimestamp = Schema.String;

/**
 * Money in minor units (cents) as an integer — never a float. Frozen on the
 * payment at charge time (copied from the order's price) so later plan/order
 * edits never rewrite billing history.
 */
const Money = Schema.Number;

// --- Branded ID --------------------------------------------------------------

export const PaymentId = Schema.String.pipe(Schema.brand("PaymentId"));
export type PaymentId = typeof PaymentId.Type;

// --- Enums -------------------------------------------------------------------

/** Lifecycle of a charge. `failed` is terminal; a `succeeded` charge can later
 *  become `refunded`. Refunds are full-only — there is no partial state. */
export const PaymentStatus = Schema.Literal(
  "pending",
  "succeeded",
  "failed",
  "refunded",
);
export type PaymentStatus = typeof PaymentStatus.Type;

// --- Canonical record --------------------------------------------------------

export const Payment = Schema.Struct({
  id: PaymentId,

  /** Who was charged. Denormalized from the order for per-customer history. */
  customerId: CustomerId,

  /** The box this charge paid for, and (denormalized) its subscription. */
  orderId: OrderId,
  subscriptionId: SubscriptionId,

  /** Which stored card was charged. References a PaymentMethod on the Customer. */
  paymentMethodId: PaymentMethodId,

  status: PaymentStatus,

  // Amount snapshot — frozen at charge time so later plan/order edits never
  // rewrite billing history. Answers "how much was I charged?".
  amount: Money,
  currency: Currency,

  // Processor link — the gateway's charge id, for reconciliation. Populated
  // once the charge is submitted (status `succeeded`+).
  processorRef: Schema.optional(Schema.String),

  /** Why the charge failed — populated only when status is `failed`. */
  failureReason: Schema.optional(Schema.String),

  /** Why the charge was refunded — free text, populated when `refunded`. */
  refundReason: Schema.optional(Schema.String),

  /** When the charge settled (succeeded/failed). Absent while `pending`. */
  processedAt: Schema.optional(IsoTimestamp),

  /** When the charge was refunded. Absent unless status is `refunded`. */
  refundedAt: Schema.optional(IsoTimestamp),

  updatedAt: IsoTimestamp,
  createdAt: IsoTimestamp,
});
export type Payment = typeof Payment.Type;

// --- Request payloads --------------------------------------------------------

/** Fields accepted when recording a charge. `customerId` / `subscriptionId` /
 *  `amount` / `currency` are all derived from the referenced order (never
 *  trusted from the client); `status` starts `pending`, the processor / refund /
 *  failure fields fill in later, and timestamps are server-controlled — so none
 *  of those are accepted here. `paymentMethodId` is an optional override and
 *  defaults to the card the order was placed with. */
export const CreatePaymentPayload = Schema.Struct({
  orderId: OrderId,
  paymentMethodId: Schema.optional(PaymentMethodId),
});
export type CreatePaymentPayload = typeof CreatePaymentPayload.Type;

/** Every field optional — send only what changed. `status` drives the lifecycle
 *  (pending → succeeded / failed); `processorRef` / `processedAt` are set when
 *  the charge settles and `failureReason` on failure. `amount` / `currency` are
 *  frozen and never accepted; refunds go through the dedicated refund endpoint. */
export const UpdatePaymentPayload = Schema.Struct({
  status: Schema.optional(PaymentStatus),
  processorRef: Schema.optional(Schema.String),
  failureReason: Schema.optional(Schema.String),
  processedAt: Schema.optional(IsoTimestamp),
});
export type UpdatePaymentPayload = typeof UpdatePaymentPayload.Type;

/** Body for `POST /payments/:paymentId/refund`. Free-text `reason` describing
 *  the ingredient problem — recorded as `refundReason` for history / audit. */
export const RefundPaymentPayload = Schema.Struct({
  reason: Schema.String,
});
export type RefundPaymentPayload = typeof RefundPaymentPayload.Type;

/** Filters for `GET /payments` — AND-combined; none → recent rows. Listing by
 *  `customerId` + `status` is how a customer's lifetime refunds are counted. */
export const PaymentListQuery = Schema.Struct({
  customerId: Schema.optional(CustomerId),
  subscriptionId: Schema.optional(SubscriptionId),
  orderId: Schema.optional(OrderId),
  status: Schema.optional(PaymentStatus),
});
export type PaymentListQuery = typeof PaymentListQuery.Type;

// --- Errors ------------------------------------------------------------------

export class PaymentNotFound extends Schema.TaggedError<PaymentNotFound>()(
  "PaymentNotFound",
  { paymentId: Schema.String },
) {}

/** Requested a transition the lifecycle doesn't allow — e.g. settling a charge
 *  that's already terminal, or refunding one that never `succeeded`. */
export class InvalidPaymentTransition extends Schema.TaggedError<InvalidPaymentTransition>()(
  "InvalidPaymentTransition",
  { paymentId: Schema.String, from: PaymentStatus, to: PaymentStatus },
) {}
