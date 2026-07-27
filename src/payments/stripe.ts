import Stripe from "stripe";
import { config } from "../config";
import { logger } from "../middleware/requestLogger";
import { PaymentInitResult, PaymentVerificationResult } from "../types";

let stripeInstance: Stripe | null = null;

function getStripe(): Stripe {
  if (!stripeInstance) {
    stripeInstance = new Stripe(config.stripe.secretKey, {
      apiVersion: "2024-04-10" as any,
    });
  }
  return stripeInstance;
}

export async function createPaymentIntent(
  amountInDollars: number,
  metadata: Record<string, string>
): Promise<PaymentInitResult> {
  const stripe = getStripe();

  const paymentIntent = await stripe.paymentIntents.create({
    amount: Math.round(amountInDollars * 100),
    currency: "usd",
    metadata,
    automatic_payment_methods: { enabled: true },
  });

  logger.info("Stripe payment intent created", {
    id: paymentIntent.id,
    amount: amountInDollars,
  });

  return {
    success: true,
    provider: "stripe",
    reference: paymentIntent.id,
    clientSecret: paymentIntent.client_secret || undefined,
    message: `Payment of $${amountInDollars.toFixed(2)} initiated. Confirm to complete.`,
  };
}

export async function verifyWebhook(
  payload: string | Buffer,
  signature: string
): Promise<PaymentVerificationResult> {
  const stripe = getStripe();
  const event = stripe.webhooks.constructEvent(
    payload,
    signature,
    config.stripe.webhookSecret
  );

  if (event.type === "payment_intent.succeeded") {
    const pi = event.data.object as Stripe.PaymentIntent;
    return {
      success: true,
      status: "paid",
      reference: pi.id,
    };
  }

  if (event.type === "payment_intent.payment_failed") {
    const pi = event.data.object as Stripe.PaymentIntent;
    return {
      success: false,
      status: "failed",
      reference: pi.id,
    };
  }

  return {
    success: false,
    status: "pending",
    reference: "",
  };
}
