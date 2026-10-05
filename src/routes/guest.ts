import { Router } from "express";
import { randomBytes } from "crypto";
import { query } from "../db";
import { config } from "../config";
import { asyncHandler } from "../middleware/errorHandler";
import { createRateLimiter } from "../middleware/rateLimiter";
const router = Router();
router.use('/api/guest', createRateLimiter({ windowMs: 60000, max: 120 }));
router.use('/api/guest', asyncHandler(async (req, res, next) => {
  const origin = req.get('origin');
  if (origin && origin !== new URL(config.frontendUrl).origin) return res.status(403).json({ error: 'Invalid origin' });
  let token = req.headers.cookie?.split(';').map(s=>s.trim()).find(s=>s.startsWith('vera_guest='))?.slice(11);
  if (!token || !/^[a-f0-9]{64}$/.test(token)) {
    token = randomBytes(32).toString('hex');
    res.cookie('vera_guest', token, { httpOnly: true, sameSite: 'strict', secure: config.frontendUrl.startsWith('https:'), maxAge: 365*24*60*60*1000 });
  }
  await query('INSERT INTO guest_sessions (token) VALUES ($1) ON CONFLICT DO NOTHING', [token]);
  res.locals.guestToken = token;
  next();
}));
router.get('/api/guest', asyncHandler(async (_req, res) => {
  let guest = (await query('SELECT * FROM guest_sessions WHERE token = $1', [res.locals.guestToken])).rows[0];
  if (guest.voice_token) {
    const voice = (await query('SELECT * FROM guest_sessions WHERE token = $1', [guest.voice_token])).rows[0];
    if (voice?.call_id) guest = voice;
  }
  const order = guest.call_id ? (await query('SELECT o.id, o.status, o.checkout_url FROM orders o JOIN calls c ON c.id = o.call_id WHERE c.vapi_call_id = $1', [guest.call_id])).rows[0] : null;
  const session = guest.call_id ? (await query('SELECT data FROM call_sessions WHERE call_id = $1', [guest.call_id])).rows[0]?.data : null;
  res.set('Cache-Control', 'no-store');
  res.json({ guestToken: res.locals.guestToken, cart: guest.cart, callId: guest.call_id, order: order || null, details: session ? { name: session.customerName, phone: session.customerPhone, email: session.shippingAddress?.email, address: session.shippingAddress } : null });
}));
router.post('/api/guest/voice', asyncHandler(async (_req, res) => {
  // Separate capability per call so an old call cannot overwrite a new cart.
  const voiceToken = randomBytes(32).toString('hex');
  await query('INSERT INTO guest_sessions (token, cart, owner_token) SELECT $1, COALESCE(v.cart, g.cart), g.token FROM guest_sessions g LEFT JOIN guest_sessions v ON v.token = g.voice_token WHERE g.token = $2', [voiceToken, res.locals.guestToken]);
  await query('UPDATE guest_sessions SET voice_token = $1 WHERE token = $2', [voiceToken, res.locals.guestToken]);
  res.json({ guestToken: voiceToken });
}));
router.put('/api/guest/cart', asyncHandler(async (req, res) => {
  const cart = req.body.cart;
  if (!Array.isArray(cart) || cart.length > 50 || cart.some(i => typeof i.id !== 'string' || !Number.isInteger(i.quantity) || i.quantity < 1 || i.quantity > 99)) return res.status(400).json({ error: 'Invalid cart' });
  await query('UPDATE guest_sessions SET cart = $1, voice_token = NULL, updated_at = NOW() WHERE token = $2', [JSON.stringify(cart), res.locals.guestToken]);
  res.json({ ok: true });
}));
router.get('/api/guest/history', asyncHandler(async (_req, res) => {
  const { rows } = await query(
    `SELECT o.id, o.status, o.total::float AS total, o.created_at, o.updated_at, o.payment_provider, o.payment_ref, o.payment_started,
       COALESCE((SELECT json_agg(json_build_object('name',p.name,'quantity',i.quantity,'price',i.price::float)) FROM order_items i JOIN products p ON p.id = i.product_id WHERE i.order_id = o.id), '[]'::json) AS items
     FROM orders o JOIN guest_orders g ON g.order_id = o.id WHERE g.guest_token = $1 ORDER BY o.created_at DESC LIMIT 200`, [res.locals.guestToken]);
  res.set('Cache-Control', 'no-store');
  res.json({ orders: rows });
}));
export default router;
