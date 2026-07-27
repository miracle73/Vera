import { query } from "../db";
import { ProductRecord, DiscountRecord } from "../types";
import { logger } from "../middleware/requestLogger";

class ProductService {
  async search(queryStr: string): Promise<ProductRecord[]> {
    const { rows } = await query<ProductRecord>(
      `SELECT * FROM products
       WHERE active = TRUE
         AND (
           name ILIKE $1
           OR sku ILIKE $1
           OR description ILIKE $1
         )
       ORDER BY name
       LIMIT 10`,
      [`%${queryStr}%`]
    );
    return rows;
  }

  async getById(id: string): Promise<ProductRecord | null> {
    const { rows } = await query<ProductRecord>(
      "SELECT * FROM products WHERE id = $1 AND active = TRUE",
      [id]
    );
    return rows[0] || null;
  }

  async getBySku(sku: string): Promise<ProductRecord | null> {
    const { rows } = await query<ProductRecord>(
      "SELECT * FROM products WHERE sku = $1 AND active = TRUE",
      [sku]
    );
    return rows[0] || null;
  }

  async getStock(productId: string): Promise<number> {
    const { rows } = await query<{ stock: number }>(
      "SELECT stock FROM products WHERE id = $1",
      [productId]
    );
    return rows[0]?.stock ?? 0;
  }

  async decrementStock(productId: string, quantity: number): Promise<boolean> {
    const { rowCount } = await query(
      `UPDATE products SET stock = stock - $1, updated_at = NOW()
       WHERE id = $2 AND stock >= $1`,
      [quantity, productId]
    );
    return (rowCount ?? 0) > 0;
  }

  async create(
    name: string,
    price: number,
    stock: number,
    sku?: string,
    description?: string
  ): Promise<ProductRecord> {
    const { rows } = await query<ProductRecord>(
      `INSERT INTO products (name, price, stock, sku, description)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [name, price, stock, sku || null, description || null]
    );
    logger.info("Product created", { id: rows[0].id, name });
    return rows[0];
  }

  async update(
    id: string,
    fields: Partial<Pick<ProductRecord, "name" | "price" | "stock" | "sku" | "description">>
  ): Promise<ProductRecord | null> {
    const sets: string[] = [];
    const values: unknown[] = [];
    let idx = 1;

    for (const [key, val] of Object.entries(fields)) {
      if (val !== undefined) {
        sets.push(`${key} = $${idx}`);
        values.push(val);
        idx++;
      }
    }

    if (sets.length === 0) return this.getById(id);

    sets.push(`updated_at = NOW()`);
    values.push(id);

    const { rows } = await query<ProductRecord>(
      `UPDATE products SET ${sets.join(", ")} WHERE id = $${idx} AND active = TRUE RETURNING *`,
      values
    );
    return rows[0] || null;
  }

  async softDelete(id: string): Promise<boolean> {
    const { rowCount } = await query(
      `UPDATE products SET active = FALSE, updated_at = NOW() WHERE id = $1`,
      [id]
    );
    return (rowCount ?? 0) > 0;
  }

  async list(
    page = 1,
    limit = 50
  ): Promise<{ products: ProductRecord[]; total: number }> {
    const offset = (page - 1) * limit;
    const { rows: countRows } = await query<{ count: string }>(
      "SELECT COUNT(*) as count FROM products WHERE active = TRUE"
    );
    const total = parseInt(countRows[0]?.count || "0", 10);

    const { rows } = await query<ProductRecord>(
      `SELECT * FROM products WHERE active = TRUE
       ORDER BY created_at DESC
       LIMIT $1 OFFSET $2`,
      [limit, offset]
    );

    return { products: rows, total };
  }

  async validateDiscountCode(
    code: string,
    orderTotal: number
  ): Promise<{
    valid: boolean;
    type: string;
    value: number;
    title: string;
  }> {
    const { rows } = await query<DiscountRecord>(
      `SELECT * FROM discounts
       WHERE code = $1 AND active = TRUE
         AND (expires_at IS NULL OR expires_at > NOW())`,
      [code.toUpperCase()]
    );

    const discount = rows[0];
    if (!discount) {
      return { valid: false, type: "", value: 0, title: "" };
    }

    let amount = 0;
    if (discount.type === "percentage") {
      amount = (orderTotal * discount.value) / 100;
    } else {
      amount = Math.min(discount.value, orderTotal);
    }

    return {
      valid: true,
      type: discount.type,
      value: amount,
      title: discount.code,
    };
  }

  async createDiscount(
    code: string,
    type: "percentage" | "fixed",
    value: number,
    expiresAt?: Date
  ): Promise<DiscountRecord> {
    const { rows } = await query<DiscountRecord>(
      `INSERT INTO discounts (code, type, value, expires_at)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [code.toUpperCase(), type, value, expiresAt || null]
    );
    logger.info("Discount created", { code, type, value });
    return rows[0];
  }

  async getDiscountById(id: string): Promise<DiscountRecord | null> {
    const { rows } = await query<DiscountRecord>(
      "SELECT * FROM discounts WHERE id = $1",
      [id]
    );
    return rows[0] || null;
  }

  async updateDiscount(
    id: string,
    fields: Partial<Pick<DiscountRecord, "code" | "type" | "value" | "active" | "expires_at">>
  ): Promise<DiscountRecord | null> {
    const sets: string[] = [];
    const values: unknown[] = [];
    let idx = 1;

    for (const [key, val] of Object.entries(fields)) {
      if (val !== undefined) {
        sets.push(`${key} = $${idx}`);
        values.push(val);
        idx++;
      }
    }

    if (sets.length === 0) return this.getDiscountById(id);

    values.push(id);

    const { rows } = await query<DiscountRecord>(
      `UPDATE discounts SET ${sets.join(", ")} WHERE id = $${idx} RETURNING *`,
      values
    );
    return rows[0] || null;
  }

  async deleteDiscount(id: string): Promise<boolean> {
    const { rowCount } = await query(
      "DELETE FROM discounts WHERE id = $1",
      [id]
    );
    return (rowCount ?? 0) > 0;
  }

  async listDiscounts(): Promise<DiscountRecord[]> {
    const { rows } = await query<DiscountRecord>(
      "SELECT * FROM discounts ORDER BY created_at DESC"
    );
    return rows;
  }
}

export const products = new ProductService();
