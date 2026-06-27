import {
  HttpApiEndpoint,
  HttpApiGroup,
  HttpApiSchema,
} from "@effect/platform";
import { Schema } from "effect";
import {
  Address,
  AddressId,
  AddressNotFound,
  CreateAddressPayload,
  Customer,
  CustomerId,
  CustomerNotFound,
  SetDefaultAddressPayload,
  UpdateAddressPayload,
} from "../customers/schema.js";

const CustomerPath = Schema.Struct({ customerId: CustomerId });
const AddressPath = Schema.Struct({
  customerId: CustomerId,
  addressId: AddressId,
});

export const AddressesGroup = HttpApiGroup.make("addresses")
  // GET /customers/:customerId/addresses
  .add(
    HttpApiEndpoint.get("list", "/customers/:customerId/addresses")
      .setPath(CustomerPath)
      .addSuccess(Schema.Array(Address))
      .addError(CustomerNotFound, { status: 404 }),
  )
  // POST /customers/:customerId/addresses
  .add(
    HttpApiEndpoint.post("create", "/customers/:customerId/addresses")
      .setPath(CustomerPath)
      .setPayload(CreateAddressPayload)
      .addSuccess(Address, { status: 201 })
      .addError(CustomerNotFound, { status: 404 }),
  )
  // PATCH /customers/:customerId/addresses/:addressId
  .add(
    HttpApiEndpoint.patch("update", "/customers/:customerId/addresses/:addressId")
      .setPath(AddressPath)
      .setPayload(UpdateAddressPayload)
      .addSuccess(Address)
      .addError(AddressNotFound, { status: 404 }),
  )
  // DELETE /customers/:customerId/addresses/:addressId
  .add(
    HttpApiEndpoint.del("remove", "/customers/:customerId/addresses/:addressId")
      .setPath(AddressPath)
      .addSuccess(HttpApiSchema.NoContent)
      .addError(AddressNotFound, { status: 404 }),
  )
  // PUT /customers/:customerId/default-address
  .add(
    HttpApiEndpoint.put("setDefault", "/customers/:customerId/default-address")
      .setPath(CustomerPath)
      .setPayload(SetDefaultAddressPayload)
      .addSuccess(Customer)
      .addError(CustomerNotFound, { status: 404 })
      .addError(AddressNotFound, { status: 404 }),
  );
