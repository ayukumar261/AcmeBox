import { HttpApiEndpoint, HttpApiGroup } from "@effect/platform";
import { Schema } from "effect";
import {
  AddressNotFound,
  PaymentMethodNotFound,
} from "../customers/schema.js";
import { MealNotFound } from "../meals/schema.js";
import { PlanNotFound } from "../plans/schema.js";
import { SubscriptionNotFound } from "../subscriptions/schema.js";
import {
  CreateOrderPayload,
  FulfillmentNotEditable,
  InvalidOrderTransition,
  Order,
  OrderId,
  OrderItemsMismatch,
  OrderListQuery,
  OrderNotFound,
  ShipmentDetailsRequired,
  UpdateOrderPayload,
} from "./schema.js";

const OrderPath = Schema.Struct({ orderId: OrderId });

export const OrdersGroup = HttpApiGroup.make("orders")
  // GET /orders?customerId=&subscriptionId=&status= — look up orders.
  .add(
    HttpApiEndpoint.get("list", "/orders")
      .setUrlParams(OrderListQuery)
      .addSuccess(Schema.Array(Order)),
  )
  // GET /orders/:orderId — the canonical record.
  .add(
    HttpApiEndpoint.get("getById", "/orders/:orderId")
      .setPath(OrderPath)
      .addSuccess(Order)
      .addError(OrderNotFound, { status: 404 }),
  )
  // POST /orders — place a box order for a subscription.
  .add(
    HttpApiEndpoint.post("create", "/orders")
      .setPayload(CreateOrderPayload)
      .addSuccess(Order, { status: 201 })
      .addError(SubscriptionNotFound, { status: 404 })
      .addError(AddressNotFound, { status: 404 })
      .addError(PaymentMethodNotFound, { status: 404 })
      .addError(MealNotFound, { status: 404 })
      .addError(PlanNotFound, { status: 404 })
      .addError(OrderItemsMismatch, { status: 422 }),
  )
  // PATCH /orders/:orderId — advance the lifecycle / set shipment / reschedule.
  .add(
    HttpApiEndpoint.patch("update", "/orders/:orderId")
      .setPath(OrderPath)
      .setPayload(UpdateOrderPayload)
      .addSuccess(Order)
      .addError(OrderNotFound, { status: 404 })
      .addError(AddressNotFound, { status: 404 })
      .addError(PaymentMethodNotFound, { status: 404 })
      .addError(InvalidOrderTransition, { status: 409 })
      .addError(FulfillmentNotEditable, { status: 409 })
      .addError(ShipmentDetailsRequired, { status: 422 }),
  );
