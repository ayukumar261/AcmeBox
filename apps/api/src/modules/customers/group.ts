import { HttpApiEndpoint, HttpApiGroup } from "@effect/platform";
import { Schema } from "effect";
import {
  CreateCustomerPayload,
  Customer,
  CustomerId,
  CustomerListQuery,
  CustomerNotFound,
  EmailAlreadyExists,
  UpdateCustomerPayload,
} from "./schema.js";

const CustomerPath = Schema.Struct({ customerId: CustomerId });

export const CustomersGroup = HttpApiGroup.make("customers")
  // GET /customers?email=&phone= — look up a caller.
  .add(
    HttpApiEndpoint.get("list", "/customers")
      .setUrlParams(CustomerListQuery)
      .addSuccess(Schema.Array(Customer)),
  )
  // GET /customers/:customerId — the canonical record.
  .add(
    HttpApiEndpoint.get("getById", "/customers/:customerId")
      .setPath(CustomerPath)
      .addSuccess(Customer)
      .addError(CustomerNotFound, { status: 404 }),
  )
  // POST /customers — create.
  .add(
    HttpApiEndpoint.post("create", "/customers")
      .setPayload(CreateCustomerPayload)
      .addSuccess(Customer, { status: 201 })
      .addError(EmailAlreadyExists, { status: 409 }),
  )
  // PATCH /customers/:customerId — edit identity / contact / localization.
  .add(
    HttpApiEndpoint.patch("update", "/customers/:customerId")
      .setPath(CustomerPath)
      .setPayload(UpdateCustomerPayload)
      .addSuccess(Customer)
      .addError(CustomerNotFound, { status: 404 }),
  );
