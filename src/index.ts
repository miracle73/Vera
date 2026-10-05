import path from "path";
import express from "express";
import cors from "cors";
import { config } from "./config";
import { logger } from "./middleware/requestLogger";
import { errorHandler } from "./middleware/errorHandler";
import functionRoutes from "./routes/functions";
import adminRoutes from "./routes/admin";
import webhookRoutes from "./routes/webhooks";
import shopRoutes from "./routes/shop";
import guestRoutes from "./routes/guest";

const app = express();

// ── Middleware ──
app.use(cors());

// JSON body parsing — skip for payment webhook paths which need raw body
app.use((req, res, next) => {
  if (req.path === "/webhooks/stripe" || req.path === "/webhooks/paystack") {
    let data = "";
    req.on("data", (chunk) => {
      data += chunk;
    });
    req.on("end", () => {
      (req as any).rawBody = data;
      try {
        req.body = JSON.parse(data);
      } catch {
        req.body = {};
      }
      next();
    });
  } else {
    express.json({ limit: "1mb" })(req, res, next);
  }
});

// Request logging
app.use((req, _res, next) => {
  logger.info("Incoming request", {
    method: req.method,
    path: req.path,
    ip: req.ip,
  });
  next();
});

// ── Routes ──
// Storefront pages
app.use(express.static(path.join(__dirname, "..", "public")));

// Public routes must be mounted before adminRoutes: its auth middleware
// runs for every request that reaches that router.
app.use(functionRoutes);
app.use(shopRoutes);
app.use(guestRoutes);
app.use(webhookRoutes);
app.use(adminRoutes);

// ── 404 ──
app.use((_req, res) => {
  res.status(404).json({ error: "Not found" });
});

// ── Error Handler ──
app.use(errorHandler);

// ── Start Server ──
app.listen(config.port, () => {
  logger.info(`Vera server running on port ${config.port}`, {
    env: config.nodeEnv,
    paymentProvider: config.paymentProvider,
  });
  logger.info("Registered endpoints:");
  logger.info("  POST /webhook/vapi        — Vapi function-call webhook");
  logger.info("  POST /webhooks/stripe     — Stripe payment webhook");
  logger.info("  POST /webhooks/paystack   — Paystack payment webhook");
  logger.info("  GET  /payment/cancelled   — Payment cancel redirect");
  logger.info("  GET  /payment/success     — Payment success redirect");
  logger.info("  GET  /products            — List products");
  logger.info("  GET  /products/:id        — Get product");
  logger.info("  POST /products            — Create product");
  logger.info("  PUT  /products/:id        — Update product");
  logger.info("  DELETE /products/:id      — Delete product");
  logger.info("  GET  /discounts           — List discounts");
  logger.info("  POST /discounts           — Create discount code");
  logger.info("  PUT  /discounts/:id       — Update discount");
  logger.info("  DELETE /discounts/:id     — Delete discount");
  logger.info("  GET  /health              — Health check");
});

export default app;
