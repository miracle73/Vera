// ── Vapi Function Call Types ──

export interface VapiFunctionCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface VapiWebhookPayload {
  message: {
    type: "function-call" | "function-call-result" | "end-of-call-report";
    call?: {
      id: string;
      [key: string]: unknown;
    };
    functionCall?: VapiFunctionCall;
    functionCallResult?: {
      result: string;
    };
    transcript?: string;
  };
}

export interface VapiFunctionResult {
  results: Array<{
    result: string;
  }>;
}

// ── Session / Order State Machine ──

export type OrderFlowStep =
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

export interface OrderItem {
  productId: string;
  title: string;
  quantity: number;
  price: number;
}

export interface ShippingAddress {
  firstName: string;
  lastName: string;
  address1: string;
  address2?: string;
  city: string;
  province: string;
  zip: string;
  country: string;
  phone?: string;
  email: string;
}

export interface ShippingMethod {
  id: string;
  title: string;
  price: number;
  estimatedDelivery: string;
}

export interface CallSession {
  callId: string;
  currentStep: OrderFlowStep;
  items: OrderItem[];
  shippingAddress: ShippingAddress | null;
  shippingMethod: ShippingMethod | null;
  customerName: string | null;
  customerPhone: string | null;
  discountCode: string | null;
  discountAmount: number;
  subtotal: number;
  total: number;
  dbOrderId: string | null;
  paymentRef: string | null;
  createdAt: Date;
  updatedAt: Date;
}

// ── Database Record Types ──

export interface ProductRecord {
  id: string;
  name: string;
  sku: string | null;
  price: number;
  description: string | null;
  stock: number;
  active: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface DiscountRecord {
  id: string;
  code: string;
  type: "percentage" | "fixed";
  value: number;
  active: boolean;
  expires_at: Date | null;
  created_at: Date;
}

export interface OrderRecord {
  id: string;
  call_id: string;
  customer_name: string | null;
  phone: string | null;
  shipping_address: ShippingAddress | null;
  status: "pending" | "paid" | "failed" | "cancelled" | "refunded";
  total: number;
  payment_provider: "stripe" | "paystack" | null;
  payment_ref: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface OrderItemRecord {
  id: string;
  order_id: string;
  product_id: string;
  quantity: number;
  price: number;
}

export interface CallRecord {
  id: string;
  vapi_call_id: string;
  phone_number: string | null;
  customer_name: string | null;
  status: "active" | "completed" | "transferred" | "failed";
  outcome: string | null;
  transcript: string | null;
  duration_seconds: number | null;
  created_at: Date;
  ended_at: Date | null;
}

export interface TransferRecord {
  id: string;
  call_id: string;
  reason: string;
  target: string;
  context_summary: string | null;
  created_at: Date;
}

// ── Function Argument Types ──

export interface LookupProductArgs {
  query: string;
}

export interface CheckInventoryArgs {
  product_id: string;
  quantity?: number;
}

export interface CreateOrderArgs {
  items: Array<{
    product_id: string;
    quantity: number;
  }>;
  shipping_address: ShippingAddress;
  customer_name?: string;
  customer_phone?: string;
}

export interface ApplyDiscountArgs {
  code: string;
  order_total?: number;
}

export interface ConfirmOrderArgs {
  call_id: string;
}

export interface TransferCallArgs {
  reason: string;
  phone_number?: string;
  sip_endpoint?: string;
}

// ── Payment Provider Types ──

export interface PaymentInitResult {
  success: boolean;
  provider: "stripe" | "paystack";
  reference: string;
  checkoutUrl?: string;
  clientSecret?: string;
  message: string;
}

export interface PaymentVerificationResult {
  success: boolean;
  status: "paid" | "failed" | "pending";
  reference: string;
}
