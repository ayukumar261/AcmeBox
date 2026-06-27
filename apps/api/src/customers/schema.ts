import { Schema } from "effect";

// --- Scalars -----------------------------------------------------------------

/** ISO 8601 in UTC, e.g. "2026-06-27T18:30:00Z". A plain string on the wire. */
const IsoTimestamp = Schema.String;

/** ISO 3166-1 alpha-2, e.g. "US". */
const CountryCode = Schema.String;

/** A light sanity check so `POST /customers` rejects obvious garbage. */
const Email = Schema.String.pipe(
  Schema.pattern(/^[^@\s]+@[^@\s]+\.[^@\s]+$/, {
    message: () => "must be a valid email address",
  }),
);

// --- Branded IDs -------------------------------------------------------------
// Branded at the type level; plain strings over the wire. `setPath`/`setPayload`
// decode raw strings into these so handlers can't mix one id up for another.

export const CustomerId = Schema.String.pipe(Schema.brand("CustomerId"));
export type CustomerId = typeof CustomerId.Type;

export const SubscriptionId = Schema.String.pipe(Schema.brand("SubscriptionId"));
export type SubscriptionId = typeof SubscriptionId.Type;

export const AddressId = Schema.String.pipe(Schema.brand("AddressId"));
export type AddressId = typeof AddressId.Type;

export const PaymentMethodId = Schema.String.pipe(
  Schema.brand("PaymentMethodId"),
);
export type PaymentMethodId = typeof PaymentMethodId.Type;

// --- Enums -------------------------------------------------------------------

export const Card = Schema.Literal("visa", "mastercard", "amex", "discover");

// --- Sub-objects -------------------------------------------------------------

export const Address = Schema.Struct({
  id: AddressId,
  line1: Schema.String,
  line2: Schema.optional(Schema.String),
  city: Schema.String,
  region: Schema.String,
  postalCode: Schema.String,
  country: CountryCode,
  deliveryNotes: Schema.optional(Schema.String),
});
export type Address = typeof Address.Type;

export const PaymentMethod = Schema.Struct({
  id: PaymentMethodId,
  brand: Card,
  last4: Schema.String,
  expiryMonth: Schema.Number,
  expiryYear: Schema.Number,
});
export type PaymentMethod = typeof PaymentMethod.Type;

// --- Canonical record --------------------------------------------------------

export const Customer = Schema.Struct({
  id: CustomerId,

  email: Schema.String,
  emailVerified: Schema.Boolean,
  phone: Schema.optional(Schema.String),
  phoneVerified: Schema.Boolean,
  firstName: Schema.String,
  lastName: Schema.String,

  updatedAt: IsoTimestamp,
  createdAt: IsoTimestamp,

  locale: Schema.String,
  timezone: Schema.String,
  country: CountryCode,

  subscriptionId: Schema.optional(SubscriptionId),

  addresses: Schema.Array(Address),
  defaultAddressId: Schema.optional(AddressId),

  paymentMethods: Schema.Array(PaymentMethod),
  defaultPaymentMethodId: Schema.optional(PaymentMethodId),
});
export type Customer = typeof Customer.Type;

// --- Request payloads --------------------------------------------------------

/** Fields accepted when creating a customer. Verification flags, relationships,
 *  and timestamps are server-controlled and never accepted here. */
export const CreateCustomerPayload = Schema.Struct({
  email: Email,
  firstName: Schema.String,
  lastName: Schema.String,
  phone: Schema.optional(Schema.String),
  locale: Schema.String,
  timezone: Schema.String,
  country: CountryCode,
});
export type CreateCustomerPayload = typeof CreateCustomerPayload.Type;

/** Identity / contact / localization fields a support bot may edit. Every field
 *  is optional — send only what changed. */
export const UpdateCustomerPayload = Schema.Struct({
  firstName: Schema.optional(Schema.String),
  lastName: Schema.optional(Schema.String),
  phone: Schema.optional(Schema.String),
  locale: Schema.optional(Schema.String),
  timezone: Schema.optional(Schema.String),
  country: Schema.optional(CountryCode),
});
export type UpdateCustomerPayload = typeof UpdateCustomerPayload.Type;

/** Lookup filters for `GET /customers` — how a bot identifies a caller. */
export const CustomerListQuery = Schema.Struct({
  email: Schema.optional(Schema.String),
  phone: Schema.optional(Schema.String),
});
export type CustomerListQuery = typeof CustomerListQuery.Type;

// --- Address request payloads ------------------------------------------------

export const CreateAddressPayload = Schema.Struct({
  line1: Schema.String,
  line2: Schema.optional(Schema.String),
  city: Schema.String,
  region: Schema.String,
  postalCode: Schema.String,
  country: CountryCode,
  deliveryNotes: Schema.optional(Schema.String),
});
export type CreateAddressPayload = typeof CreateAddressPayload.Type;

/** Every field optional — send only what changed. */
export const UpdateAddressPayload = Schema.Struct({
  line1: Schema.optional(Schema.String),
  line2: Schema.optional(Schema.String),
  city: Schema.optional(Schema.String),
  region: Schema.optional(Schema.String),
  postalCode: Schema.optional(Schema.String),
  country: Schema.optional(CountryCode),
  deliveryNotes: Schema.optional(Schema.String),
});
export type UpdateAddressPayload = typeof UpdateAddressPayload.Type;

/** Body for `PUT /customers/:customerId/default-address`. */
export const SetDefaultAddressPayload = Schema.Struct({
  addressId: AddressId,
});
export type SetDefaultAddressPayload = typeof SetDefaultAddressPayload.Type;

// --- Errors ------------------------------------------------------------------

export class CustomerNotFound extends Schema.TaggedError<CustomerNotFound>()(
  "CustomerNotFound",
  { customerId: Schema.String },
) {}

export class EmailAlreadyExists extends Schema.TaggedError<EmailAlreadyExists>()(
  "EmailAlreadyExists",
  { email: Schema.String },
) {}

export class AddressNotFound extends Schema.TaggedError<AddressNotFound>()(
  "AddressNotFound",
  { customerId: Schema.String, addressId: Schema.String },
) {}
