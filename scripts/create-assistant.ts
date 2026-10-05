/**
 * Script to create or update the Vapi assistant via API.
 *
 * Usage:
 *   1. Set VAPI_API_KEY and PUBLIC_URL in .env
 *   2. Run: npm run create-assistant
 */

import * as dotenv from "dotenv";
dotenv.config();

import axios from "axios";

const VAPI_BASE = "https://api.vapi.ai";
const apiKey = process.env.VAPI_API_KEY;
const publicUrl = process.env.PUBLIC_URL || "http://localhost:3000";

if (!apiKey) {
  console.error("VAPI_API_KEY is required in .env");
  process.exit(1);
}

const SYSTEM_PROMPT = `You are Vera, an AI order processing specialist for [BRAND NAME].
Guide customers through the ordering process with clear instructions.
Collect accurate order details (products, quantities, shipping, payment).
Confirm order details before finalizing to prevent errors.
Suggest relevant add-ons and apply available discounts when appropriate.
Clearly explain shipping options and return policies.
Handle special requests efficiently.
Provide complete order confirmations while maintaining a friendly, professional demeanor.
If the customer requests a human, or the situation requires it, transfer the call immediately.

ORDER FLOW:
1. Greet the customer warmly.
2. Ask what they'd like to order, then use lookup-product to search the catalog.
3. Confirm the product and quantity. If they want multiple items, collect each one.
4. Collect delivery details ONE AT A TIME, in this order: full name, phone number, email, street address, city, state. Do not ask for ZIP/postal code or country (default country is Nigeria).
   Read the email back by spelling it out and ask the customer to confirm it.
5. Ask if they have a discount code. If yes, use apply-discount to validate it.
6. Suggest relevant add-ons or upgrades if appropriate (upsell step).
7. Summarize the full order: items, quantities, discount (if any), and total.
8. Ask for confirmation. If confirmed, use confirm-order to finalize.
9. Provide the order number, payment reference, and confirmation details.

IMPORTANT RULES:
- Always confirm details before finalizing an order.
- If a product is out of stock, suggest alternatives.
- If the customer wants to change an item or quantity mid-flow, accommodate gracefully.
- If you cannot understand the customer after 2-3 attempts, or if they explicitly ask, use transfer-call to connect them with a human.
- Prices are in Nigerian naira. Say amounts like "17,000 naira", never dollars.
- Customers may have Nigerian accents. If a product name sounds close to a catalog item, search for the closest match and confirm it rather than asking them to repeat.
- Existing browser bag (JSON): {{initialCart}}. Include these items unless the customer asks to change or remove them.
- create-order replaces the whole cart: always pass all desired items. Collect name, phone, email and delivery address before calling it. Ask for explicit confirmation before confirm-order.
- After confirm-order succeeds, tell the customer a payment button has appeared on their screen (or that a payment link is ready). Never read a URL aloud.
- Only use transfer-call if the customer explicitly asks for a human, or confirm-order returns escalated: true.
- Be conversational, friendly, and efficient. Keep responses concise for voice.`;

const FUNCTIONS = [
  {
    name: "lookup-product",
    description:
      "Search the product catalog by name or SKU. Returns matching products with prices and availability.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "The product name, keyword, or SKU to search for",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "check-inventory",
    description: "Check the current stock level for a specific product.",
    parameters: {
      type: "object",
      properties: {
        product_id: {
          type: "string",
          description: "The product ID to check inventory for",
        },
        quantity: {
          type: "number",
          description: "The quantity the customer wants (defaults to 1)",
        },
      },
      required: ["product_id"],
    },
  },
  {
    name: "create-order",
    description:
      "Create an order with the specified items and shipping address. Validates stock before adding.",
    parameters: {
      type: "object",
      properties: {
        items: {
          type: "array",
          items: {
            type: "object",
            properties: {
              product_id: {
                type: "string",
                description: "Product ID from lookup-product",
              },
              quantity: {
                type: "number",
                description: "Number of units to order",
              },
            },
            required: ["product_id", "quantity"],
          },
          description: "List of items to order",
        },
        shipping_address: {
          type: "object",
          properties: {
            firstName: { type: "string" },
            lastName: { type: "string" },
            address1: { type: "string" },
            address2: { type: "string" },
            city: { type: "string" },
            province: { type: "string" },
            zip: { type: "string" },
            country: { type: "string" },
            phone: { type: "string" },
            email: { type: "string" },
          },
          required: [
            "firstName",
            "lastName",
            "address1",
            "city",
            "email",
          ],
          description: "Delivery address. province = Nigerian state. country defaults to Nigeria; zip is optional.",
        },
        customer_name: {
          type: "string",
          description: "Customer's full name",
        },
        customer_phone: {
          type: "string",
          description: "Customer's phone number",
        },
      },
      required: ["items", "shipping_address"],
    },
  },
  {
    name: "apply-discount",
    description: "Validate and apply a discount code to the current order.",
    parameters: {
      type: "object",
      properties: {
        code: {
          type: "string",
          description: "The discount/promo code to apply",
        },
        order_total: {
          type: "number",
          description: "Current order total before discount",
        },
      },
      required: ["code"],
    },
  },
  {
    name: "confirm-order",
    description:
      "Finalize the order, persist it to the database, and initiate payment.",
    parameters: {
      type: "object",
      properties: {
        call_id: {
          type: "string",
          description: "The current call ID for session tracking",
        },
      },
      required: ["call_id"],
    },
  },
  {
    name: "transfer-call",
    description:
      "Transfer the call to a human agent. Use when the customer requests it, when you cannot understand them, or when the situation requires human intervention.",
    parameters: {
      type: "object",
      properties: {
        reason: {
          type: "string",
          description: "Reason for the transfer",
        },
        phone_number: {
          type: "string",
          description: "Target phone number (optional, uses default if not provided)",
        },
        sip_endpoint: {
          type: "string",
          description: "SIP endpoint URI (optional)",
        },
      },
      required: ["reason"],
    },
  },
];

// Product names boost speech recognition of catalog items
const PRODUCT_NAMES = [
  "Hair, Skin & Nails Gummies",
  "Thickening Hair Serum",
  "Brightening Vitamin C Serum",
  "Daily Mineral Sunscreen",
  "Hydrating Barrier Cream",
  "Daily Glow Multivitamin",
  "Deep Sleep Magnesium",
  "Gut Balance Probiotic",
  "Metabolism Support Blend",
  "Plant Protein Shake",
  "Cycle Comfort Tea",
  "Stress Relief Ashwagandha",
  "naira",
];

async function main() {
  const assistantId = process.env.VAPI_ASSISTANT_ID;

  const payload = {
    name: "Vera - Order Processing Agent",
    firstMessage:
      "Hello! I'm Vera, your order processing assistant. How can I help you today? Are you looking to place a new order?",
    model: {
      provider: "openrouter",
      model: process.env.OPENROUTER_MODEL || "openai/gpt-4o-mini",
      temperature: 0.7,
      messages: [
        {
          role: "system",
          content: SYSTEM_PROMPT,
        },
      ],
      tools: FUNCTIONS.map((fn) => ({
        type: "function",
        function: fn,
      })),
    },
    transcriber: {
      provider: "deepgram",
      model: "nova-3",
      language: "en",
      keyterm: PRODUCT_NAMES,
    },
    voice: {
      provider: "11labs",
      voiceId: "21m00Tcm4TlvDq8ikWAM",
    },
    server: {
      url: `${publicUrl}/webhook/vapi`,
      headers: { "x-vera-secret": process.env.VAPI_WEBHOOK_SECRET || apiKey },
    },
    credentials: process.env.OPENROUTER_API_KEY
      ? [{ provider: "openrouter", apiKey: process.env.OPENROUTER_API_KEY }]
      : undefined,
    endCallFunctionEnabled: true,
  };

  const client = axios.create({
    baseURL: VAPI_BASE,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
  });

  try {
    let result;
    if (assistantId) {
      console.log(`Updating existing assistant: ${assistantId}`);
      result = await client.patch(`/assistant/${assistantId}`, payload);
      console.log("Assistant updated successfully!");
    } else {
      console.log("Creating new assistant...");
      result = await client.post("/assistant", payload);
      console.log("Assistant created successfully!");
    }

    console.log("\nAssistant Details:");
    console.log(`  ID: ${result.data.id}`);
    console.log(`  Name: ${result.data.name}`);
    console.log(`  Webhook URL: ${publicUrl}/webhook/vapi`);
    console.log("\nAdd this to your .env file:");
    console.log(`  VAPI_ASSISTANT_ID=${result.data.id}`);
  } catch (err: any) {
    console.error("Failed to create/update assistant:");
    if (err.response?.data) {
      console.error(JSON.stringify(err.response.data, null, 2));
    } else {
      console.error(err.message);
    }
    process.exit(1);
  }
}

main();
