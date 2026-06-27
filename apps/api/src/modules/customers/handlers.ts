import { HttpApiBuilder } from "@effect/platform";
import { Effect } from "effect";
import { Api } from "../../api.js";
import { CustomersRepository } from "./repository.js";

export const CustomersLive = HttpApiBuilder.group(Api, "customers", (handlers) =>
  Effect.gen(function* () {
    const customers = yield* CustomersRepository;
    return handlers
      .handle("list", ({ urlParams }) => customers.list(urlParams))
      .handle("getById", ({ path }) => customers.findById(path.customerId))
      .handle("create", ({ payload }) => customers.create(payload))
      .handle("update", ({ path, payload }) =>
        customers.update(path.customerId, payload),
      );
  }),
);
