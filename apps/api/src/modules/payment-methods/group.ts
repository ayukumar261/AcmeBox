import {
  HttpApiEndpoint,
  HttpApiGroup,
  HttpApiSchema,
} from "@effect/platform";
import { Schema } from "effect";
import {
  CreatePaymentMethodPayload,
  Customer,
  CustomerId,
  CustomerNotFound,
  PaymentMethod,
  PaymentMethodId,
  PaymentMethodNotFound,
  SetDefaultPaymentMethodPayload,
} from "../customers/schema.js";

const CustomerPath = Schema.Struct({ customerId: CustomerId });
const PaymentMethodPath = Schema.Struct({
  customerId: CustomerId,
  paymentMethodId: PaymentMethodId,
});

export const PaymentMethodsGroup = HttpApiGroup.make("paymentMethods")
  // GET /customers/:customerId/payment-methods
  .add(
    HttpApiEndpoint.get("list", "/customers/:customerId/payment-methods")
      .setPath(CustomerPath)
      .addSuccess(Schema.Array(PaymentMethod))
      .addError(CustomerNotFound, { status: 404 }),
  )
  // POST /customers/:customerId/payment-methods
  .add(
    HttpApiEndpoint.post("create", "/customers/:customerId/payment-methods")
      .setPath(CustomerPath)
      .setPayload(CreatePaymentMethodPayload)
      .addSuccess(PaymentMethod, { status: 201 })
      .addError(CustomerNotFound, { status: 404 }),
  )
  // DELETE /customers/:customerId/payment-methods/:paymentMethodId
  .add(
    HttpApiEndpoint.del(
      "remove",
      "/customers/:customerId/payment-methods/:paymentMethodId",
    )
      .setPath(PaymentMethodPath)
      .addSuccess(HttpApiSchema.NoContent)
      .addError(PaymentMethodNotFound, { status: 404 }),
  )
  // PUT /customers/:customerId/default-payment-method
  .add(
    HttpApiEndpoint.put(
      "setDefault",
      "/customers/:customerId/default-payment-method",
    )
      .setPath(CustomerPath)
      .setPayload(SetDefaultPaymentMethodPayload)
      .addSuccess(Customer)
      .addError(CustomerNotFound, { status: 404 })
      .addError(PaymentMethodNotFound, { status: 404 }),
  );
