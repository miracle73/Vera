import dotenv from "dotenv";
dotenv.config();

export type PaymentProvider = "stripe" | "paystack";

export const config = {
  port: parseInt(process.env.PORT || "3000", 10),
  nodeEnv: process.env.NODE_ENV || "development",
  logLevel: process.env.LOG_LEVEL || "info",
  publicUrl: process.env.PUBLIC_URL || "http://localhost:3000",

  vapi: {
    apiKey: process.env.VAPI_API_KEY || "",
    assistantId: process.env.VAPI_ASSISTANT_ID || "",
  },

  admin: {
    apiKey: process.env.ADMIN_API_KEY || "",
  },

  paymentProvider: (process.env.PAYMENT_PROVIDER || "stripe") as PaymentProvider,

  stripe: {
    secretKey: process.env.STRIPE_SECRET_KEY || "",
    webhookSecret: process.env.STRIPE_WEBHOOK_SECRET || "",
  },

  paystack: {
    secretKey: process.env.PAYSTACK_SECRET_KEY || "",
    webhookSecret: process.env.PAYSTACK_WEBHOOK_SECRET || "",
  },

  database: {
    url:
      process.env.DATABASE_URL ||
      "postgresql://vera:vera_secret@localhost:5432/vera",
  },

  humanHandoff: {
    phone: process.env.HUMAN_AGENT_PHONE || "",
    sip: process.env.HUMAN_AGENT_SIP || "",
  },

  escalationOrderThreshold: parseFloat(
    process.env.ESCALATION_ORDER_THRESHOLD || "500"
  ),
} as const;
