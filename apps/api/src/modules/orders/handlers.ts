import { HttpApiBuilder } from "@effect/platform";
import { Effect } from "effect";
import { Api } from "../../api.js";
import { OrdersRepository } from "./repository.js";

export const OrdersLive = HttpApiBuilder.group(Api, "orders", (handlers) =>
  Effect.gen(function* () {
    const orders = yield* OrdersRepository;
    return handlers
      .handle("list", ({ urlParams }) => orders.list(urlParams))
      .handle("getById", ({ path }) => orders.findById(path.orderId))
      .handle("create", ({ payload }) => orders.create(payload))
      .handle("update", ({ path, payload }) =>
        orders.update(path.orderId, payload),
      );
  }),
);
