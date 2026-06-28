import { HttpApiEndpoint, HttpApiGroup } from "@effect/platform";
import { Schema } from "effect";
import { PaymentMethodNotFound } from "../customers/schema.js";
import { OrderNotFound } from "../orders/schema.js";
import {
  CreatePaymentPayload,
  InvalidPaymentTransition,
  Payment,
  PaymentId,
  PaymentListQuery,
  PaymentNotFound,
  RefundPaymentPayload,
  UpdatePaymentPayload,
} from "./schema.js";

const PaymentPath = Schema.Struct({ paymentId: PaymentId });

export const PaymentsGroup = HttpApiGroup.make("payments")
  // GET /payments?customerId=&subscriptionId=&orderId=&status= — look up
  // payments. Counting a customer's lifetime refunds is customerId + refunded.
  .add(
    HttpApiEndpoint.get("list", "/payments")
      .setUrlParams(PaymentListQuery)
      .addSuccess(Schema.Array(Payment)),
  )
  // GET /payments/:paymentId — the canonical record.
  .add(
    HttpApiEndpoint.get("getById", "/payments/:paymentId")
      .setPath(PaymentPath)
      .addSuccess(Payment)
      .addError(PaymentNotFound, { status: 404 }),
  )
  // POST /payments — record a charge for an order.
  .add(
    HttpApiEndpoint.post("create", "/payments")
      .setPayload(CreatePaymentPayload)
      .addSuccess(Payment, { status: 201 })
      .addError(OrderNotFound, { status: 404 })
      .addError(PaymentMethodNotFound, { status: 404 }),
  )
  // PATCH /payments/:paymentId — settle the charge (succeeded / failed).
  .add(
    HttpApiEndpoint.patch("update", "/payments/:paymentId")
      .setPath(PaymentPath)
      .setPayload(UpdatePaymentPayload)
      .addSuccess(Payment)
      .addError(PaymentNotFound, { status: 404 })
      .addError(InvalidPaymentTransition, { status: 409 }),
  )
  // POST /payments/:paymentId/refund — fully refund a succeeded charge.
  .add(
    HttpApiEndpoint.post("refund", "/payments/:paymentId/refund")
      .setPath(PaymentPath)
      .setPayload(RefundPaymentPayload)
      .addSuccess(Payment)
      .addError(PaymentNotFound, { status: 404 })
      .addError(InvalidPaymentTransition, { status: 409 }),
  );
