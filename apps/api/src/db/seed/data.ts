/**
 * Deterministic seed data for local development.
 *
 * Everything here is a *pure* function of a constant PRNG seed and a fixed
 * `NOW`, so `pnpm db:seed` produces byte-identical data on every run. There is
 * no `Date.now()`, `Math.random()`, or `randomUUID()` — that's what lets the
 * seed double as an idempotent "reset to a known world" command.
 *
 * The data is shaped to satisfy the support-agent policy (apps/eval/src/policy.md)
 * by construction: every customer has a default address + a valid default card,
 * at most one non-canceled subscription, orders whose meal quantity matches their
 * plan and whose price is the frozen `pricePerServing × servingsPerMeal ×
 * mealsPerWeek`, and payments that mirror those order prices. A handful of fixed
 * "hero" customers (cust_1 = Sam Rivera, etc.) are fully populated so you can
 * chat as a known account and exercise every scenario immediately.
 */

// ---------------------------------------------------------------------------
// Row shapes — keys are the exact DB column names so the inserts stay trivial.
// ---------------------------------------------------------------------------

export interface CustomerRow {
  id: string;
  email: string;
  email_verified: boolean;
  phone: string | null;
  phone_verified: boolean;
  first_name: string;
  last_name: string;
  locale: string;
  timezone: string;
  country: string;
  subscription_id: string | null;
  default_address_id: string | null;
  default_payment_method_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface AddressRow {
  id: string;
  customer_id: string;
  line1: string;
  line2: string | null;
  city: string;
  region: string;
  postal_code: string;
  country: string;
  delivery_notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface PaymentMethodRow {
  id: string;
  customer_id: string;
  brand: string;
  last4: string;
  expiry_month: number;
  expiry_year: number;
  created_at: string;
}

export interface PlanRow {
  id: string;
  name: string;
  meals_per_week: number;
  servings_per_meal: number;
  currency: string;
  country: string;
  price_per_serving: number;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export interface SubscriptionRow {
  id: string;
  customer_id: string;
  status: string;
  plan_id: string;
  delivery_day: string;
  delivery_address_id: string;
  payment_method_id: string;
  next_delivery_date: string;
  created_at: string;
  updated_at: string;
}

export interface MealRow {
  id: string;
  name: string;
  steps: string[];
  ingredients: string[];
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface OrderLine {
  mealId: string;
  quantity: number;
}

export interface OrderRow {
  id: string;
  subscription_id: string;
  customer_id: string;
  status: string;
  address_id: string;
  payment_method_id: string;
  delivery_date: string;
  price: number;
  currency: string;
  items: OrderLine[];
  carrier: string | null;
  tracking_number: string | null;
  created_at: string;
  updated_at: string;
}

export interface PaymentRow {
  id: string;
  customer_id: string;
  order_id: string;
  subscription_id: string;
  payment_method_id: string;
  status: string;
  amount: number;
  currency: string;
  processor_ref: string | null;
  failure_reason: string | null;
  refund_reason: string | null;
  processed_at: string | null;
  refunded_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface SeedData {
  customers: CustomerRow[];
  addresses: AddressRow[];
  payment_methods: PaymentMethodRow[];
  plans: PlanRow[];
  subscriptions: SubscriptionRow[];
  meals: MealRow[];
  orders: OrderRow[];
  payments: PaymentRow[];
}

// Insert order: parents before children. With FK triggers disabled during the
// seed transaction this is only cosmetic, but it keeps the data tidy and makes a
// triggers-on fallback possible later.
export const SEED_TABLE_ORDER = [
  "customers",
  "addresses",
  "payment_methods",
  "plans",
  "subscriptions",
  "meals",
  "orders",
  "payments",
] as const;

// ---------------------------------------------------------------------------
// Determinism primitives.
// ---------------------------------------------------------------------------

// Anchor every relative date to a fixed "today" so the data never drifts with
// the wall clock. Kept near the real current date (see currentDate in context)
// with comfortable margins, so the agent's live `time_now` still agrees on what
// is expired / upcoming.
const NOW = new Date("2026-06-27T00:00:00Z");

function addDays(base: Date, days: number): Date {
  return new Date(base.getTime() + days * 24 * 60 * 60 * 1000);
}

/** ISO timestamp `days` away from `NOW` (negative = past). */
function dayOffset(days: number): string {
  return addDays(NOW, days).toISOString();
}

/** Seeded PRNG (mulberry32) wrapped with the picks the generator needs. */
class Rng {
  private state: number;
  constructor(seed: number) {
    this.state = seed >>> 0;
  }
  private next(): number {
    this.state = (this.state + 0x6d2b79f5) | 0;
    let t = Math.imul(this.state ^ (this.state >>> 15), 1 | this.state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  /** Inclusive integer in [min, max]. */
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }
  pick<T>(arr: readonly T[]): T {
    return arr[this.int(0, arr.length - 1)]!;
  }
  /** `k` distinct elements, deterministic Fisher-Yates on a copy. */
  pickDistinct<T>(arr: readonly T[], k: number): T[] {
    const copy = [...arr];
    for (let i = copy.length - 1; i > 0; i--) {
      const j = this.int(0, i);
      [copy[i], copy[j]] = [copy[j]!, copy[i]!];
    }
    return copy.slice(0, Math.min(k, copy.length));
  }
  bool(probability: number): boolean {
    return this.next() < probability;
  }
}

const pad4 = (n: number): string => String(n).padStart(4, "0");

// ---------------------------------------------------------------------------
// Fixed pools.
// ---------------------------------------------------------------------------

const FIRST_NAMES = [
  "Sam", "Alex", "Jordan", "Taylor", "Morgan", "Casey", "Riley", "Quinn",
  "Parker", "Avery", "Jamie", "Drew", "Reese", "Skyler", "Cameron", "Hayden",
  "Rowan", "Emerson", "Finley", "Sawyer",
] as const;

const LAST_NAMES = [
  "Rivera", "Chen", "Lee", "Kim", "Patel", "Nguyen", "Garcia", "Murphy",
  "OBrien", "Ahmed", "Johnson", "Williams", "Brown", "Martinez", "Davis",
  "Lopez", "Walker", "Hall", "Young", "Carter",
] as const;

interface City {
  city: string;
  region: string;
  postalCode: string;
  timezone: string;
}

// US-only so every order's currency (USD, from the plans) stays consistent.
const CITIES: readonly City[] = [
  { city: "Chicago", region: "IL", postalCode: "60601", timezone: "America/Chicago" },
  { city: "Boston", region: "MA", postalCode: "02101", timezone: "America/New_York" },
  { city: "Austin", region: "TX", postalCode: "73301", timezone: "America/Chicago" },
  { city: "Seattle", region: "WA", postalCode: "98101", timezone: "America/Los_Angeles" },
  { city: "Denver", region: "CO", postalCode: "80201", timezone: "America/Denver" },
  { city: "Portland", region: "OR", postalCode: "97201", timezone: "America/Los_Angeles" },
  { city: "Miami", region: "FL", postalCode: "33101", timezone: "America/New_York" },
  { city: "Nashville", region: "TN", postalCode: "37201", timezone: "America/Chicago" },
  { city: "Phoenix", region: "AZ", postalCode: "85001", timezone: "America/Phoenix" },
  { city: "Atlanta", region: "GA", postalCode: "30301", timezone: "America/New_York" },
];

const STREET_NAMES = [
  "Maple", "Oak", "Pine", "Cedar", "Elm", "Birch", "Walnut", "Chestnut",
  "Willow", "Sunset", "Lakeview", "Highland", "Riverside", "Park",
] as const;

const VALID_CARDS = [
  { brand: "visa", last4: "4242" },
  { brand: "visa", last4: "4111" },
  { brand: "mastercard", last4: "5555" },
  { brand: "mastercard", last4: "5105" },
  { brand: "amex", last4: "3782" },
  { brand: "discover", last4: "6011" },
] as const;

const CARRIERS = ["ups", "fedex", "usps", "dhl"] as const;
const DELIVERY_DAYS = [
  "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday",
] as const;

// Refunds are only ever issued for spoiled / damaged ingredients (policy §4).
const REFUND_REASONS = [
  "rotten tomatoes", "moldy bread", "spoiled chicken", "bruised apples",
  "sour milk", "wilted lettuce",
] as const;
const FAILURE_REASONS = [
  "card declined", "insufficient funds", "processing error",
] as const;
const DELIVERY_NOTES = [
  "Ring doorbell twice", "Leave with front desk", "Gate code 4827",
  "No porch deliveries", null, null,
] as const;

// ---------------------------------------------------------------------------
// Catalog: plans + meals (shared, fixed across all customers).
// ---------------------------------------------------------------------------

// `plan_1` deliberately matches the eval task JSONs (4 meals/wk, 2 servings,
// USD, 999/serving) so hero cust_1's behavior aligns with what the repo
// benchmarks. Box price = price_per_serving × servings_per_meal × meals_per_week.
const PLANS: PlanRow[] = [
  plan("plan_1", "4 Meals Per Week (2 servings)", 4, 2, 999, true),
  plan("plan_2", "2 Meals Per Week (2 servings)", 2, 2, 1395, true),
  plan("plan_3", "6 Meals Per Week (4 servings)", 6, 4, 1295, true),
  plan("plan_4", "8 Meals Per Week (4 servings)", 8, 4, 1195, true),
  plan("plan_legacy", "Retired Sampler Plan", 4, 2, 1499, false),
];
const ACTIVE_PLANS = PLANS.filter((p) => p.active);

function plan(
  id: string,
  name: string,
  mealsPerWeek: number,
  servingsPerMeal: number,
  pricePerServing: number,
  active: boolean,
): PlanRow {
  return {
    id,
    name,
    meals_per_week: mealsPerWeek,
    servings_per_meal: servingsPerMeal,
    currency: "USD",
    country: "US",
    price_per_serving: pricePerServing,
    active,
    created_at: dayOffset(-365),
    updated_at: dayOffset(-365),
  };
}

/** The frozen box price for a plan (matches orders.price / payments.amount). */
function boxPrice(p: PlanRow): number {
  return p.price_per_serving * p.servings_per_meal * p.meals_per_week;
}

function meal(id: string, name: string, steps: string[], ingredients: string[], active = true): MealRow {
  return {
    id,
    name,
    steps,
    ingredients,
    is_active: active,
    created_at: dayOffset(-300),
    updated_at: dayOffset(-300),
  };
}

const MEALS: MealRow[] = [
  meal("meal_salmon", "Grilled Salmon with Asparagus",
    ["Preheat oven to 400F", "Season salmon with lemon and dill", "Roast 15 minutes", "Serve with asparagus"],
    ["salmon fillet", "asparagus", "lemon", "dill", "olive oil"]),
  meal("meal_chicken", "Herb-Crusted Chicken Breast",
    ["Pound chicken thin", "Coat with herbs", "Pan-sear 6 minutes per side"],
    ["chicken breast", "thyme", "rosemary", "garlic", "butter"]),
  meal("meal_pasta", "Creamy Mushroom Fettuccine",
    ["Cook pasta al dente", "Saute mushrooms", "Make cream sauce", "Toss together"],
    ["fettuccine", "mushrooms", "cream", "garlic", "parmesan"]),
  meal("meal_tacos", "Black Bean Tacos",
    ["Warm tortillas", "Season black beans", "Assemble with toppings"],
    ["corn tortillas", "black beans", "avocado", "cilantro", "lime"]),
  meal("meal_stirfry", "Beef and Broccoli Stir-Fry",
    ["Slice beef thin", "Stir-fry beef", "Add broccoli and sauce", "Serve over rice"],
    ["beef sirloin", "broccoli", "soy sauce", "ginger", "rice"]),
  meal("meal_curry", "Chickpea Coconut Curry",
    ["Saute onion and spices", "Add chickpeas and coconut milk", "Simmer 20 minutes"],
    ["chickpeas", "coconut milk", "curry powder", "onion", "spinach"]),
  meal("meal_burger", "Turkey Burger with Sweet Potato",
    ["Form turkey patties", "Grill 5 minutes per side", "Roast sweet potato wedges"],
    ["ground turkey", "sweet potato", "lettuce", "tomato", "brioche bun"]),
  meal("meal_shrimp", "Garlic Butter Shrimp",
    ["Melt butter with garlic", "Saute shrimp 3 minutes", "Finish with parsley"],
    ["shrimp", "garlic", "butter", "parsley", "linguine"]),
  meal("meal_risotto", "Lemon Pea Risotto",
    ["Toast arborio rice", "Add stock gradually", "Stir in peas and lemon"],
    ["arborio rice", "peas", "lemon", "parmesan", "vegetable stock"]),
  meal("meal_porkchop", "Maple Glazed Pork Chops",
    ["Sear pork chops", "Brush with maple glaze", "Finish in oven"],
    ["pork chops", "maple syrup", "dijon mustard", "green beans"]),
  meal("meal_quinoa", "Mediterranean Quinoa Bowl",
    ["Cook quinoa", "Chop vegetables", "Assemble bowl with feta"],
    ["quinoa", "cucumber", "cherry tomato", "feta", "olives"]),
  meal("meal_soup", "Roasted Tomato Basil Soup",
    ["Roast tomatoes", "Blend with basil", "Simmer with cream"],
    ["tomatoes", "basil", "cream", "onion", "garlic"]),
  // A retired meal: still referenced by historical orders, no longer offerable.
  meal("meal_retired", "Discontinued Holiday Roast",
    ["Brine roast overnight", "Roast low and slow"],
    ["beef roast", "rosemary", "garlic"], false),
];

// ---------------------------------------------------------------------------
// Hero customers — fixed memorable IDs you can chat as immediately.
// ---------------------------------------------------------------------------

function buildHeroes(): SeedData {
  const data = emptySeed();
  const planById = (id: string): PlanRow => PLANS.find((p) => p.id === id)!;

  // --- cust_1: Sam Rivera — the flagship, exercises every scenario ----------
  data.customers.push({
    id: "cust_1", email: "sam@example.com", email_verified: true,
    phone: null, phone_verified: false, first_name: "Sam", last_name: "Rivera",
    locale: "en-US", timezone: "America/Chicago", country: "US",
    subscription_id: "sub_1", default_address_id: "addr_home",
    default_payment_method_id: "pm_valid",
    created_at: dayOffset(-200), updated_at: dayOffset(-1),
  });
  data.addresses.push(
    address("addr_home", "cust_1", "100 Lakeshore Dr", null, "Chicago", "IL", "60601", "Ring doorbell twice", -200),
    address("addr_old", "cust_1", "1 Old St", null, "Boston", "MA", "02101", null, -400),
  );
  data.payment_methods.push(
    card("pm_valid", "cust_1", "mastercard", "5555", 11, 2028, -200),
    // Expired (3/2023) and NOT the default — the "delete my expired card" target.
    card("pm_expired", "cust_1", "visa", "4242", 3, 2023, -400),
  );
  data.subscriptions.push(
    subscription("sub_1", "cust_1", "active", "plan_1", "monday", "addr_home", "pm_valid", 7, -200),
  );
  pushOrderWithPayment(data, planById("plan_1"), {
    orderId: "ord_1", paymentId: "pay_1", subId: "sub_1", customerId: "cust_1",
    addressId: "addr_home", cardId: "pm_valid", status: "delivered",
    deliveryOffset: -21, carrier: "ups", payment: "succeeded",
    items: [{ mealId: "meal_salmon", quantity: 2 }, { mealId: "meal_chicken", quantity: 2 }],
  });
  pushOrderWithPayment(data, planById("plan_1"), {
    orderId: "ord_2", paymentId: "pay_2", subId: "sub_1", customerId: "cust_1",
    addressId: "addr_home", cardId: "pm_valid", status: "delivered",
    deliveryOffset: -14, carrier: "fedex", payment: "refunded", refundReason: "rotten tomatoes",
    items: [{ mealId: "meal_pasta", quantity: 2 }, { mealId: "meal_tacos", quantity: 2 }],
  });
  pushOrderWithPayment(data, planById("plan_1"), {
    orderId: "ord_3", paymentId: "pay_3", subId: "sub_1", customerId: "cust_1",
    addressId: "addr_home", cardId: "pm_valid", status: "shipped",
    deliveryOffset: 2, carrier: "usps", payment: "succeeded",
    items: [{ mealId: "meal_stirfry", quantity: 2 }, { mealId: "meal_curry", quantity: 2 }],
  });
  pushOrderWithPayment(data, planById("plan_1"), {
    orderId: "ord_4", paymentId: "pay_4", subId: "sub_1", customerId: "cust_1",
    addressId: "addr_home", cardId: "pm_valid", status: "pending",
    deliveryOffset: 9, carrier: null, payment: "pending",
    items: [{ mealId: "meal_burger", quantity: 2 }, { mealId: "meal_shrimp", quantity: 2 }],
  });
  pushOrderWithPayment(data, planById("plan_1"), {
    orderId: "ord_5", paymentId: "pay_5", subId: "sub_1", customerId: "cust_1",
    addressId: "addr_home", cardId: "pm_valid", status: "canceled",
    deliveryOffset: -7, carrier: null, payment: "failed", failureReason: "card declined",
    items: [{ mealId: "meal_risotto", quantity: 2 }, { mealId: "meal_soup", quantity: 2 }],
  });

  // --- cust_2: Alex Chen — clean, drama-free active account -----------------
  data.customers.push({
    id: "cust_2", email: "alex@example.com", email_verified: true,
    phone: "+1-555-0102", phone_verified: true, first_name: "Alex", last_name: "Chen",
    locale: "en-US", timezone: "America/Los_Angeles", country: "US",
    subscription_id: "sub_2", default_address_id: "addr_c2", default_payment_method_id: "pm_c2",
    created_at: dayOffset(-120), updated_at: dayOffset(-3),
  });
  data.addresses.push(address("addr_c2", "cust_2", "55 Pine St", "Apt 12", "Seattle", "WA", "98101", null, -120));
  data.payment_methods.push(card("pm_c2", "cust_2", "visa", "4111", 6, 2029, -120));
  data.subscriptions.push(subscription("sub_2", "cust_2", "active", "plan_3", "thursday", "addr_c2", "pm_c2", 4, -120));
  pushOrderWithPayment(data, planById("plan_3"), {
    orderId: "ord_c2_1", paymentId: "pay_c2_1", subId: "sub_2", customerId: "cust_2",
    addressId: "addr_c2", cardId: "pm_c2", status: "delivered", deliveryOffset: -10,
    carrier: "ups", payment: "succeeded",
    items: [{ mealId: "meal_salmon", quantity: 3 }, { mealId: "meal_quinoa", quantity: 3 }],
  });
  pushOrderWithPayment(data, planById("plan_3"), {
    orderId: "ord_c2_2", paymentId: "pay_c2_2", subId: "sub_2", customerId: "cust_2",
    addressId: "addr_c2", cardId: "pm_c2", status: "delivered", deliveryOffset: -3,
    carrier: "fedex", payment: "succeeded",
    items: [{ mealId: "meal_curry", quantity: 3 }, { mealId: "meal_porkchop", quantity: 3 }],
  });

  // --- cust_3: Jordan Lee — paused subscription + a past refund -------------
  data.customers.push({
    id: "cust_3", email: "jordan@example.com", email_verified: true,
    phone: "+1-555-0103", phone_verified: false, first_name: "Jordan", last_name: "Lee",
    locale: "en-US", timezone: "America/New_York", country: "US",
    subscription_id: "sub_3", default_address_id: "addr_c3", default_payment_method_id: "pm_c3",
    created_at: dayOffset(-150), updated_at: dayOffset(-20),
  });
  data.addresses.push(address("addr_c3", "cust_3", "808 Congress Ave", null, "Austin", "TX", "73301", "Gate code 4827", -150));
  data.payment_methods.push(card("pm_c3", "cust_3", "amex", "3782", 9, 2027, -150));
  data.subscriptions.push(subscription("sub_3", "cust_3", "paused", "plan_2", "tuesday", "addr_c3", "pm_c3", 30, -150));
  pushOrderWithPayment(data, planById("plan_2"), {
    orderId: "ord_c3_1", paymentId: "pay_c3_1", subId: "sub_3", customerId: "cust_3",
    addressId: "addr_c3", cardId: "pm_c3", status: "delivered", deliveryOffset: -40,
    carrier: "usps", payment: "refunded", refundReason: "moldy bread",
    items: [{ mealId: "meal_soup", quantity: 1 }, { mealId: "meal_pasta", quantity: 1 }],
  });
  pushOrderWithPayment(data, planById("plan_2"), {
    orderId: "ord_c3_2", paymentId: "pay_c3_2", subId: "sub_3", customerId: "cust_3",
    addressId: "addr_c3", cardId: "pm_c3", status: "delivered", deliveryOffset: -33,
    carrier: "ups", payment: "succeeded",
    items: [{ mealId: "meal_quinoa", quantity: 2 }],
  });

  // --- cust_4: Taylor Kim — canceled history + a current active sub ---------
  data.customers.push({
    id: "cust_4", email: "taylor@example.com", email_verified: true,
    phone: "+1-555-0104", phone_verified: true, first_name: "Taylor", last_name: "Kim",
    locale: "en-US", timezone: "America/Chicago", country: "US",
    subscription_id: "sub_4", default_address_id: "addr_c4", default_payment_method_id: "pm_c4",
    created_at: dayOffset(-220), updated_at: dayOffset(-5),
  });
  data.addresses.push(address("addr_c4", "cust_4", "240 Larimer St", null, "Denver", "CO", "80201", null, -220));
  data.payment_methods.push(card("pm_c4", "cust_4", "mastercard", "5105", 12, 2028, -220));
  // One canceled subscription in history + one current active one (the
  // at-most-one-non-canceled rule still holds).
  data.subscriptions.push(
    subscription("sub_4_old", "cust_4", "canceled", "plan_1", "friday", "addr_c4", "pm_c4", -30, -220),
    subscription("sub_4", "cust_4", "active", "plan_1", "wednesday", "addr_c4", "pm_c4", 5, -60),
  );
  pushOrderWithPayment(data, planById("plan_1"), {
    orderId: "ord_c4_old", paymentId: "pay_c4_old", subId: "sub_4_old", customerId: "cust_4",
    addressId: "addr_c4", cardId: "pm_c4", status: "canceled", deliveryOffset: -50,
    carrier: null, payment: "failed", failureReason: "insufficient funds",
    items: [{ mealId: "meal_chicken", quantity: 2 }, { mealId: "meal_tacos", quantity: 2 }],
  });
  pushOrderWithPayment(data, planById("plan_1"), {
    orderId: "ord_c4_1", paymentId: "pay_c4_1", subId: "sub_4", customerId: "cust_4",
    addressId: "addr_c4", cardId: "pm_c4", status: "delivered", deliveryOffset: -12,
    carrier: "dhl", payment: "succeeded",
    items: [{ mealId: "meal_burger", quantity: 2 }, { mealId: "meal_risotto", quantity: 2 }],
  });
  pushOrderWithPayment(data, planById("plan_1"), {
    orderId: "ord_c4_2", paymentId: "pay_c4_2", subId: "sub_4", customerId: "cust_4",
    addressId: "addr_c4", cardId: "pm_c4", status: "pending", deliveryOffset: 5,
    carrier: null, payment: "pending",
    items: [{ mealId: "meal_shrimp", quantity: 2 }, { mealId: "meal_quinoa", quantity: 2 }],
  });

  return data;
}

// ---------------------------------------------------------------------------
// Generated customers — the long tail of volume.
// ---------------------------------------------------------------------------

function buildGenerated(count: number, rng: Rng): SeedData {
  const data = emptySeed();

  for (let i = 1; i <= count; i++) {
    const tag = pad4(i);
    const first = rng.pick(FIRST_NAMES);
    const last = rng.pick(LAST_NAMES);
    const city = rng.pick(CITIES);
    const createdOffset = -rng.int(10, 300);

    // 1-2 addresses; the first is always the default.
    const addrCount = rng.int(1, 2);
    const addressIds: string[] = [];
    for (let a = 0; a < addrCount; a++) {
      const addrId = `addr_${tag}_${a + 1}`;
      const c = a === 0 ? city : rng.pick(CITIES);
      data.addresses.push(
        address(addrId, `cus_${tag}`, `${rng.int(1, 9999)} ${rng.pick(STREET_NAMES)} St`,
          rng.bool(0.25) ? `Unit ${rng.int(1, 40)}` : null,
          c.city, c.region, c.postalCode, rng.pick(DELIVERY_NOTES), createdOffset),
      );
      addressIds.push(addrId);
    }
    const defaultAddressId = addressIds[0]!;

    // 1 valid default card; every 3rd customer also has a (non-default) expired
    // card so the "remove my expired card" flow always has live targets.
    const validCard = rng.pick(VALID_CARDS);
    const defaultCardId = `pm_${tag}_1`;
    data.payment_methods.push(
      card(defaultCardId, `cus_${tag}`, validCard.brand, validCard.last4,
        rng.int(1, 12), rng.pick([2027, 2028, 2029]), createdOffset),
    );
    if (i % 3 === 0) {
      const expired = rng.pick(VALID_CARDS);
      data.payment_methods.push(
        card(`pm_${tag}_2`, `cus_${tag}`, expired.brand, expired.last4,
          rng.int(1, 12), rng.pick([2022, 2023, 2024]), createdOffset),
      );
    }

    // ~70% of customers have exactly one subscription (active or paused).
    const hasSub = rng.bool(0.7);
    const subId = hasSub ? `sub_${tag}` : null;
    if (hasSub) {
      const p = rng.pick(ACTIVE_PLANS);
      const status = rng.bool(0.8) ? "active" : "paused";
      data.subscriptions.push(
        subscription(subId!, `cus_${tag}`, status, p.id, rng.pick(DELIVERY_DAYS),
          defaultAddressId, defaultCardId, rng.int(2, 14), createdOffset),
      );

      // 1-3 historical/upcoming orders, each with a matching payment. At most
      // one refund per customer keeps every customer well under the 3-refund cap.
      const orderCount = rng.int(1, 3);
      let refundUsed = false;
      for (let o = 0; o < orderCount; o++) {
        const status2 = rng.pick(["delivered", "delivered", "shipped", "pending", "canceled"] as const);
        const shipped = status2 === "delivered" || status2 === "shipped";
        const deliveryOffset =
          status2 === "delivered" ? -rng.int(3, 90)
          : status2 === "shipped" ? rng.int(1, 3)
          : status2 === "pending" ? rng.int(4, 14)
          : -rng.int(3, 30);

        let payment: "succeeded" | "pending" | "failed" | "refunded";
        let refundReason: string | undefined;
        let failureReason: string | undefined;
        if (status2 === "pending") {
          payment = "pending";
        } else if (status2 === "canceled") {
          payment = "failed";
          failureReason = rng.pick(FAILURE_REASONS);
        } else if (status2 === "delivered" && !refundUsed && rng.bool(0.15)) {
          payment = "refunded";
          refundReason = rng.pick(REFUND_REASONS);
          refundUsed = true;
        } else {
          payment = "succeeded";
        }

        pushOrderWithPayment(data, p, {
          orderId: `ord_${tag}_${o + 1}`, paymentId: `pay_${tag}_${o + 1}`,
          subId: subId!, customerId: `cus_${tag}`, addressId: defaultAddressId,
          cardId: defaultCardId, status: status2, deliveryOffset,
          carrier: shipped ? rng.pick(CARRIERS) : null,
          payment, refundReason, failureReason,
          items: splitMeals(p.meals_per_week, rng),
        });
      }
    }

    data.customers.push({
      id: `cus_${tag}`,
      email: `${first.toLowerCase()}.${last.toLowerCase()}.${i}@example.com`,
      email_verified: rng.bool(0.85),
      phone: rng.bool(0.6) ? `+1-555-${pad4(1000 + i)}` : null,
      phone_verified: rng.bool(0.4),
      first_name: first, last_name: last,
      locale: "en-US", timezone: city.timezone, country: "US",
      subscription_id: subId, default_address_id: defaultAddressId,
      default_payment_method_id: defaultCardId,
      created_at: dayOffset(createdOffset), updated_at: dayOffset(createdOffset),
    });
  }

  return data;
}

/** Split `total` meals across 1-3 distinct meals so the quantities sum to it. */
function splitMeals(total: number, rng: Rng): OrderLine[] {
  const k = Math.min(rng.int(1, 3), total, MEALS.length);
  const chosen = rng.pickDistinct(MEALS.filter((m) => m.is_active), k);
  const lines: OrderLine[] = [];
  let remaining = total;
  for (let idx = 0; idx < chosen.length; idx++) {
    const slotsLeft = chosen.length - idx;
    const quantity = idx === chosen.length - 1 ? remaining : rng.int(1, remaining - (slotsLeft - 1));
    lines.push({ mealId: chosen[idx]!.id, quantity });
    remaining -= quantity;
  }
  return lines;
}

// ---------------------------------------------------------------------------
// Small row builders shared by heroes + generated customers.
// ---------------------------------------------------------------------------

function address(
  id: string, customerId: string, line1: string, line2: string | null,
  city: string, region: string, postalCode: string, deliveryNotes: string | null,
  createdOffset: number,
): AddressRow {
  return {
    id, customer_id: customerId, line1, line2, city, region,
    postal_code: postalCode, country: "US", delivery_notes: deliveryNotes,
    created_at: dayOffset(createdOffset), updated_at: dayOffset(createdOffset),
  };
}

function card(
  id: string, customerId: string, brand: string, last4: string,
  expiryMonth: number, expiryYear: number, createdOffset: number,
): PaymentMethodRow {
  return {
    id, customer_id: customerId, brand, last4,
    expiry_month: expiryMonth, expiry_year: expiryYear,
    created_at: dayOffset(createdOffset),
  };
}

function subscription(
  id: string, customerId: string, status: string, planId: string,
  deliveryDay: string, addressId: string, cardId: string,
  nextDeliveryOffset: number, createdOffset: number,
): SubscriptionRow {
  return {
    id, customer_id: customerId, status, plan_id: planId,
    delivery_day: deliveryDay, delivery_address_id: addressId,
    payment_method_id: cardId, next_delivery_date: dayOffset(nextDeliveryOffset),
    created_at: dayOffset(createdOffset), updated_at: dayOffset(createdOffset),
  };
}

interface OrderSpec {
  orderId: string;
  paymentId: string;
  subId: string;
  customerId: string;
  addressId: string;
  cardId: string;
  status: string;
  deliveryOffset: number;
  carrier: string | null;
  payment: "succeeded" | "pending" | "failed" | "refunded";
  refundReason?: string;
  failureReason?: string;
  items: OrderLine[];
}

/** Append an order and its single matching payment, with consistent prices. */
function pushOrderWithPayment(data: SeedData, p: PlanRow, spec: OrderSpec): void {
  const price = boxPrice(p);
  const shipped = spec.status === "delivered" || spec.status === "shipped";
  // created_at trails the delivery date so the orders list (DESC) reads sanely.
  const createdOffset = spec.deliveryOffset - 5;
  data.orders.push({
    id: spec.orderId, subscription_id: spec.subId, customer_id: spec.customerId,
    status: spec.status, address_id: spec.addressId, payment_method_id: spec.cardId,
    delivery_date: dayOffset(spec.deliveryOffset), price, currency: p.currency,
    items: spec.items,
    carrier: shipped ? spec.carrier : null,
    tracking_number: shipped && spec.carrier ? trackingNumber(spec.orderId) : null,
    created_at: dayOffset(createdOffset), updated_at: dayOffset(createdOffset),
  });

  const processed =
    spec.payment === "succeeded" || spec.payment === "refunded"
      ? dayOffset(createdOffset + 1)
      : null;
  data.payments.push({
    id: spec.paymentId, customer_id: spec.customerId, order_id: spec.orderId,
    subscription_id: spec.subId, payment_method_id: spec.cardId, status: spec.payment,
    amount: price, currency: p.currency,
    processor_ref: spec.payment === "pending" ? null : `ch_${spec.paymentId}`,
    failure_reason: spec.payment === "failed" ? (spec.failureReason ?? "card declined") : null,
    refund_reason: spec.payment === "refunded" ? (spec.refundReason ?? "spoiled ingredients") : null,
    processed_at: processed,
    refunded_at: spec.payment === "refunded" ? dayOffset(createdOffset + 3) : null,
    created_at: dayOffset(createdOffset), updated_at: dayOffset(createdOffset),
  });
}

/** Deterministic, plausible-looking tracking number derived from the order id. */
function trackingNumber(orderId: string): string {
  let h = 0;
  for (const ch of orderId) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return `1Z999AA1${String(h).padStart(10, "0").slice(0, 10)}`;
}

function emptySeed(): SeedData {
  return {
    customers: [], addresses: [], payment_methods: [], plans: [],
    subscriptions: [], meals: [], orders: [], payments: [],
  };
}

// ---------------------------------------------------------------------------
// Assembly + assertions.
// ---------------------------------------------------------------------------

/** Build the full deterministic dataset. `SEED_CUSTOMERS` overrides the count. */
export function buildSeed(): SeedData {
  const count = Number(process.env.SEED_CUSTOMERS) || 50;
  return assemble(count);
}

function assemble(count: number): SeedData {
  const rng = new Rng(0xaceb0a5); // fixed seed → byte-identical data every run
  const heroes = buildHeroes();
  const generated = buildGenerated(count, rng);

  const data: SeedData = {
    customers: [...heroes.customers, ...generated.customers],
    addresses: [...heroes.addresses, ...generated.addresses],
    payment_methods: [...heroes.payment_methods, ...generated.payment_methods],
    plans: PLANS,
    subscriptions: [...heroes.subscriptions, ...generated.subscriptions],
    meals: MEALS,
    orders: [...heroes.orders, ...generated.orders],
    payments: [...heroes.payments, ...generated.payments],
  };

  assertValid(data);
  return data;
}

/** Cheap insurance that the business invariants hold before we touch the DB. */
function assertValid(data: SeedData): void {
  const planById = new Map(data.plans.map((p) => [p.id, p]));
  const orderById = new Map(data.orders.map((o) => [o.id, o]));
  const subById = new Map(data.subscriptions.map((s) => [s.id, s]));

  for (const o of data.orders) {
    const sub = subById.get(o.subscription_id);
    if (!sub) throw new Error(`order ${o.id} references missing subscription ${o.subscription_id}`);
    const p = planById.get(sub.plan_id)!;
    const qty = o.items.reduce((sum, it) => sum + it.quantity, 0);
    if (qty !== p.meals_per_week) {
      throw new Error(`order ${o.id} items sum ${qty} != plan ${p.id} meals_per_week ${p.meals_per_week}`);
    }
    const expected = p.price_per_serving * p.servings_per_meal * p.meals_per_week;
    if (o.price !== expected) {
      throw new Error(`order ${o.id} price ${o.price} != expected ${expected}`);
    }
  }

  for (const pay of data.payments) {
    const o = orderById.get(pay.order_id);
    if (!o) throw new Error(`payment ${pay.id} references missing order ${pay.order_id}`);
    if (pay.amount !== o.price) {
      throw new Error(`payment ${pay.id} amount ${pay.amount} != order price ${o.price}`);
    }
  }

  const refundsByCustomer = new Map<string, number>();
  for (const pay of data.payments) {
    if (pay.status === "refunded") {
      refundsByCustomer.set(pay.customer_id, (refundsByCustomer.get(pay.customer_id) ?? 0) + 1);
    }
  }
  for (const [customerId, n] of refundsByCustomer) {
    if (n > 3) throw new Error(`customer ${customerId} has ${n} refunds (max 3)`);
  }

  for (const c of data.customers) {
    if (!c.default_address_id) throw new Error(`customer ${c.id} has no default address`);
    if (!c.default_payment_method_id) throw new Error(`customer ${c.id} has no default payment method`);
  }
}
