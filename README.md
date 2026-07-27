# Vera — AI Voice Agent for E-Commerce Order Processing

Vera is a full-stack AI voice agent that handles e-commerce order processing over phone calls. Built with Vapi (voice orchestration), Express (webhook backend), PostgreSQL (products + orders + payments), and configurable payment providers (Stripe or Paystack).

## Architecture

```
Phone Call → Vapi (STT → LLM → TTS) → Express Webhooks → PostgreSQL
                                              ↓
                                    Stripe / Paystack (configurable)
```

**Flow:** Customer calls → Vera greets → searches products → collects details → creates order → initiates payment → provides confirmation

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Voice/Telephony | Vapi (OpenAI LLM + ElevenLabs TTS) |
| Backend | Node.js + Express + TypeScript |
| Database | PostgreSQL 16 |
| Products/Orders | Custom DB (products, orders, order_items, discounts) |
| Payments | Stripe or Paystack (configurable via env) |
| Container | Docker + docker-compose |

## Project Structure

```
Vera/
├── src/
│   ├── index.ts                    # Express server entry point
│   ├── config.ts                   # Environment configuration
│   ├── db/
│   │   ├── index.ts                # PostgreSQL connection pool
│   │   ├── migrate.ts              # Migration runner
│   │   └── migrations/
│   │       ├── 001_initial_schema.sql
│   │       └── 002_custom_ecommerce.sql
│   ├── middleware/
│   │   ├── errorHandler.ts         # Error handling middleware
│   │   └── requestLogger.ts        # Winston logging
│   ├── payments/
│   │   ├── index.ts                # Provider switch based on PAYMENT_PROVIDER
│   │   ├── stripe.ts               # Stripe PaymentIntent + webhook verification
│   │   └── paystack.ts             # Paystack Initialize Transaction + webhook verification
│   ├── routes/
│   │   ├── functions.ts            # Vapi webhook + all function handlers
│   │   ├── admin.ts                # Admin REST: products CRUD, discounts
│   │   └── webhooks.ts             # Payment webhook endpoints
│   ├── services/
│   │   ├── products.ts             # Product + discount DB queries
│   │   └── vapi.ts                 # Vapi API client
│   ├── session/
│   │   └── manager.ts              # Call session state machine
│   └── types/
│       └── index.ts                # TypeScript type definitions
├── scripts/
│   └── create-assistant.ts         # Vapi assistant creation script
├── vapi-assistant.json             # Static Vapi assistant config reference
├── Dockerfile
├── docker-compose.yml
├── .env.example
└── package.json
```

## Prerequisites

- Node.js 20+
- PostgreSQL 16+ (or use docker-compose)
- Vapi account + API key
- Stripe or Paystack account (for payments)
- ngrok or a public URL for Vapi + payment webhooks

## Setup

### 1. Clone & Install

```bash
cd Vera
npm install
```

### 2. Environment Variables

```bash
cp .env.example .env
```

Fill in all credentials in `.env`:

| Variable | Description |
|----------|-------------|
| `PAYMENT_PROVIDER` | `stripe` or `paystack` |
| `VAPI_API_KEY` | From Vapi dashboard → API Keys |
| `STRIPE_SECRET_KEY` | Stripe dashboard → Developers → API Keys |
| `PAYSTACK_SECRET_KEY` | Paystack dashboard → Settings → API Keys |
| `DATABASE_URL` | PostgreSQL connection string |
| `PUBLIC_URL` | Your server's public URL (for webhooks) |

### 3. Database

**With Docker (recommended):**
```bash
docker-compose up -d postgres
```

**Run migrations:**
```bash
npm run migrate
```

This applies both `001_initial_schema.sql` (calls, transfers) and `002_custom_ecommerce.sql` (products, orders, discounts).

### 4. Seed Products

```bash
# Create products via the admin API
curl -X POST http://localhost:3000/products \
  -H "Content-Type: application/json" \
  -d '{"name": "Classic T-Shirt", "price": 29.99, "stock": 100, "sku": "TS-001", "description": "Comfortable cotton t-shirt"}'

curl -X POST http://localhost:3000/products \
  -H "Content-Type: application/json" \
  -d '{"name": "Running Shoes", "price": 89.99, "stock": 50, "sku": "RS-001", "description": "Lightweight running shoes"}'

# Create a discount code
curl -X POST http://localhost:3000/discounts \
  -H "Content-Type: application/json" \
  -d '{"code": "WELCOME10", "type": "percentage", "value": 10}'
```

### 5. Start the Server

```bash
# Development (with auto-reload)
npm run dev

# Production
npm run build
npm start
```

### 6. Expose with ngrok

```bash
ngrok http 3000
```

Copy the HTTPS URL and set it as `PUBLIC_URL` in `.env`.

### 7. Configure Payment Webhooks

**Stripe:**
1. Go to Stripe Dashboard → Developers → Webhooks
2. Add endpoint: `https://YOUR_URL/webhooks/stripe`
3. Select events: `payment_intent.succeeded`, `payment_intent.payment_failed`
4. Copy the webhook signing secret to `STRIPE_WEBHOOK_SECRET`

**Paystack:**
1. Go to Paystack Dashboard → Settings → Webhooks
2. Set URL to `https://YOUR_URL/webhooks/paystack`
3. Copy the webhook secret to `PAYSTACK_WEBHOOK_SECRET`

### 8. Create Vapi Assistant

```bash
npm run create-assistant
```

This creates/updates the Vera assistant in Vapi and prints the assistant ID. Add it to `.env`:

```
VAPI_ASSISTANT_ID=your_new_assistant_id
```

### 9. Configure a Phone Number

1. In Vapi Dashboard → Phone Numbers
2. Buy or connect a number
3. Assign the Vera assistant to the number

## Testing

### Web Call Simulator (Vapi Dashboard)

1. Go to Vapi Dashboard → Phone → Web Call
2. Select the Vera assistant
3. Call and test the full order flow

### Manual Webhook Test

```bash
curl -X POST http://localhost:3000/webhook/vapi \
  -H "Content-Type: application/json" \
  -d '{
    "message": {
      "type": "function-call",
      "call": { "id": "test-call-123" },
      "functionCall": {
        "id": "fn-1",
        "name": "lookup-product",
        "arguments": { "query": "t-shirt" }
      }
    }
  }'
```

### Health Check

```bash
curl http://localhost:3000/health
```

## API Endpoints

### Vapi Webhook
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/webhook/vapi` | POST | Vapi function-call dispatch |

### Payment Webhooks
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/webhooks/stripe` | POST | Stripe payment events |
| `/webhooks/paystack` | POST | Paystack payment events |

### Admin (Products & Discounts)
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/products` | GET | List products (query: `page`, `limit`) |
| `/products/:id` | GET | Get single product |
| `/products` | POST | Create product (`name`, `price`, `stock`, `sku?`, `description?`) |
| `/discounts` | POST | Create discount (`code`, `type`, `value`, `expires_at?`) |

### System
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Health check |

## Payment Provider Switching

Set `PAYMENT_PROVIDER` in `.env` to switch between providers:

- **`stripe`** — Uses Stripe PaymentIntents. Customer gets a `clientSecret` for client-side payment or a reference for manual processing.
- **`paystack`** — Uses Paystack Initialize Transaction. Customer gets a `checkoutUrl` to visit and complete payment.

Both providers verify webhooks via signature validation and update order status to `paid` or `failed` automatically.

## Order Flow State Machine

```
greeting → product_selection → quantity → shipping_address → shipping_method
    → payment → upsell → discount → confirmation → summary → completed
```

## Deployment

### Railway

```bash
railway init
railway add --database postgres
railway variables set PAYMENT_PROVIDER=stripe VAPI_API_KEY=xxx ...
railway up
```

### Docker

```bash
docker-compose up -d
```

## Database Schema

- **calls** — every call log with status, transcript, duration
- **products** — catalog with name, SKU, price, stock
- **discounts** — promo codes (percentage or fixed, with expiry)
- **orders** — order records with payment provider/ref
- **order_items** — line items linking orders to products
- **transfers** — human handoff events with reasons
- **migrations** — migration tracking

## Scripts

| Script | Description |
|--------|-------------|
| `npm run dev` | Start dev server with auto-reload |
| `npm run build` | Compile TypeScript |
| `npm start` | Start production server |
| `npm run migrate` | Run database migrations |
| `npm run create-assistant` | Create/update Vapi assistant via API |
| `npm run lint` | TypeScript type checking |

## License

MIT
