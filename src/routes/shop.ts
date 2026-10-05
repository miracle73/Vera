import { Router, Request, Response } from "express";
import { query, getClient } from "../db";
import { config } from "../config";
import { paymentForOrder } from "../services/checkout";
import { verifyTransaction } from "../payments/paystack";
import { verifyTransaction as verifyStripeTransaction } from "../payments/stripe";
import { asyncHandler } from "../middleware/errorHandler";
import { createRateLimiter } from "../middleware/rateLimiter";
import { logger } from "../middleware/requestLogger";

// Public storefront API — no admin auth
const router = Router();

const PRODUCT_COLUMNS =
  "id, name, sku, price::float AS price, description, stock, category, image_url, tagline, color";

router.get("/api/shop/config", (_req: Request, res: Response) => {
  res.json({
    currency: config.store.currency,
    vapiPublicKey: config.vapi.publicKey,
    vapiAssistantId: config.vapi.assistantId,
  });
});

router.get(
  "/api/shop/products",
  asyncHandler(async (req: Request, res: Response) => {
    const params: unknown[] = [];
    const where = ["active = TRUE"];

    const category = (req.query.category as string) || "";
    if (category) {
      params.push(category);
      where.push(`category = $${params.length}`);
    }
    const q = ((req.query.q as string) || "").trim();
    if (q) {
      params.push(`%${q}%`);
      where.push(`(name ILIKE $${params.length} OR description ILIKE $${params.length})`);
    }

    const { rows } = await query(
      `SELECT ${PRODUCT_COLUMNS} FROM products WHERE ${where.join(" AND ")} ORDER BY category, name`,
      params
    );
    const { rows: cats } = await query(
      "SELECT DISTINCT category FROM products WHERE active = TRUE AND category IS NOT NULL ORDER BY category"
    );
    res.json({ products: rows, categories: cats.map((c) => c.category) });
  })
);

router.get(
  "/api/shop/products/:id",
  asyncHandler(async (req: Request, res: Response) => {
    if (!/^[0-9a-f-]{36}$/i.test(req.params.id)) {
      return res.status(404).json({ error: "Product not found" });
    }
    const { rows } = await query(
      `SELECT ${PRODUCT_COLUMNS} FROM products WHERE id = $1 AND active = TRUE`,
      [req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: "Product not found" });
    res.json({ product: rows[0] });
  })
);

const checkoutLimiter = createRateLimiter({ windowMs: 60_000, max: 10 });

router.post(
  "/api/shop/checkout",
  checkoutLimiter,
  asyncHandler(async (req: Request, res: Response) => {
    if (config.paymentProvider === "paystack" && !config.paystack.secretKey) {
      return res.status(503).json({ error: "Payments are not configured yet. Please try again later." });
    }

    const { items, email, name, phone, address } = req.body || {};

    if (!Array.isArray(items) || items.length === 0 || items.length > 50) {
      return res.status(400).json({ error: "Your bag is empty" });
    }
    if (typeof email !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: "A valid email is required" });
    }
    if (typeof name !== "string" || !name.trim()) {
      return res.status(400).json({ error: "Name is required" });
    }

    const checkoutKey = req.get("x-checkout-key");
    if (!checkoutKey || !/^[a-f0-9-]{36}$/.test(checkoutKey)) return res.status(400).json({ error: "Checkout key required" });
    const client = await getClient();
    let orderId: string;
    let total = 0;
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 1))", [checkoutKey]);
      const previous = (await client.query("SELECT id FROM orders WHERE checkout_key = $1", [checkoutKey])).rows[0];
      if (previous) {
        await client.query("COMMIT");
        const payment = await paymentForOrder(previous.id);
        return res.json({ orderId: previous.id, checkoutUrl: payment.checkoutUrl, reference: payment.reference });
      }

      const merged = new Map<string, number>();
      for (const item of items) {
        const quantity = Number(item?.quantity);
        if (!Number.isInteger(quantity) || quantity < 1 || quantity > 99) throw Object.assign(new Error("Invalid quantity"), { status: 400 });
        const id = String(item?.productId);
        merged.set(id, (merged.get(id) || 0) + quantity);
      }
      const lines: { productId: string; quantity: number; price: number }[] = [];
      for (const [productId, quantity] of [...merged].sort(([a],[b]) => a.localeCompare(b))) {
        if (quantity > 99) {
          throw Object.assign(new Error("Invalid quantity"), { status: 400 });
        }
        const { rows } = await client.query(
          "SELECT id, name, price::float AS price, stock FROM products WHERE id = $1 AND active = TRUE FOR UPDATE",
          [productId]
        );
        const product = rows[0];
        if (!product) throw Object.assign(new Error("A product in your bag is unavailable"), { status: 400 });
        if (product.stock < quantity) {
          throw Object.assign(new Error(`Only ${product.stock} of ${product.name} left`), { status: 400 });
        }
        await client.query("UPDATE products SET stock = stock - $1, updated_at = NOW() WHERE id = $2", [quantity, product.id]);
        lines.push({ productId: product.id, quantity, price: product.price });
        total += product.price * quantity;
      }
      total = Math.round(total * 100) / 100;

      const { rows: orderRows } = await client.query(
        `INSERT INTO orders (call_id, customer_name, phone, email, shipping_address,
           status, total, payment_provider, source)
         VALUES (NULL, $1, $2, $3, $4, 'pending', $5, $6, 'web')
         RETURNING id`,
        [
          name.trim(),
          typeof phone === "string" ? phone.trim() : null,
          email.trim(),
          address ? JSON.stringify(address) : null,
          total,
          config.paymentProvider,
        ]
      );
      orderId = orderRows[0].id;
      const guestToken = req.headers.cookie?.split(';').map(s=>s.trim()).find(s=>s.startsWith('vera_guest='))?.slice(11);
      if (guestToken && /^[a-f0-9]{64}$/.test(guestToken)) await client.query("INSERT INTO guest_orders (guest_token, order_id) SELECT token,$1 FROM guest_sessions WHERE token = $2 ON CONFLICT DO NOTHING", [orderId,guestToken]);
      await client.query("UPDATE orders SET checkout_key = $1 WHERE id = $2", [checkoutKey, orderId]);

      for (const line of lines) {
        await client.query(
          "INSERT INTO order_items (order_id, product_id, quantity, price) VALUES ($1, $2, $3, $4)",
          [orderId, line.productId, line.quantity, line.price]
        );
      }
      await client.query("COMMIT");
    } catch (err: any) {
      await client.query("ROLLBACK");
      if (err.status === 400) return res.status(400).json({ error: err.message });
      throw err;
    } finally {
      client.release();
    }

    const payment = await paymentForOrder(orderId);

    logger.info("Web order created", { orderId, total });
    res.json({ orderId, checkoutUrl: payment.checkoutUrl, reference: payment.reference });
  })
);

// Called by the order page after Paystack redirects back
router.get(
  "/api/shop/orders/verify",
  asyncHandler(async (req: Request, res: Response) => {
    const reference = String(req.query.reference || "");
    if (!reference) return res.status(400).json({ error: "reference is required" });

    const { rows } = await query(
      "SELECT id, status, total::float AS total, customer_name, payment_provider FROM orders WHERE payment_ref = $1",
      [reference]
    );
    const order = rows[0];
    if (!order) return res.status(404).json({ error: "Order not found" });

    if (order.status === "pending") {
      const result = await (order.payment_provider === "stripe" ? verifyStripeTransaction(reference) : verifyTransaction(reference));
      if (result.success) {
        await query(
          "UPDATE orders SET status = 'paid', updated_at = NOW() WHERE id = $1 AND status = 'pending'",
          [order.id]
        );
        order.status = "paid";
      }
    }

    res.json({ order });
  })
);

export default router;
