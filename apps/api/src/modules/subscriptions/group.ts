import { HttpApiEndpoint, HttpApiGroup } from "@effect/platform";
import { Schema } from "effect";
import {
  AddressNotFound,
  CustomerNotFound,
  PaymentMethodNotFound,
  SubscriptionId,
} from "../customers/schema.js";
import { PlanNotFound } from "../plans/schema.js";
import {
  CreateSubscriptionPayload,
  CustomerAlreadySubscribed,
  InvalidSubscriptionTransition,
  PlanInactive,
  Subscription,
  SubscriptionListQuery,
  SubscriptionNotFound,
  UpdateSubscriptionPayload,
} from "./schema.js";

const SubscriptionPath = Schema.Struct({ subscriptionId: SubscriptionId });

export const SubscriptionsGroup = HttpApiGroup.make("subscriptions")
  // GET /subscriptions?customerId=&status= — look up subscriptions.
  .add(
    HttpApiEndpoint.get("list", "/subscriptions")
      .setUrlParams(SubscriptionListQuery)
      .addSuccess(Schema.Array(Subscription)),
  )
  // GET /subscriptions/:subscriptionId — the canonical record.
  .add(
    HttpApiEndpoint.get("getById", "/subscriptions/:subscriptionId")
      .setPath(SubscriptionPath)
      .addSuccess(Subscription)
      .addError(SubscriptionNotFound, { status: 404 }),
  )
  // POST /subscriptions — sign a customer up.
  .add(
    HttpApiEndpoint.post("create", "/subscriptions")
      .setPayload(CreateSubscriptionPayload)
      .addSuccess(Subscription, { status: 201 })
      .addError(CustomerNotFound, { status: 404 })
      .addError(PlanNotFound, { status: 404 })
      .addError(AddressNotFound, { status: 404 })
      .addError(PaymentMethodNotFound, { status: 404 })
      .addError(PlanInactive, { status: 422 })
      .addError(CustomerAlreadySubscribed, { status: 409 }),
  )
  // PATCH /subscriptions/:subscriptionId — change status / reschedule / switch plan.
  .add(
    HttpApiEndpoint.patch("update", "/subscriptions/:subscriptionId")
      .setPath(SubscriptionPath)
      .setPayload(UpdateSubscriptionPayload)
      .addSuccess(Subscription)
      .addError(SubscriptionNotFound, { status: 404 })
      .addError(PlanNotFound, { status: 404 })
      .addError(AddressNotFound, { status: 404 })
      .addError(PaymentMethodNotFound, { status: 404 })
      .addError(PlanInactive, { status: 422 })
      .addError(InvalidSubscriptionTransition, { status: 409 }),
  );
