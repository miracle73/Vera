import { Router, Request, Response } from "express";
import { verifyPaymentWebhook } from "../payments";
import { query } from "../db";
import { logger } from "../middleware/requestLogger";
import { asyncHandler } from "../middleware/errorHandler";
import { createRateLimiter } from "../middleware/rateLimiter";

const router = Router();

const webhookLimiter = createRateLimiter({
  windowMs: 60_000,
  max: 60,
  message: "Too many webhook requests.",
});

// ── Stripe Webhook ──
router.post(
  "/webhooks/stripe",
  webhookLimiter,
  asyncHandler(async (req: Request, res: Response) => {
    const signature = req.headers["stripe-signature"] as string;
    if (!signature) {
      return res.status(400).json({ error: "Missing stripe-signature header" });
    }

    const rawBody = (req as any).rawBody;
    if (!rawBody) {
      return res.status(400).json({ error: "Missing raw body for signature verification" });
    }

    const result = await verifyPaymentWebhook(rawBody, signature, "stripe");

    if (result.status === "paid" && result.reference) {
      await markOrderPaid(result.reference, "stripe");
    } else if (result.status === "failed" && result.reference) {
      await markOrderFailed(result.reference, "stripe");
    }

    res.json({ received: true });
  })
);

// ── Paystack Webhook ──
router.post(
  "/webhooks/paystack",
  webhookLimiter,
  asyncHandler(async (req: Request, res: Response) => {
    const signature = req.headers["x-paystack-signature"] as string;
    if (!signature) {
      return res.status(400).json({ error: "Missing x-paystack-signature header" });
    }

    const rawBody = (req as any).rawBody;
    if (!rawBody) {
      return res.status(400).json({ error: "Missing raw body for signature verification" });
    }

    const result = await verifyPaymentWebhook(rawBody, signature, "paystack");

    if (result.status === "paid" && result.reference) {
      await markOrderPaid(result.reference, "paystack");
    } else if (result.status === "failed" && result.reference) {
      await markOrderFailed(result.reference, "paystack");
    }

    res.json({ received: true });
  })
);

// ── Payment Cancel Redirect (Paystack) ──
router.get("/payment/cancelled", (_req: Request, res: Response) => {
  res.status(200).send(`
    <!DOCTYPE html>
    <html><head><title>Payment Cancelled</title></head>
    <body style="font-family:sans-serif;text-align:center;padding:60px 20px">
      <h1>Payment Cancelled</h1>
      <p>Your payment was not completed. You can try again by calling us back.</p>
      <p>If you need assistance, please contact our support team.</p>
    </body></html>
  `);
});

// ── Payment Success Redirect (Paystack) ──
router.get("/payment/success", (_req: Request, res: Response) => {
  res.status(200).send(`
    <!DOCTYPE html>
    <html><head><title>Payment Successful</title></head>
    <body style="font-family:sans-serif;text-align:center;padding:60px 20px">
      <h1>Payment Successful</h1>
      <p>Your payment has been confirmed. Thank you for your order!</p>
      <p>You will receive a confirmation shortly.</p>
    </body></html>
  `);
});

async function markOrderPaid(
  paymentRef: string,
  provider: string
): Promise<void> {
  const { rowCount } = await query(
    `UPDATE orders SET status = 'paid', updated_at = NOW()
     WHERE payment_ref = $1 AND payment_provider = $2 AND status = 'pending'`,
    [paymentRef, provider]
  );

  if (rowCount && rowCount > 0) {
    logger.info("Order marked as paid", { paymentRef, provider });
  } else {
    logger.warn("No pending order found for payment", { paymentRef, provider });
  }
}

async function markOrderFailed(
  paymentRef: string,
  provider: string
): Promise<void> {
  const { rowCount } = await query(
    `UPDATE orders SET status = 'failed', updated_at = NOW()
     WHERE payment_ref = $1 AND payment_provider = $2 AND status = 'pending'`,
    [paymentRef, provider]
  );

  if (rowCount && rowCount > 0) {
    logger.info("Order marked as failed", { paymentRef, provider });
  }
}

export default router;
