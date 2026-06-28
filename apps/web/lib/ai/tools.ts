import { tool, type ToolSet } from "ai"
import { z } from "zod"

import { callAcmebox, type HttpMethod } from "./acmebox-client"

/**
 * The AcmeBox tool surface, mirroring the auto-derived tools in apps/mcp /
 * apps/eval. Each tool exposes a `{ path?, urlParams?, payload? }` argument
 * shape (the same convention as apps/mcp/src/schema.ts): `path` and `payload`
 * are required when the endpoint has them, `urlParams` is always optional.
 *
 * `execute` never throws — HTTP errors and exceptions are returned as data so
 * the model can read them and recover (mirrors the error handling added in
 * apps/eval commit 0bf3146).
 */

const id = (label: string) => z.string().describe(label)

interface ApiToolDef {
  description: string
  method: HttpMethod
  /** Path template with `:param` placeholders. */
  path: string
  inputSchema: z.ZodTypeAny
}

function apiTool(def: ApiToolDef) {
  return tool({
    description: def.description,
    inputSchema: def.inputSchema,
    execute: async (args: unknown) => {
      const a = (args ?? {}) as {
        path?: Record<string, string | number>
        urlParams?: Record<string, unknown>
        payload?: unknown
      }
      try {
        const result = await callAcmebox({
          method: def.method,
          pathTemplate: def.path,
          path: a.path,
          urlParams: a.urlParams,
          payload: a.payload,
        })
        if (!result.ok) {
          return { error: true, status: result.status, detail: result.error }
        }
        return result.data ?? { ok: true, status: result.status }
      } catch (err) {
        return { error: true, detail: err instanceof Error ? err.message : String(err) }
      }
    },
  })
}

// Shared enums / value hints.
const currency = z.enum(["USD", "EUR", "GBP", "CAD", "AUD"])
const deliveryDay = z.enum([
  "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday",
])
const subscriptionStatus = z.enum(["active", "paused", "canceled"])
const orderStatus = z.enum(["pending", "shipped", "delivered", "canceled"])
const carrier = z.enum(["ups", "fedex", "usps", "dhl"])
const cardBrand = z.enum(["visa", "mastercard", "amex", "discover"])

export const acmeboxTools = {
  // ----- Health -----
  health_check: apiTool({
    description: "Health check for the AcmeBox API.",
    method: "GET",
    path: "/health",
    inputSchema: z.object({}),
  }),

  // ----- Customers -----
  customers_list: apiTool({
    description: "Search customers by email and/or phone (AND-combined).",
    method: "GET",
    path: "/customers",
    inputSchema: z.object({
      urlParams: z
        .object({ email: z.string().optional(), phone: z.string().optional() })
        .optional(),
    }),
  }),
  customers_getById: apiTool({
    description: "Fetch a single customer by id (use this to verify identity).",
    method: "GET",
    path: "/customers/:customerId",
    inputSchema: z.object({ path: z.object({ customerId: id("Customer id, e.g. cus_...") }) }),
  }),
  customers_create: apiTool({
    description: "Create a new customer.",
    method: "POST",
    path: "/customers",
    inputSchema: z.object({
      payload: z.object({
        email: z.string(),
        firstName: z.string(),
        lastName: z.string(),
        phone: z.string().optional(),
        locale: z.string().describe("e.g. en-US"),
        timezone: z.string().describe("IANA tz, e.g. America/New_York"),
        country: z.string().describe("ISO 3166-1 alpha-2, e.g. US"),
      }),
    }),
  }),
  customers_update: apiTool({
    description: "Update mutable fields on a customer.",
    method: "PATCH",
    path: "/customers/:customerId",
    inputSchema: z.object({
      path: z.object({ customerId: id("Customer id") }),
      payload: z.object({
        firstName: z.string().optional(),
        lastName: z.string().optional(),
        phone: z.string().optional(),
        locale: z.string().optional(),
        timezone: z.string().optional(),
        country: z.string().optional(),
      }),
    }),
  }),

  // ----- Addresses -----
  addresses_list: apiTool({
    description: "List a customer's addresses (authoritative source before any change).",
    method: "GET",
    path: "/customers/:customerId/addresses",
    inputSchema: z.object({ path: z.object({ customerId: id("Customer id") }) }),
  }),
  addresses_create: apiTool({
    description: "Add a new address to a customer.",
    method: "POST",
    path: "/customers/:customerId/addresses",
    inputSchema: z.object({
      path: z.object({ customerId: id("Customer id") }),
      payload: z.object({
        line1: z.string(),
        line2: z.string().optional(),
        city: z.string(),
        region: z.string(),
        postalCode: z.string(),
        country: z.string(),
        deliveryNotes: z.string().optional(),
      }),
    }),
  }),
  addresses_update: apiTool({
    description: "Update an existing address.",
    method: "PATCH",
    path: "/customers/:customerId/addresses/:addressId",
    inputSchema: z.object({
      path: z.object({ customerId: id("Customer id"), addressId: id("Address id, e.g. adr_...") }),
      payload: z.object({
        line1: z.string().optional(),
        line2: z.string().optional(),
        city: z.string().optional(),
        region: z.string().optional(),
        postalCode: z.string().optional(),
        country: z.string().optional(),
        deliveryNotes: z.string().optional(),
      }),
    }),
  }),
  addresses_remove: apiTool({
    description: "Delete an address from a customer.",
    method: "DELETE",
    path: "/customers/:customerId/addresses/:addressId",
    inputSchema: z.object({
      path: z.object({ customerId: id("Customer id"), addressId: id("Address id") }),
    }),
  }),
  addresses_setDefault: apiTool({
    description:
      "Set a customer's default shipping address. Only use an addressId returned by addresses_list.",
    method: "PUT",
    path: "/customers/:customerId/default-address",
    inputSchema: z.object({
      path: z.object({ customerId: id("Customer id") }),
      payload: z.object({ addressId: id("Address id from addresses_list") }),
    }),
  }),

  // ----- Payment methods -----
  paymentMethods_list: apiTool({
    description: "List a customer's payment methods.",
    method: "GET",
    path: "/customers/:customerId/payment-methods",
    inputSchema: z.object({ path: z.object({ customerId: id("Customer id") }) }),
  }),
  paymentMethods_create: apiTool({
    description: "Add a payment method token to a customer.",
    method: "POST",
    path: "/customers/:customerId/payment-methods",
    inputSchema: z.object({
      path: z.object({ customerId: id("Customer id") }),
      payload: z.object({
        brand: cardBrand,
        last4: z.string().describe("Exactly 4 digits"),
        expiryMonth: z.number().int().min(1).max(12),
        expiryYear: z.number().int().min(2000).max(2100),
      }),
    }),
  }),
  paymentMethods_remove: apiTool({
    description: "Remove a payment method from a customer.",
    method: "DELETE",
    path: "/customers/:customerId/payment-methods/:paymentMethodId",
    inputSchema: z.object({
      path: z.object({ customerId: id("Customer id"), paymentMethodId: id("Payment method id, e.g. pm_...") }),
    }),
  }),
  paymentMethods_setDefault: apiTool({
    description: "Set a customer's default payment method.",
    method: "PUT",
    path: "/customers/:customerId/default-payment-method",
    inputSchema: z.object({
      path: z.object({ customerId: id("Customer id") }),
      payload: z.object({ paymentMethodId: id("Payment method id") }),
    }),
  }),

  // ----- Plans -----
  plans_list: apiTool({
    description: "List meal-kit plans, optionally filtered.",
    method: "GET",
    path: "/plans",
    inputSchema: z.object({
      urlParams: z
        .object({
          active: z.boolean().optional(),
          country: z.string().optional(),
          currency: currency.optional(),
        })
        .optional(),
    }),
  }),
  plans_getById: apiTool({
    description: "Fetch a single plan by id.",
    method: "GET",
    path: "/plans/:planId",
    inputSchema: z.object({ path: z.object({ planId: id("Plan id, e.g. plan_...") }) }),
  }),
  plans_create: apiTool({
    description: "Create a new plan.",
    method: "POST",
    path: "/plans",
    inputSchema: z.object({
      payload: z.object({
        name: z.string(),
        mealsPerWeek: z.union([z.literal(2), z.literal(4), z.literal(6), z.literal(8)]),
        servingsPerMeal: z.union([z.literal(2), z.literal(4)]),
        currency,
        country: z.string(),
        pricePerServing: z.number().int().min(0).describe("Minor units (cents)"),
        active: z.boolean().optional(),
      }),
    }),
  }),
  plans_update: apiTool({
    description: "Update a plan (only the active flag can change).",
    method: "PATCH",
    path: "/plans/:planId",
    inputSchema: z.object({
      path: z.object({ planId: id("Plan id") }),
      payload: z.object({ active: z.boolean().optional() }),
    }),
  }),

  // ----- Meals -----
  meals_list: apiTool({
    description: "List meals in the recipe catalog.",
    method: "GET",
    path: "/meals",
    inputSchema: z.object({
      urlParams: z.object({ isActive: z.boolean().optional() }).optional(),
    }),
  }),
  meals_getById: apiTool({
    description: "Fetch a single meal by id.",
    method: "GET",
    path: "/meals/:mealId",
    inputSchema: z.object({ path: z.object({ mealId: id("Meal id, e.g. meal_...") }) }),
  }),
  meals_create: apiTool({
    description: "Create a new meal.",
    method: "POST",
    path: "/meals",
    inputSchema: z.object({
      payload: z.object({
        name: z.string(),
        steps: z.array(z.string()),
        ingredients: z.array(z.string()),
        isActive: z.boolean().optional(),
      }),
    }),
  }),

  // ----- Subscriptions -----
  subscriptions_list: apiTool({
    description: "List subscriptions, optionally filtered by customer and/or status.",
    method: "GET",
    path: "/subscriptions",
    inputSchema: z.object({
      urlParams: z
        .object({ customerId: z.string().optional(), status: subscriptionStatus.optional() })
        .optional(),
    }),
  }),
  subscriptions_getById: apiTool({
    description: "Fetch a single subscription by id.",
    method: "GET",
    path: "/subscriptions/:subscriptionId",
    inputSchema: z.object({ path: z.object({ subscriptionId: id("Subscription id, e.g. sub_...") }) }),
  }),
  subscriptions_create: apiTool({
    description: "Create a subscription for a customer.",
    method: "POST",
    path: "/subscriptions",
    inputSchema: z.object({
      payload: z.object({
        customerId: id("Customer id"),
        planId: id("Plan id"),
        deliveryDay,
        deliveryAddressId: id("Address id"),
        paymentMethodId: id("Payment method id"),
        nextDeliveryDate: z.string().describe("ISO 8601 date-time"),
      }),
    }),
  }),
  subscriptions_update: apiTool({
    description: "Update a subscription (status transitions, plan, delivery, etc.).",
    method: "PATCH",
    path: "/subscriptions/:subscriptionId",
    inputSchema: z.object({
      path: z.object({ subscriptionId: id("Subscription id") }),
      payload: z.object({
        status: subscriptionStatus.optional(),
        planId: z.string().optional(),
        deliveryDay: deliveryDay.optional(),
        deliveryAddressId: z.string().optional(),
        paymentMethodId: z.string().optional(),
        nextDeliveryDate: z.string().optional(),
      }),
    }),
  }),

  // ----- Orders -----
  orders_list: apiTool({
    description: "List orders, optionally filtered by customer, subscription and/or status.",
    method: "GET",
    path: "/orders",
    inputSchema: z.object({
      urlParams: z
        .object({
          customerId: z.string().optional(),
          subscriptionId: z.string().optional(),
          status: orderStatus.optional(),
        })
        .optional(),
    }),
  }),
  orders_getById: apiTool({
    description: "Fetch a single order by id (delivery status, tracking, etc.).",
    method: "GET",
    path: "/orders/:orderId",
    inputSchema: z.object({ path: z.object({ orderId: id("Order id, e.g. ord_...") }) }),
  }),
  orders_create: apiTool({
    description: "Create an order. Total item quantity must equal the plan's mealsPerWeek.",
    method: "POST",
    path: "/orders",
    inputSchema: z.object({
      payload: z.object({
        subscriptionId: id("Subscription id"),
        addressId: id("Address id"),
        paymentMethodId: id("Payment method id"),
        deliveryDate: z.string().describe("ISO 8601 date-time"),
        price: z.number().int().min(0).describe("Minor units (cents)"),
        currency,
        items: z.array(z.object({ mealId: id("Meal id"), quantity: z.number().int().min(1) })),
      }),
    }),
  }),
  orders_update: apiTool({
    description:
      "Update an order. Moving to 'shipped' requires carrier and trackingNumber; address/payment/delivery editable only while 'pending'.",
    method: "PATCH",
    path: "/orders/:orderId",
    inputSchema: z.object({
      path: z.object({ orderId: id("Order id") }),
      payload: z.object({
        status: orderStatus.optional(),
        carrier: carrier.optional(),
        trackingNumber: z.string().optional(),
        addressId: z.string().optional(),
        paymentMethodId: z.string().optional(),
        deliveryDate: z.string().optional(),
      }),
    }),
  }),
} satisfies ToolSet
