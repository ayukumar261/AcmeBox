import { HttpApiBuilder } from "@effect/platform";
import { Effect } from "effect";
import { Api } from "../../api.js";
import { PaymentsRepository } from "./repository.js";

export const PaymentsLive = HttpApiBuilder.group(Api, "payments", (handlers) =>
  Effect.gen(function* () {
    const payments = yield* PaymentsRepository;
    return handlers
      .handle("list", ({ urlParams }) => payments.list(urlParams))
      .handle("getById", ({ path }) => payments.findById(path.paymentId))
      .handle("create", ({ payload }) => payments.create(payload))
      .handle("update", ({ path, payload }) =>
        payments.update(path.paymentId, payload),
      )
      .handle("refund", ({ path, payload }) =>
        payments.refund(path.paymentId, payload),
      );
  }),
);
