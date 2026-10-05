import { query, getClient } from "../db";
import { createPayment } from "../payments";
import { PaymentInitResult } from "../types";
import { AppError } from "../middleware/errorHandler";
import { config } from "../config";
export async function paymentForOrder(orderId: string, deps = { getClient, query, createPayment }): Promise<PaymentInitResult> {
  const client = await deps.getClient();
  let order: any;
  try {
    await client.query('BEGIN');
    order = (await client.query('SELECT * FROM orders WHERE id = $1 FOR UPDATE', [orderId])).rows[0];
    if (!order) throw new Error('Order not found');
    if (order.checkout_url) { await client.query('COMMIT'); return { success: true, provider: order.payment_provider, reference: order.payment_ref, checkoutUrl: order.checkout_url, message: "Your payment page is ready." }; }
    if (order.payment_started) throw new AppError(409, 'Payment is being prepared. Please wait or contact support with order ' + orderId + '; do not create another order.');
    await client.query('UPDATE orders SET payment_started = TRUE WHERE id = $1', [orderId]);
    await client.query('COMMIT');
  } catch (err) { await client.query('ROLLBACK'); throw err; } finally { client.release(); }
  // Persist the attempt before contacting the provider. Unknown outcomes must not be retried with a new payment.
  const payment = await deps.createPayment(Number(order.total), { orderId, email: order.email || order.shipping_address?.email || '', customerName: order.customer_name || '', callbackUrl: config.frontendUrl + '/order.html' });
  if (!payment.success || !payment.checkoutUrl) throw new Error('Payment could not be prepared. Please contact support with order ' + orderId);
  await deps.query('UPDATE orders SET payment_ref = $1, checkout_url = $2, updated_at = NOW() WHERE id = $3', [payment.reference, payment.checkoutUrl, orderId]);
  return payment;
}
