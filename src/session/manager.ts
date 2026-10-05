import { CallSession, OrderFlowStep, OrderItem, ShippingAddress, ShippingMethod } from "../types";
import { queryWithRetry, query, getClient } from "../db";
import { logger } from "../middleware/requestLogger";

const VALID_TRANSITIONS: Record<OrderFlowStep, OrderFlowStep[]> = {
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

export class SessionManager {
  private sessions = new Map<string, CallSession>();

  getOrCreate(callId: string): CallSession {
    let session = this.sessions.get(callId);
    if (!session) {
      session = {
        callId,
        currentStep: "greeting",
        items: [],
        shippingAddress: null,
        shippingMethod: null,
        customerName: null,
        customerPhone: null,
        discountCode: null,
        discountAmount: 0,
        subtotal: 0,
        total: 0,
        dbOrderId: null,
        paymentRef: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      this.sessions.set(callId, session);
      logger.info("Created new call session", { callId });
    }
    return session;
  }

  /** Load the latest session state from the database into memory. */
  async load(callId: string): Promise<void> {
    const { rows } = await queryWithRetry<{ data: CallSession }>(
      "SELECT data FROM call_sessions WHERE call_id = $1",
      [callId]
    );
    if (rows.length === 0) return;
    const data = rows[0].data;
    this.sessions.set(callId, {
      ...data,
      createdAt: new Date(data.createdAt),
      updatedAt: new Date(data.updatedAt),
    });
  }

  /** Write the in-memory session state to the database. */
  async save(callId: string): Promise<void> {
    const session = this.sessions.get(callId);
    if (!session) return;
    await queryWithRetry(
      `INSERT INTO call_sessions (call_id, data, updated_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (call_id) DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()`,
      [callId, JSON.stringify(session)]
    );
  }

  get(callId: string): CallSession | undefined {
    return this.sessions.get(callId);
  }

  canTransition(callId: string, nextStep: OrderFlowStep): boolean {
    const session = this.get(callId);
    if (!session) return false;
    const allowed = VALID_TRANSITIONS[session.currentStep];
    return allowed.includes(nextStep);
  }

  transition(callId: string, nextStep: OrderFlowStep): CallSession {
    const session = this.getOrCreate(callId);
    if (!this.canTransition(callId, nextStep)) {
      logger.warn("Invalid state transition attempted", {
        callId,
        from: session.currentStep,
        to: nextStep,
      });
    }
    session.currentStep = nextStep;
    session.updatedAt = new Date();
    return session;
  }

  addItem(callId: string, item: OrderItem): void {
    const session = this.getOrCreate(callId);
    const existing = session.items.find((i) => i.productId === item.productId);
    if (existing) {
      existing.quantity += item.quantity;
      existing.price = item.price;
    } else {
      session.items.push(item);
    }
    this.recalculateTotal(session);
    session.updatedAt = new Date();
  }

  updateItemQuantity(callId: string, productId: string, quantity: number): void {
    const session = this.getOrCreate(callId);
    if (quantity <= 0) {
      session.items = session.items.filter((i) => i.productId !== productId);
    } else {
      const item = session.items.find((i) => i.productId === productId);
      if (item) item.quantity = quantity;
    }
    this.recalculateTotal(session);
    session.updatedAt = new Date();
  }

  setShippingAddress(callId: string, address: ShippingAddress): void {
    const session = this.getOrCreate(callId);
    session.shippingAddress = address;
    session.updatedAt = new Date();
  }

  setShippingMethod(callId: string, method: ShippingMethod): void {
    const session = this.getOrCreate(callId);
    session.shippingMethod = method;
    this.recalculateTotal(session);
    session.updatedAt = new Date();
  }

  applyDiscount(callId: string, code: string, amount: number): void {
    const session = this.getOrCreate(callId);
    session.discountCode = code;
    session.discountAmount = amount;
    this.recalculateTotal(session);
    session.updatedAt = new Date();
  }

  private recalculateTotal(session: CallSession): void {
    const shippingCost = session.shippingMethod?.price || 0;
    session.subtotal = session.items.reduce(
      (sum, i) => sum + i.price * i.quantity,
      0
    );
    session.total = Math.max(
      0,
      session.subtotal + shippingCost - session.discountAmount
    );
  }

  async persistCallRecord(
    callId: string,
    phoneNumber?: string,
    customerName?: string
  ): Promise<string> {
    const { rows } = await queryWithRetry<{ id: string }>(
      `INSERT INTO calls (vapi_call_id, phone_number, customer_name, status)
       VALUES ($1, $2, $3, 'active')
       RETURNING id`,
      [callId, phoneNumber || null, customerName || null]
    );
    return rows[0].id;
  }

  async persistOrder(callId: string, clientFactory = getClient): Promise<string> {
    const session = this.get(callId);
    if (!session) throw new Error("No session found for callId");

    const client = await clientFactory();
    try {
      await client.query("BEGIN");
      const call = (await client.query("INSERT INTO calls (vapi_call_id, status) VALUES ($1, 'active') ON CONFLICT (vapi_call_id) DO UPDATE SET vapi_call_id = EXCLUDED.vapi_call_id RETURNING id", [callId])).rows[0];
      await client.query("SELECT id FROM calls WHERE id = $1 FOR UPDATE", [call.id]);
      const existing = (await client.query("SELECT * FROM orders WHERE call_id = $1", [call.id])).rows[0];
      if (existing) {
        const lines = await client.query("SELECT i.product_id AS \"productId\", p.name AS title, i.quantity, i.price::float AS price FROM order_items i JOIN products p ON p.id = i.product_id WHERE i.order_id = $1", [existing.id]);
        await client.query("COMMIT");
        session.dbOrderId = existing.id;
        session.items = lines.rows;
        session.total = Number(existing.total);
        session.customerName = existing.customer_name;
        session.customerPhone = existing.phone;
        session.shippingAddress = existing.shipping_address;
        return existing.id;
      }
      let subtotal = 0;
      for (const item of [...session.items].sort((a,b) => a.productId.localeCompare(b.productId))) {
        const result = await client.query("UPDATE products SET stock = stock - $1, updated_at = NOW() WHERE id = $2 AND active = TRUE AND stock >= $1 RETURNING price", [item.quantity, item.productId]);
        if (!result.rows[0]) throw new Error("Insufficient stock for " + item.title);
        item.price = Number(result.rows[0].price);
        subtotal += item.price * item.quantity;
      }
      let discount = 0;
      if (session.discountCode) {
        const d = (await client.query("SELECT * FROM discounts WHERE code = $1 AND active = TRUE AND (expires_at IS NULL OR expires_at > NOW())", [session.discountCode.toUpperCase()])).rows[0];
        if (d) discount = d.type === 'percentage' ? subtotal * Number(d.value) / 100 : Number(d.value);
      }
      session.subtotal = subtotal;
      session.total = Math.round(Math.max(0, subtotal + (session.shippingMethod?.price || 0) - discount) * 100) / 100;
      const order = (await client.query("INSERT INTO orders (call_id, customer_name, phone, email, shipping_address, total, payment_provider) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id", [call.id, session.customerName, session.customerPhone, session.shippingAddress?.email, JSON.stringify(session.shippingAddress), session.total, config.paymentProvider])).rows[0];
      for (const item of session.items) await client.query("INSERT INTO order_items (order_id, product_id, quantity, price) VALUES ($1,$2,$3,$4)", [order.id,item.productId,item.quantity,item.price]);
      await client.query("COMMIT");
      session.dbOrderId = order.id;
      return order.id;
    } catch (err) { await client.query("ROLLBACK"); throw err; } finally { client.release(); }
  }

  async updateOrderPayment(
    orderId: string,
    paymentRef: string,
    paymentProvider: string
  ): Promise<void> {
    await queryWithRetry(
      `UPDATE orders SET payment_ref = $1, payment_provider = $2, updated_at = NOW()
       WHERE id = $3`,
      [paymentRef, paymentProvider, orderId]
    );
  }

  async persistTransfer(
    callId: string,
    reason: string,
    target: string,
    contextSummary?: string
  ): Promise<void> {
    const { rows } = await queryWithRetry<{ id: string }>(
      "SELECT id FROM calls WHERE vapi_call_id = $1",
      [callId]
    );
    if (rows.length === 0) return;

    await queryWithRetry(
      `INSERT INTO transfers (call_id, reason, target, context_summary)
       VALUES ($1, $2, $3, $4)`,
      [rows[0].id, reason, target, contextSummary || null]
    );
  }

  async finalizeCall(callId: string, outcome: string): Promise<void> {
    await queryWithRetry(
      `UPDATE calls SET status = 'completed', outcome = $1, ended_at = NOW()
       WHERE vapi_call_id = $2`,
      [outcome, callId]
    );
  }

  async remove(callId: string): Promise<void> {
    this.sessions.delete(callId);
    await queryWithRetry("DELETE FROM call_sessions WHERE call_id = $1", [callId]);
  }

  buildContextSummary(callId: string): string {
    const session = this.get(callId);
    if (!session) return "No session context available.";

    const parts: string[] = [];
    parts.push(`Customer call: ${callId}`);

    if (session.customerName) {
      parts.push(`Customer: ${session.customerName}`);
    }

    if (session.items.length > 0) {
      const itemList = session.items
        .map((i) => `${i.quantity}x ${i.title}`)
        .join(", ");
      parts.push(`Items in cart: ${itemList}`);
      parts.push(`Subtotal: $${session.subtotal.toFixed(2)}`);
    }

    if (session.shippingAddress) {
      const addr = session.shippingAddress;
      parts.push(
        `Shipping to: ${addr.firstName} ${addr.lastName}, ${addr.address1}, ${addr.city}, ${addr.province} ${addr.zip}`
      );
    }

    if (session.shippingMethod) {
      parts.push(`Shipping method: ${session.shippingMethod.title}`);
    }

    if (session.discountCode) {
      parts.push(`Discount applied: ${session.discountCode} (-$${session.discountAmount.toFixed(2)})`);
    }

    parts.push(`Total: $${session.total.toFixed(2)}`);
    parts.push(`Current step: ${session.currentStep}`);

    return parts.join("; ");
  }
}

import { config } from "../config";
export const sessionManager = new SessionManager();
