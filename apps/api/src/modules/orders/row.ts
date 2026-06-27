import {
  type AddressId,
  type CustomerId,
  type PaymentMethodId,
  type SubscriptionId,
} from "../customers/schema.js";
import {
  type Carrier,
  type Order,
  type OrderId,
  type OrderLine,
  type OrderStatus,
} from "./schema.js";

// Shape of an `orders` row as Postgres hands it back (snake_case columns). The
// `items` jsonb column comes back already parsed into a JS array of OrderLine.
export interface OrderRow {
  readonly id: string;
  readonly subscription_id: string;
  readonly customer_id: string;
  readonly status: string;
  readonly address_id: string;
  readonly payment_method_id: string;
  readonly delivery_date: Date | string;
  readonly price: number;
  readonly currency: string;
  readonly items: readonly OrderLine[];
  readonly carrier: string | null;
  readonly tracking_number: string | null;
  readonly created_at: Date | string;
  readonly updated_at: Date | string;
}

const toIso = (value: Date | string): string =>
  (value instanceof Date ? value : new Date(value)).toISOString();

// `status` / `currency` are constrained to their literal unions on the way in,
// so the columns only ever hold a valid member. `carrier` / `tracking_number`
// are NULL while pending — mapped to absent keys (matches the optional schema).
export const toOrder = (row: OrderRow): Order => ({
  id: row.id as OrderId,
  subscriptionId: row.subscription_id as SubscriptionId,
  customerId: row.customer_id as CustomerId,
  status: row.status as OrderStatus,
  addressId: row.address_id as AddressId,
  paymentMethodId: row.payment_method_id as PaymentMethodId,
  deliveryDate: toIso(row.delivery_date),
  price: row.price,
  currency: row.currency as Order["currency"],
  items: row.items,
  ...(row.carrier !== null ? { carrier: row.carrier as Carrier } : {}),
  ...(row.tracking_number !== null
    ? { trackingNumber: row.tracking_number }
    : {}),
  updatedAt: toIso(row.updated_at),
  createdAt: toIso(row.created_at),
});
