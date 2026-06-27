import { HttpApi, HttpApiEndpoint, HttpApiGroup } from "@effect/platform";
import { Schema } from "effect";
import { AddressesGroup } from "./modules/addresses/group.js";
import { CustomersGroup } from "./modules/customers/group.js";
import { PaymentMethodsGroup } from "./modules/payment-methods/group.js";
import { PlansGroup } from "./modules/plans/group.js";
import { SubscriptionsGroup } from "./modules/subscriptions/group.js";

// --- Schemas -----------------------------------------------------------------

const HealthResponse = Schema.Struct({
  status: Schema.Literal("ok"),
  uptime: Schema.Number,
});

// --- Groups ------------------------------------------------------------------

const HealthGroup = HttpApiGroup.make("health").add(
  HttpApiEndpoint.get("check", "/health").addSuccess(HealthResponse),
);

// --- API ---------------------------------------------------------------------

export const Api = HttpApi.make("AcmeBoxApi")
  .add(HealthGroup)
  .add(CustomersGroup)
  .add(AddressesGroup)
  .add(PaymentMethodsGroup)
  .add(PlansGroup)
  .add(SubscriptionsGroup);
