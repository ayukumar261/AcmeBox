import type { DerivedTool } from "./deriver.js";

/**
 * Tools served by the MCP process itself rather than derived from the REST API.
 * Same wire shape as a `DerivedTool` (so the server lists/looks them up
 * identically), but dispatched via `handle` instead of an in-process API call.
 * Use this for capabilities that have no HTTP endpoint behind them.
 */
export interface LocalTool {
  readonly tool: DerivedTool;
  readonly handle: (args: Record<string, unknown>) => Promise<unknown> | unknown;
}

/** Current date from the server clock — the model has no inherent sense of
 *  "today". `handle` never throws: an invalid timezone is returned as data. */
const timeNow: LocalTool = {
  tool: {
    name: "time_now",
    description:
      "Get the current date — year, month, day, and weekday — from the server " +
      "clock. Use whenever you need to know what 'today' is (e.g. to compute a " +
      "nextDeliveryDate or choose a deliveryDay). Defaults to UTC; pass an IANA " +
      "timezone to get the local date there.",
    inputSchema: {
      type: "object",
      properties: {
        timezone: {
          type: "string",
          description: "IANA timezone, e.g. America/New_York. Defaults to UTC.",
        },
      },
      additionalProperties: false,
    },
    // No API endpoint backs this tool; group/endpoint are descriptive only and
    // parts are all absent (it takes a flat `{ timezone? }` argument).
    group: "time",
    endpoint: "now",
    parts: { path: false, urlParams: false, payload: false },
  },
  handle: (args) => {
    const tz =
      typeof args.timezone === "string" && args.timezone ? args.timezone : "UTC";
    try {
      const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone: tz,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        weekday: "long",
      }).formatToParts(new Date());
      const get = (type: string): string =>
        parts.find((p) => p.type === type)?.value ?? "";
      return {
        year: Number(get("year")),
        month: Number(get("month")),
        day: Number(get("day")),
        weekday: get("weekday"),
        date: `${get("year")}-${get("month")}-${get("day")}`, // ISO 8601 (YYYY-MM-DD)
        timezone: tz,
      };
    } catch (error) {
      return {
        error: true,
        detail: error instanceof Error ? error.message : String(error),
      };
    }
  },
};

export const localTools: readonly LocalTool[] = [timeNow];
