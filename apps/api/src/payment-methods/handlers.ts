import { HttpApiBuilder } from "@effect/platform";
import { Effect } from "effect";
import { Api } from "../api.js";
import { PaymentMethodsRepository } from "./repository.js";

export const PaymentMethodsLive = HttpApiBuilder.group(
  Api,
  "paymentMethods",
  (handlers) =>
    Effect.gen(function* () {
      const paymentMethods = yield* PaymentMethodsRepository;
      return handlers
        .handle("list", ({ path }) => paymentMethods.list(path.customerId))
        .handle("create", ({ path, payload }) =>
          paymentMethods.create(path.customerId, payload),
        )
        .handle("remove", ({ path }) =>
          paymentMethods.remove(path.customerId, path.paymentMethodId),
        )
        .handle("setDefault", ({ path, payload }) =>
          paymentMethods.setDefault(path.customerId, payload.paymentMethodId),
        );
    }),
);
