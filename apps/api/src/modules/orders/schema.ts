import { Schema } from "effect";
import {
  AddressId,
  CustomerId,
  PaymentMethodId,
  SubscriptionId,
} from "../customers/schema.js";
import { MealId } from "../meals/schema.js";
import { Currency } from "../plans/schema.js";

// --- Scalars -----------------------------------------------------------------

/** ISO 8601 in UTC, e.g. "2026-06-27T18:30:00Z". A plain string on the wire. */
const IsoTimestamp = Schema.String;

/**
 * Money in minor units (cents) as an integer — never a float. Frozen on the
 * order at order time, so later plan edits never rewrite billing history.
 */
const Money = Schema.Number;

/** Minor-unit money accepted from clients: a non-negative integer. */
const MoneyInput = Schema.Number.pipe(Schema.int(), Schema.nonNegative());

// --- Branded ID --------------------------------------------------------------

export const OrderId = Schema.String.pipe(Schema.brand("OrderId"));
export type OrderId = typeof OrderId.Type;

// --- Enums -------------------------------------------------------------------

/** Lifecycle of a single box order. `canceled` is terminal. */
export const OrderStatus = Schema.Literal(
  "pending",
  "shipped",
  "delivered",
  "canceled",
);
export type OrderStatus = typeof OrderStatus.Type;

/** Shipping carrier handling the box. */
export const Carrier = Schema.Literal("ups", "fedex", "usps", "dhl");
export type Carrier = typeof Carrier.Type;

// --- Sub-objects -------------------------------------------------------------

/** One meal in the box. Repeats are a `quantity` > 1, not duplicate rows. */
export const OrderLine = Schema.Struct({
  mealId: MealId,
  quantity: Schema.Int.pipe(Schema.greaterThanOrEqualTo(1)),
});
export type OrderLine = typeof OrderLine.Type;

// --- Canonical record --------------------------------------------------------

export const Order = Schema.Struct({
  id: OrderId,

  /** The subscription that generated this box, and its owner. */
  subscriptionId: SubscriptionId,
  customerId: CustomerId,

  status: OrderStatus,

  // Fulfillment — where the box is going and how it was paid. References
  // records that live on the Customer (mutable while `pending`).
  addressId: AddressId,
  paymentMethodId: PaymentMethodId,

  /** When this box is scheduled to arrive. */
  deliveryDate: IsoTimestamp,

  // Price snapshot — frozen at order time so later plan edits don't rewrite
  // billing history. Answers "how much was my last box?".
  price: Money,
  currency: Currency,

  // What's in the box. References Meal rows (never deleted, so retired meals
  // still resolve). Total quantity matches the plan's `mealsPerWeek` — enforced
  // in the repository at create time.
  items: Schema.Array(OrderLine),

  // Shipment — populated once the box leaves the warehouse (status `shipped`+).
  // Both absent while `pending`.
  carrier: Schema.optional(Carrier),
  trackingNumber: Schema.optional(Schema.String),

  updatedAt: IsoTimestamp,
  createdAt: IsoTimestamp,
});
export type Order = typeof Order.Type;

// --- Request payloads --------------------------------------------------------

/** Fields accepted when placing an order. `customerId` is derived from the
 *  subscription (never trusted from the client); `status` starts `pending`, the
 *  shipment fields stay absent until it ships, and timestamps are
 *  server-controlled — so none of those are accepted here. */
export const CreateOrderPayload = Schema.Struct({
  subscriptionId: SubscriptionId,
  addressId: AddressId,
  paymentMethodId: PaymentMethodId,
  deliveryDate: IsoTimestamp,
  price: MoneyInput,
  currency: Currency,
  items: Schema.Array(OrderLine),
});
export type CreateOrderPayload = typeof CreateOrderPayload.Type;

/** Every field optional — send only what changed. `status` drives the lifecycle
 *  (pending → shipped → delivered, pending → canceled); `carrier`/`trackingNumber`
 *  are set when shipping. The fulfillment fields are editable only while
 *  `pending`. `price`, `currency`, and `items` are frozen and never accepted. */
export const UpdateOrderPayload = Schema.Struct({
  status: Schema.optional(OrderStatus),
  carrier: Schema.optional(Carrier),
  trackingNumber: Schema.optional(Schema.String),
  addressId: Schema.optional(AddressId),
  paymentMethodId: Schema.optional(PaymentMethodId),
  deliveryDate: Schema.optional(IsoTimestamp),
});
export type UpdateOrderPayload = typeof UpdateOrderPayload.Type;

/** Filters for `GET /orders` — AND-combined; none → recent rows. */
export const OrderListQuery = Schema.Struct({
  customerId: Schema.optional(CustomerId),
  subscriptionId: Schema.optional(SubscriptionId),
  status: Schema.optional(OrderStatus),
});
export type OrderListQuery = typeof OrderListQuery.Type;

// --- Errors ------------------------------------------------------------------

export class OrderNotFound extends Schema.TaggedError<OrderNotFound>()(
  "OrderNotFound",
  { orderId: Schema.String },
) {}

/** Requested a transition the lifecycle doesn't allow — e.g. canceling a
 *  shipped box, or anything out of the terminal `delivered`/`canceled` states. */
export class InvalidOrderTransition extends Schema.TaggedError<InvalidOrderTransition>()(
  "InvalidOrderTransition",
  { orderId: Schema.String, from: OrderStatus, to: OrderStatus },
) {}

/** Tried to mark a box `shipped` without the carrier + tracking number that a
 *  box leaving the warehouse must carry. */
export class ShipmentDetailsRequired extends Schema.TaggedError<ShipmentDetailsRequired>()(
  "ShipmentDetailsRequired",
  { orderId: Schema.String },
) {}

/** The box's total meal quantity must equal the plan's `mealsPerWeek`. */
export class OrderItemsMismatch extends Schema.TaggedError<OrderItemsMismatch>()(
  "OrderItemsMismatch",
  { expected: Schema.Number, actual: Schema.Number },
) {}

/** Fulfillment (address / payment / delivery date) can only change while the
 *  order is still `pending` — once it ships the destination is locked in. */
export class FulfillmentNotEditable extends Schema.TaggedError<FulfillmentNotEditable>()(
  "FulfillmentNotEditable",
  { orderId: Schema.String, status: OrderStatus },
) {}
