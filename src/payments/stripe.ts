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

  const checkout = await stripe.checkout.sessions.create({
    mode: "payment", client_reference_id: metadata.orderId, metadata,
    line_items: [{ price_data: { currency: config.store.currency.toLowerCase(), product_data: { name: "Vera order" }, unit_amount: Math.round(amountInDollars * 100) }, quantity: 1 }],
    success_url: config.frontendUrl + "/order.html?reference={CHECKOUT_SESSION_ID}",
    cancel_url: config.frontendUrl + "/cart.html",
    customer_email: metadata.email || undefined,
  }, { idempotencyKey: "order-" + metadata.orderId });
  return { success: true, provider: "stripe", reference: checkout.id, checkoutUrl: checkout.url || undefined, message: "Complete payment on the secure checkout page." };

}

export async function verifyTransaction(reference: string): Promise<PaymentVerificationResult> {
  const checkout = await getStripe().checkout.sessions.retrieve(reference);
  return { success: checkout.payment_status === "paid", status: checkout.payment_status === "paid" ? "paid" : "pending", reference: checkout.id };
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

  if (event.type === "checkout.session.completed" || event.type === "checkout.session.async_payment_succeeded") {
    const checkout = event.data.object as Stripe.Checkout.Session;
    return { success: checkout.payment_status === "paid", status: checkout.payment_status === "paid" ? "paid" : "pending", reference: checkout.id };
  }
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
