import crypto from "crypto";
import axios from "axios";
import { config } from "../config";
import { logger } from "../middleware/requestLogger";
import { PaymentInitResult, PaymentVerificationResult } from "../types";

const PAYSTACK_BASE = "https://api.paystack.co";

function getHeaders() {
  return {
    Authorization: `Bearer ${config.paystack.secretKey}`,
    "Content-Type": "application/json",
  };
}

export async function initializeTransaction(
  amountInDollars: number,
  metadata: Record<string, string>
): Promise<PaymentInitResult> {
  const amountInKobo = Math.round(amountInDollars * 100);
  const email = metadata.email || config.store.fallbackEmail;

  const { data } = await axios.post(
    `${PAYSTACK_BASE}/transaction/initialize`,
    {
      amount: amountInKobo,
      reference: "vera-" + metadata.orderId,
      email,
      currency: config.store.currency,
      callback_url: metadata.callbackUrl || `${config.publicUrl}/payment/success`,
      metadata: {
        ...metadata,
        cancel_action: `${config.publicUrl}/payment/cancelled`,
        success_action: `${config.publicUrl}/payment/success`,
      },
    },
    { headers: getHeaders() }
  );

  logger.info("Paystack transaction initialized", {
    reference: data.data.reference,
    amount: amountInDollars,
  });

  return {
    success: true,
    provider: "paystack",
    reference: data.data.reference,
    checkoutUrl: data.data.authorization_url,
    message: `Payment of ${config.store.currency} ${amountInDollars.toFixed(2)} initialized. Visit the payment link to complete.`,
  };
}

export async function verifyWebhook(
  payload: string | Buffer,
  signature: string
): Promise<PaymentVerificationResult> {
  const secret = config.paystack.webhookSecret || config.paystack.secretKey;
  if (!secret) throw new Error("Paystack webhook verification is not configured");
  const hash = crypto
    .createHmac("sha512", secret)
    .update(payload)
    .digest("hex");

  if (hash !== signature) {
    logger.warn("Paystack webhook signature mismatch");
    return { success: false, status: "failed", reference: "" };
  }

  const event = JSON.parse(payload.toString());

  if (event.event === "charge.success") {
    return {
      success: true,
      status: "paid",
      reference: event.data.reference,
    };
  }

  if (event.event === "charge.failed") {
    return {
      success: false,
      status: "failed",
      reference: event.data.reference,
    };
  }

  return {
    success: false,
    status: "pending",
    reference: event.data?.reference || "",
  };
}

export async function verifyTransaction(
  reference: string
): Promise<PaymentVerificationResult> {
  const { data } = await axios.get(
    `${PAYSTACK_BASE}/transaction/verify/${encodeURIComponent(reference)}`,
    { headers: getHeaders() }
  );

  return {
    success: data.data.status === "success",
    status: data.data.status === "success" ? "paid" : "failed",
    reference: data.data.reference,
  };
}
