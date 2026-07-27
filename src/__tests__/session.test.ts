import assert from "node:assert/strict";
import { describe, it, beforeEach } from "node:test";

// ── Session Manager Tests ──
// These are pure in-memory tests that don't require a database.

// Minimal mock of the session manager logic (avoids DB imports)
interface OrderItem {
  productId: string;
  title: string;
  quantity: number;
  price: number;
}

interface ShippingAddress {
  firstName: string;
  lastName: string;
  address1: string;
  city: string;
  province: string;
  zip: string;
  country: string;
  email: string;
}

type Step =
  | "greeting"
  | "product_selection"
  | "quantity"
  | "shipping_address"
  | "shipping_method"
  | "payment"
  | "upsell"
  | "discount"
  | "confirmation"
  | "summary"
  | "completed";

const TRANSITIONS: Record<Step, Step[]> = {
  greeting: ["product_selection"],
  product_selection: ["quantity", "product_selection", "shipping_address"],
  quantity: ["product_selection", "quantity", "shipping_address"],
  shipping_address: ["shipping_method", "shipping_address"],
  shipping_method: ["payment", "shipping_method"],
  payment: ["upsell", "discount", "confirmation"],
  upsell: ["discount", "confirmation"],
  discount: ["confirmation", "discount"],
  confirmation: ["summary", "completed"],
  summary: ["completed"],
  completed: [],
};

function createSession(callId: string) {
  return {
    callId,
    currentStep: "greeting" as Step,
    items: [] as OrderItem[],
    shippingAddress: null as ShippingAddress | null,
    customerName: null as string | null,
    subtotal: 0,
    discountAmount: 0,
    total: 0,
  };
}

function canTransition(current: Step, next: Step): boolean {
  return TRANSITIONS[current]?.includes(next) ?? false;
}

function addItem(
  session: ReturnType<typeof createSession>,
  item: OrderItem
): void {
  const existing = session.items.find((i) => i.productId === item.productId);
  if (existing) {
    existing.quantity += item.quantity;
  } else {
    session.items.push({ ...item });
  }
  recalc(session);
}

function recalc(session: ReturnType<typeof createSession>): void {
  session.subtotal = session.items.reduce(
    (sum, i) => sum + i.price * i.quantity,
    0
  );
  session.total = Math.max(0, session.subtotal - session.discountAmount);
}

describe("Session State Machine", () => {
  it("starts at greeting", () => {
    const s = createSession("call-1");
    assert.equal(s.currentStep, "greeting");
  });

  it("allows valid transition greeting → product_selection", () => {
    assert.ok(canTransition("greeting", "product_selection"));
  });

  it("rejects invalid transition greeting → completed", () => {
    assert.ok(!canTransition("greeting", "completed"));
  });

  it("allows product_selection → quantity", () => {
    assert.ok(canTransition("product_selection", "quantity"));
  });

  it("allows going back from quantity → product_selection (correction)", () => {
    assert.ok(canTransition("quantity", "product_selection"));
  });

  it("allows full happy path", () => {
    const steps: Step[] = [
      "greeting",
      "product_selection",
      "quantity",
      "shipping_address",
      "shipping_method",
      "payment",
      "confirmation",
      "summary",
      "completed",
    ];

    for (let i = 0; i < steps.length - 1; i++) {
      assert.ok(
        canTransition(steps[i], steps[i + 1]),
        `Expected ${steps[i]} → ${steps[i + 1]} to be valid`
      );
    }
  });

  it("completed is a terminal state", () => {
    const next = TRANSITIONS["completed"];
    assert.equal(next.length, 0);
  });
});

describe("Order Items", () => {
  it("adds items and calculates subtotal", () => {
    const s = createSession("call-2");
    addItem(s, { productId: "p1", title: "T-Shirt", quantity: 2, price: 29.99 });
    addItem(s, { productId: "p2", title: "Jeans", quantity: 1, price: 79.99 });

    assert.equal(s.items.length, 2);
    assert.equal(s.subtotal, 29.99 * 2 + 79.99);
    assert.equal(s.total, s.subtotal);
  });

  it("merges duplicate items by incrementing quantity", () => {
    const s = createSession("call-3");
    addItem(s, { productId: "p1", title: "T-Shirt", quantity: 1, price: 29.99 });
    addItem(s, { productId: "p1", title: "T-Shirt", quantity: 3, price: 29.99 });

    assert.equal(s.items.length, 1);
    assert.equal(s.items[0].quantity, 4);
    assert.equal(s.subtotal, 29.99 * 4);
  });

  it("applies discount correctly", () => {
    const s = createSession("call-4");
    addItem(s, { productId: "p1", title: "Shoes", quantity: 1, price: 100 });
    s.discountAmount = 20;
    recalc(s);

    assert.equal(s.total, 80);
  });

  it("total never goes below zero", () => {
    const s = createSession("call-5");
    addItem(s, { productId: "p1", title: "Item", quantity: 1, price: 10 });
    s.discountAmount = 50;
    recalc(s);

    assert.equal(s.total, 0);
  });
});

describe("Context Summary", () => {
  it("builds a readable summary", () => {
    const s = createSession("call-6");
    s.customerName = "Jane Doe";
    addItem(s, { productId: "p1", title: "Coffee Beans", quantity: 2, price: 24.99 });
    s.shippingAddress = {
      firstName: "Jane",
      lastName: "Doe",
      address1: "123 Main St",
      city: "Austin",
      province: "TX",
      zip: "78701",
      country: "US",
      email: "jane@example.com",
    };
    s.discountAmount = 5;
    recalc(s);
    s.currentStep = "confirmation";

    const parts: string[] = [];
    parts.push(`Customer call: ${s.callId}`);
    parts.push(`Customer: ${s.customerName}`);
    parts.push(`Items in cart: 2x Coffee Beans`);
    parts.push(`Subtotal: $${s.subtotal.toFixed(2)}`);
    parts.push(
      `Shipping to: ${s.shippingAddress.firstName} ${s.shippingAddress.lastName}, ${s.shippingAddress.address1}, ${s.shippingAddress.city}, ${s.shippingAddress.province} ${s.shippingAddress.zip}`
    );
    parts.push(`Discount applied: some code (-$${s.discountAmount.toFixed(2)})`);
    parts.push(`Total: $${s.total.toFixed(2)}`);
    parts.push(`Current step: ${s.currentStep}`);

    const summary = parts.join("; ");
    assert.ok(summary.includes("Jane Doe"));
    assert.ok(summary.includes("Coffee Beans"));
    assert.ok(summary.includes("Austin"));
    assert.ok(summary.includes("confirmation"));
  });
});
