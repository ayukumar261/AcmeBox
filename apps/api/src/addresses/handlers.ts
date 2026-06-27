import { HttpApiBuilder } from "@effect/platform";
import { Effect } from "effect";
import { Api } from "../api.js";
import { AddressesRepository } from "./repository.js";

export const AddressesLive = HttpApiBuilder.group(Api, "addresses", (handlers) =>
  Effect.gen(function* () {
    const addresses = yield* AddressesRepository;
    return handlers
      .handle("list", ({ path }) => addresses.list(path.customerId))
      .handle("create", ({ path, payload }) =>
        addresses.create(path.customerId, payload),
      )
      .handle("update", ({ path, payload }) =>
        addresses.update(path.customerId, path.addressId, payload),
      )
      .handle("remove", ({ path }) =>
        addresses.remove(path.customerId, path.addressId),
      )
      .handle("setDefault", ({ path, payload }) =>
        addresses.setDefault(path.customerId, payload.addressId),
      );
  }),
);
