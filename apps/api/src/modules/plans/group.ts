import { HttpApiEndpoint, HttpApiGroup } from "@effect/platform";
import { Schema } from "effect";
import {
  CreatePlanPayload,
  Plan,
  PlanId,
  PlanListQuery,
  PlanNotFound,
  UpdatePlanPayload,
} from "./schema.js";

const PlanPath = Schema.Struct({ planId: PlanId });

export const PlansGroup = HttpApiGroup.make("plans")
  // GET /plans?active=&country=&currency= — browse the catalog.
  .add(
    HttpApiEndpoint.get("list", "/plans")
      .setUrlParams(PlanListQuery)
      .addSuccess(Schema.Array(Plan)),
  )
  // GET /plans/:planId — a single catalog entry.
  .add(
    HttpApiEndpoint.get("getById", "/plans/:planId")
      .setPath(PlanPath)
      .addSuccess(Plan)
      .addError(PlanNotFound, { status: 404 }),
  )
  // POST /plans — add a plan to the catalog.
  .add(
    HttpApiEndpoint.post("create", "/plans")
      .setPayload(CreatePlanPayload)
      .addSuccess(Plan, { status: 201 }),
  )
  // PATCH /plans/:planId — retire / re-list (active flag only).
  .add(
    HttpApiEndpoint.patch("update", "/plans/:planId")
      .setPath(PlanPath)
      .setPayload(UpdatePlanPayload)
      .addSuccess(Plan)
      .addError(PlanNotFound, { status: 404 }),
  );
