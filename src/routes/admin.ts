import { Router, Request, Response } from "express";
import { products } from "../services/products";
import { asyncHandler } from "../middleware/errorHandler";
import { adminAuth } from "../middleware/adminAuth";
import { logger } from "../middleware/requestLogger";

const router = Router();

router.use(adminAuth);

// ── Products ──

router.get(
  "/products",
  asyncHandler(async (req: Request, res: Response) => {
    const page = parseInt(req.query.page as string) || 1;
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
    const result = await products.list(page, limit);
    res.json({ success: true, ...result, page, limit });
  })
);

router.get(
  "/products/:id",
  asyncHandler(async (req: Request, res: Response) => {
    const product = await products.getById(req.params.id);
    if (!product) {
      return res.status(404).json({ success: false, error: "Product not found" });
    }
    res.json({ success: true, product });
  })
);

router.post(
  "/products",
  asyncHandler(async (req: Request, res: Response) => {
    const { name, price, stock, sku, description } = req.body;

    if (!name || price === undefined || stock === undefined) {
      return res.status(400).json({
        success: false,
        error: "name, price, and stock are required",
      });
    }
    if (typeof price !== "number" || price < 0) {
      return res.status(400).json({
        success: false,
        error: "price must be a non-negative number",
      });
    }
    if (typeof stock !== "number" || stock < 0 || !Number.isInteger(stock)) {
      return res.status(400).json({
        success: false,
        error: "stock must be a non-negative integer",
      });
    }

    const product = await products.create(name, price, stock, sku, description);
    logger.info("Product created via admin API", { id: product.id, name });
    res.status(201).json({ success: true, product });
  })
);

router.put(
  "/products/:id",
  asyncHandler(async (req: Request, res: Response) => {
    const { name, price, stock, sku, description } = req.body;
    const fields: Record<string, unknown> = {};

    if (name !== undefined) fields.name = name;
    if (price !== undefined) {
      if (typeof price !== "number" || price < 0) {
        return res.status(400).json({ success: false, error: "price must be a non-negative number" });
      }
      fields.price = price;
    }
    if (stock !== undefined) {
      if (typeof stock !== "number" || stock < 0 || !Number.isInteger(stock)) {
        return res.status(400).json({ success: false, error: "stock must be a non-negative integer" });
      }
      fields.stock = stock;
    }
    if (sku !== undefined) fields.sku = sku;
    if (description !== undefined) fields.description = description;

    if (Object.keys(fields).length === 0) {
      return res.status(400).json({ success: false, error: "No fields to update" });
    }

    const product = await products.update(req.params.id, fields);
    if (!product) {
      return res.status(404).json({ success: false, error: "Product not found" });
    }
    res.json({ success: true, product });
  })
);

router.delete(
  "/products/:id",
  asyncHandler(async (req: Request, res: Response) => {
    const deleted = await products.softDelete(req.params.id);
    if (!deleted) {
      return res.status(404).json({ success: false, error: "Product not found" });
    }
    res.json({ success: true, message: "Product deleted" });
  })
);

// ── Discounts ──

router.get(
  "/discounts",
  asyncHandler(async (_req: Request, res: Response) => {
    const discounts = await products.listDiscounts();
    res.json({ success: true, discounts });
  })
);

router.post(
  "/discounts",
  asyncHandler(async (req: Request, res: Response) => {
    const { code, type, value, expires_at } = req.body;

    if (!code || !type || value === undefined) {
      return res.status(400).json({
        success: false,
        error: "code, type (percentage|fixed), and value are required",
      });
    }
    if (type !== "percentage" && type !== "fixed") {
      return res.status(400).json({
        success: false,
        error: "type must be 'percentage' or 'fixed'",
      });
    }
    if (typeof value !== "number" || value <= 0) {
      return res.status(400).json({
        success: false,
        error: "value must be a positive number",
      });
    }

    const discount = await products.createDiscount(
      code,
      type,
      value,
      expires_at ? new Date(expires_at) : undefined
    );
    res.status(201).json({ success: true, discount });
  })
);

router.put(
  "/discounts/:id",
  asyncHandler(async (req: Request, res: Response) => {
    const { code, type, value, active, expires_at } = req.body;
    const fields: Record<string, unknown> = {};

    if (code !== undefined) fields.code = String(code).toUpperCase();
    if (type !== undefined) {
      if (type !== "percentage" && type !== "fixed") {
        return res.status(400).json({ success: false, error: "type must be 'percentage' or 'fixed'" });
      }
      fields.type = type;
    }
    if (value !== undefined) {
      if (typeof value !== "number" || value <= 0) {
        return res.status(400).json({ success: false, error: "value must be a positive number" });
      }
      fields.value = value;
    }
    if (active !== undefined) fields.active = active;
    if (expires_at !== undefined) fields.expires_at = expires_at ? new Date(expires_at) : null;

    if (Object.keys(fields).length === 0) {
      return res.status(400).json({ success: false, error: "No fields to update" });
    }

    const discount = await products.updateDiscount(req.params.id, fields);
    if (!discount) {
      return res.status(404).json({ success: false, error: "Discount not found" });
    }
    res.json({ success: true, discount });
  })
);

router.delete(
  "/discounts/:id",
  asyncHandler(async (req: Request, res: Response) => {
    const deleted = await products.deleteDiscount(req.params.id);
    if (!deleted) {
      return res.status(404).json({ success: false, error: "Discount not found" });
    }
    res.json({ success: true, message: "Discount deleted" });
  })
);

export default router;
