import { HttpApi, HttpApiEndpoint, HttpApiGroup } from "@effect/platform";
import { Schema } from "effect";
import { AddressesGroup } from "./addresses/group.js";
import { CustomersGroup } from "./customers/group.js";

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
  .add(AddressesGroup);
