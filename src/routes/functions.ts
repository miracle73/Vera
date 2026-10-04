import { Router, Request, Response } from "express";
import { products } from "../services/products";
import { createPayment } from "../payments";
import { sessionManager } from "../session/manager";
import { query } from "../db";
import { config } from "../config";
import { logger } from "../middleware/requestLogger";
import { asyncHandler } from "../middleware/errorHandler";
import { createRateLimiter } from "../middleware/rateLimiter";
import {
  LookupProductArgs,
  CheckInventoryArgs,
  CreateOrderArgs,
  ApplyDiscountArgs,
  ConfirmOrderArgs,
  TransferCallArgs,
} from "../types";

// Spoken amounts in the store currency, e.g. "17,000 naira"
function formatMoney(amount: number): string {
  const n = Number(amount).toLocaleString("en-US", { maximumFractionDigits: 2 });
  return config.store.currency === "NGN" ? `${n} naira` : `${n} ${config.store.currency}`;
}

const router = Router();

const vapiLimiter = createRateLimiter({
  windowMs: 60_000,
  max: 120,
  message: "Too many Vapi requests. Please wait.",
});

// ── Vapi Webhook Entry Point ──
router.post(
  "/webhook/vapi",
  vapiLimiter,
  asyncHandler(async (req: Request, res: Response) => {
    const body = req.body;
    const message = body.message;

    if (!message) {
      return res.status(200).json({ ok: true });
    }

    const callId = message.call?.id || "unknown";
    const messageType = message.type;

    logger.info("Vapi webhook received", {
      callId,
      functionName: message.functionCall?.name,
      type: messageType,
    });

    // Handle end-of-call-report separately
    if (messageType === "end-of-call-report") {
      await handleEndOfCall(callId, message);
      return res.status(200).json({ ok: true });
    }

    // Current Vapi format: "tool-calls" with a toolCallList
    if (messageType === "tool-calls" && Array.isArray(message.toolCallList)) {
      const results = [];
      for (const tc of message.toolCallList) {
        let args = tc.function?.arguments ?? {};
        if (typeof args === "string") {
          try { args = JSON.parse(args); } catch { args = {}; }
        }
        const result = await dispatchFunction(callId, tc.function?.name, args);
        results.push({ toolCallId: tc.id, result });
      }
      return res.status(200).json({ results });
    }

    // Legacy "function-call" format
    if (message.functionCall?.name) {
      const result = await dispatchFunction(
        callId,
        message.functionCall.name,
        message.functionCall.arguments || {}
      );
      return res.status(200).json({ results: [{ result }], result });
    }

    return res.status(200).json({ ok: true });
  })
);

// Session state lives in the DB so each webhook can land on any instance
async function dispatchFunction(
  callId: string,
  functionName: string,
  args: any
): Promise<string> {
  await sessionManager.load(callId);
  sessionManager.getOrCreate(callId);
  try {
    return await runFunction(callId, functionName, args);
  } finally {
    await sessionManager.save(callId).catch((err) =>
      logger.error("Failed to save call session", { callId, error: (err as Error).message })
    );
  }
}

async function runFunction(
  callId: string,
  functionName: string,
  args: any
): Promise<string> {
  try {
    switch (functionName) {
      case "lookup-product":
        return await handleLookupProduct(callId, args);
      case "check-inventory":
        return await handleCheckInventory(callId, args);
      case "create-order":
        return await handleCreateOrder(callId, args);
      case "apply-discount":
        return await handleApplyDiscount(callId, args);
      case "confirm-order":
        return await handleConfirmOrder(callId, args);
      case "transfer-call":
        return await handleTransferCall(callId, args);
      default:
        return JSON.stringify({
          success: false,
          error: `Unknown function: ${functionName}`,
        });
    }
  } catch (err) {
    logger.error("Function handler error", {
      callId,
      functionName,
      error: (err as Error).message,
    });
    return JSON.stringify({
      success: false,
      error: "An error occurred processing your request. Please try again.",
    });
  }
}

// ── End-of-Call Report ──
async function handleEndOfCall(
  callId: string,
  message: Record<string, unknown>
): Promise<void> {
  const transcript = (message.transcript as string) || null;
  const duration = (message.duration as number) || null;

  await query(
    `UPDATE calls SET
       transcript = COALESCE($1, transcript),
       duration_seconds = COALESCE($2, duration_seconds),
       ended_at = NOW()
     WHERE vapi_call_id = $3`,
    [transcript, duration, callId]
  );

  await sessionManager.remove(callId);

  logger.info("End-of-call report processed", { callId, duration });
}

// ── lookup-product ──
async function handleLookupProduct(
  callId: string,
  args: Record<string, unknown>
): Promise<string> {
  const { query: q } = args as unknown as LookupProductArgs;
  if (!q) {
    return JSON.stringify({
      success: false,
      error: "Please provide a product name or SKU to search.",
    });
  }

  sessionManager.transition(callId, "product_selection");

  let items = await products.search(q);

  if (items.length === 0) {
    const bySku = await products.getBySku(q);
    if (bySku) items = [bySku];
  }

  if (items.length === 0) {
    return JSON.stringify({
      success: false,
      message: `I couldn't find any products matching "${q}". Could you try a different search term?`,
    });
  }

  const results = items.slice(0, 5).map((p) => ({
    id: p.id,
    name: p.name,
    description: (p.description || "").substring(0, 200),
    price: Number(p.price).toFixed(2),
    stock: p.stock,
    available: p.stock > 0,
    sku: p.sku,
  }));

  return JSON.stringify({
    success: true,
    products: results,
    message: `I found ${results.length} product${results.length !== 1 ? "s" : ""} matching "${q}".`,
  });
}

// ── check-inventory ──
async function handleCheckInventory(
  callId: string,
  args: Record<string, unknown>
): Promise<string> {
  const { product_id, quantity } = args as unknown as CheckInventoryArgs;
  if (!product_id) {
    return JSON.stringify({
      success: false,
      error: "Please provide a product ID to check inventory.",
    });
  }

  const product = await products.getById(product_id);
  if (!product) {
    return JSON.stringify({
      success: true,
      available: false,
      current_stock: 0,
      message: "Sorry, that product was not found in our catalog.",
    });
  }

  const requestedQty = quantity || 1;
  const stock = product.stock;

  if (stock === 0) {
    return JSON.stringify({
      success: true,
      available: false,
      current_stock: 0,
      requested_quantity: requestedQty,
      message: `Sorry, ${product.name} is currently out of stock.`,
    });
  }

  if (stock < requestedQty) {
    return JSON.stringify({
      success: true,
      available: false,
      current_stock: stock,
      requested_quantity: requestedQty,
      message: `We only have ${stock} unit${stock !== 1 ? "s" : ""} of ${product.name} left in stock. Would you like to order ${stock} instead?`,
    });
  }

  return JSON.stringify({
    success: true,
    available: true,
    current_stock: stock,
    requested_quantity: requestedQty,
    message: `${product.name} is in stock with ${stock} units available.`,
  });
}

// ── create-order ──
async function handleCreateOrder(
  callId: string,
  args: Record<string, unknown>
): Promise<string> {
  const { items, shipping_address, customer_name, customer_phone } =
    args as unknown as CreateOrderArgs;

  if (!items?.length || !shipping_address) {
    return JSON.stringify({
      success: false,
      error: "Items and shipping address are required to create an order.",
    });
  }

  let total = 0;
  const resolvedItems: Array<{
    productId: string;
    title: string;
    quantity: number;
    price: number;
  }> = [];

  for (const item of items) {
    const product = await products.getById(item.product_id);
    if (!product) {
      return JSON.stringify({
        success: false,
        error: `Product ${item.product_id} not found.`,
      });
    }
    if (product.stock < item.quantity) {
      return JSON.stringify({
        success: false,
        error: `Insufficient stock for ${product.name}. Available: ${product.stock}, requested: ${item.quantity}.`,
      });
    }
    const lineTotal = Number(product.price) * item.quantity;
    total += lineTotal;
    resolvedItems.push({
      productId: product.id,
      title: product.name,
      quantity: item.quantity,
      price: Number(product.price),
    });
  }

  for (const item of resolvedItems) {
    sessionManager.addItem(callId, item);
  }

  if (customer_name) {
    sessionManager.getOrCreate(callId).customerName = customer_name;
  }
  if (customer_phone) {
    sessionManager.getOrCreate(callId).customerPhone = customer_phone;
  }

  sessionManager.setShippingAddress(callId, shipping_address);
  sessionManager.transition(callId, "shipping_address");

  return JSON.stringify({
    success: true,
    items: resolvedItems.map((i) => ({
      name: i.title,
      quantity: i.quantity,
      unit_price: i.price.toFixed(2),
      line_total: (i.price * i.quantity).toFixed(2),
    })),
    subtotal: total.toFixed(2),
    message: `I've added ${resolvedItems.length} item${resolvedItems.length !== 1 ? "s" : ""} to your order with a subtotal of ${formatMoney(total)}. Would you like to apply a discount code, or shall we proceed?`,
  });
}

// ── apply-discount ──
async function handleApplyDiscount(
  callId: string,
  args: Record<string, unknown>
): Promise<string> {
  const { code, order_total } = args as unknown as ApplyDiscountArgs;
  if (!code) {
    return JSON.stringify({
      success: false,
      error: "Please provide a discount code.",
    });
  }

  const session = sessionManager.get(callId);
  const total = order_total || session?.subtotal || 0;

  const discount = await products.validateDiscountCode(code, total);

  if (!discount.valid) {
    return JSON.stringify({
      success: true,
      valid: false,
      message: `Sorry, the discount code "${code}" is not valid or has expired. Would you like to try another code?`,
    });
  }

  sessionManager.applyDiscount(callId, code, discount.value);

  return JSON.stringify({
    success: true,
    valid: true,
    discount_type: discount.type,
    discount_value: discount.value.toFixed(2),
    code: discount.title,
    message: `Great! I've applied the discount "${code}" for ${formatMoney(discount.value)} off your order.`,
  });
}

// ── confirm-order ──
async function handleConfirmOrder(
  callId: string,
  args: Record<string, unknown>
): Promise<string> {
  const session = sessionManager.get(callId);
  if (!session) {
    return JSON.stringify({
      success: false,
      error: "No active order found for this call.",
    });
  }

  if (session.items.length === 0) {
    return JSON.stringify({
      success: false,
      error: "No items in the order. Please add items before confirming.",
    });
  }

  if (session.total >= config.escalationOrderThreshold) {
    sessionManager.transition(callId, "summary");
    const contextSummary = sessionManager.buildContextSummary(callId);
    await sessionManager.persistTransfer(
      callId,
      "Order value exceeds threshold",
      config.humanHandoff.sip || config.humanHandoff.phone,
      contextSummary
    );
    return JSON.stringify({
      success: true,
      escalated: true,
      message: `Your order total is ${formatMoney(session.total)}, which requires manual verification. Let me transfer you to a specialist who can complete this order.`,
    });
  }

  try {
    const dbOrderId = await sessionManager.persistOrder(callId);
    session.dbOrderId = dbOrderId;

    const paymentResult = await createPayment(session.total, {
      orderId: dbOrderId,
      callId,
      customerName: session.customerName || "",
      email: session.shippingAddress?.email || "",
    });

    if (paymentResult.success) {
      await sessionManager.updateOrderPayment(
        dbOrderId,
        paymentResult.reference,
        paymentResult.provider
      );

      session.paymentRef = paymentResult.reference;
      sessionManager.transition(callId, "summary");

      let paymentMsg = "";
      if (paymentResult.checkoutUrl) {
        paymentMsg = `You can complete payment at: ${paymentResult.checkoutUrl}`;
      } else if (paymentResult.clientSecret) {
        paymentMsg = `Payment has been initialized. The payment reference is ${paymentResult.reference}.`;
      } else {
        paymentMsg = `Payment reference: ${paymentResult.reference}.`;
      }

      return JSON.stringify({
        success: true,
        order_id: dbOrderId,
        total: session.total.toFixed(2),
        payment_provider: paymentResult.provider,
        payment_reference: paymentResult.reference,
        checkout_url: paymentResult.checkoutUrl,
        message: `Your order has been created with a total of ${formatMoney(session.total)}. ${paymentMsg} Is there anything else I can help you with?`,
      });
    }

    return JSON.stringify({
      success: false,
      error: "Payment initialization failed. Would you like to try again or transfer to a specialist?",
    });
  } catch (err) {
    logger.error("Order confirmation failed", {
      callId,
      error: (err as Error).message,
    });
    return JSON.stringify({
      success: false,
      error: "There was an issue confirming your order. Let me transfer you to a specialist.",
    });
  }
}

// ── transfer-call ──
async function handleTransferCall(
  callId: string,
  args: Record<string, unknown>
): Promise<string> {
  const { reason, phone_number, sip_endpoint } =
    args as unknown as TransferCallArgs;
  const target =
    sip_endpoint || config.humanHandoff.sip || config.humanHandoff.phone;
  const contextSummary = sessionManager.buildContextSummary(callId);

  await sessionManager.persistTransfer(
    callId,
    reason || "Customer requested human agent",
    target,
    contextSummary
  );

  await sessionManager.finalizeCall(callId, `transferred: ${reason}`);

  sessionManager.transition(callId, "completed");

  return JSON.stringify({
    success: true,
    transfer_to: target,
    context: contextSummary,
    message: `I'm transferring you to a specialist now. Here's a summary of your call for them: ${contextSummary}`,
  });
}

// ── Health Check ──
router.get("/health", (_req: Request, res: Response) => {
  res.json({
    status: "ok",
    service: "vera",
    paymentProvider: config.paymentProvider,
    timestamp: new Date().toISOString(),
  });
});

export default router;
