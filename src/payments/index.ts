import { config } from "../config";
import * as stripe from "./stripe";
import * as paystack from "./paystack";
import { PaymentInitResult, PaymentVerificationResult } from "../types";
import { logger } from "../middleware/requestLogger";

export type { PaymentInitResult, PaymentVerificationResult };

export async function createPayment(
  amountInDollars: number,
  metadata: Record<string, string>
): Promise<PaymentInitResult> {
  const provider = config.paymentProvider;
  logger.info("Creating payment", { provider, amount: amountInDollars });

  if (provider === "paystack") {
    return paystack.initializeTransaction(amountInDollars, metadata);
  }

  return stripe.createPaymentIntent(amountInDollars, metadata);
}

export async function verifyPaymentWebhook(
  payload: string | Buffer,
  signature: string,
  providerHint?: string
): Promise<PaymentVerificationResult & { event?: any }> {
  const provider = providerHint || config.paymentProvider;

  if (provider === "paystack") {
    return paystack.verifyWebhook(payload, signature);
  }

  return stripe.verifyWebhook(payload, signature);
}
