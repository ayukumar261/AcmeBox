import {
  type CustomerId,
  type PaymentMethodId,
  type SubscriptionId,
} from "../customers/schema.js";
import { type OrderId } from "../orders/schema.js";
import { type Payment, type PaymentId, type PaymentStatus } from "./schema.js";

// Shape of a `payments` row as Postgres hands it back (snake_case columns).
export interface PaymentRow {
  readonly id: string;
  readonly customer_id: string;
  readonly order_id: string;
  readonly subscription_id: string;
  readonly payment_method_id: string;
  readonly status: string;
  readonly amount: number;
  readonly currency: string;
  readonly processor_ref: string | null;
  readonly failure_reason: string | null;
  readonly refund_reason: string | null;
  readonly processed_at: Date | string | null;
  readonly refunded_at: Date | string | null;
  readonly created_at: Date | string;
  readonly updated_at: Date | string;
}

const toIso = (value: Date | string): string =>
  (value instanceof Date ? value : new Date(value)).toISOString();

// `status` / `currency` are constrained to their literal unions on the way in,
// so the columns only ever hold a valid member. The nullable columns map to
// absent keys when NULL (matches the optional schema).
export const toPayment = (row: PaymentRow): Payment => ({
  id: row.id as PaymentId,
  customerId: row.customer_id as CustomerId,
  orderId: row.order_id as OrderId,
  subscriptionId: row.subscription_id as SubscriptionId,
  paymentMethodId: row.payment_method_id as PaymentMethodId,
  status: row.status as PaymentStatus,
  amount: row.amount,
  currency: row.currency as Payment["currency"],
  ...(row.processor_ref !== null ? { processorRef: row.processor_ref } : {}),
  ...(row.failure_reason !== null
    ? { failureReason: row.failure_reason }
    : {}),
  ...(row.refund_reason !== null ? { refundReason: row.refund_reason } : {}),
  ...(row.processed_at !== null
    ? { processedAt: toIso(row.processed_at) }
    : {}),
  ...(row.refunded_at !== null ? { refundedAt: toIso(row.refunded_at) } : {}),
  updatedAt: toIso(row.updated_at),
  createdAt: toIso(row.created_at),
});
