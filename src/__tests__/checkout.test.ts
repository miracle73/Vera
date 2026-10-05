import assert from 'node:assert/strict';
import { test } from 'node:test';
import express from 'express';
import { SessionManager } from '../session/manager';
import { paymentForOrder } from '../services/checkout';
import { adminAuth } from '../middleware/adminAuth';
import functions from '../routes/functions';
import { config } from '../config';
import pool from '../db';

function clientForOrder(existing = false, failStock = false) {
  const sql: string[] = [];
  const client: any = {
    release() {},
    async query(text: string) {
      sql.push(text);
      if (text.startsWith('INSERT INTO calls')) return { rows: [{ id: 'call-db' }] };
      if (text.startsWith('SELECT * FROM orders')) return { rows: existing ? [{ id: 'original' }] : [] };
      if (text.startsWith('UPDATE products')) return { rows: failStock ? [] : [{ price: 20 }] };
      if (text.startsWith('INSERT INTO orders')) return { rows: [{ id: 'new-order' }] };
      return { rows: [] };
    }
  };
  return { client, sql };
}
function manager() {
  const manager = new SessionManager();
  manager.addItem('call', { productId: 'p1', title: 'Product', quantity: 2, price: 1 });
  return manager;
}
test('voice confirmation reuses existing order without reducing stock again', async () => {
  const { client, sql } = clientForOrder(true);
  assert.equal(await manager().persistOrder('call', async () => client), 'original');
  assert.equal(sql.some(s => s.startsWith('UPDATE products')), false);
  assert.equal(sql.some(s => s.startsWith('INSERT INTO order_items')), false);
});
test('stock exhaustion rolls back before any order is written', async () => {
  const { client, sql } = clientForOrder(false, true);
  await assert.rejects(manager().persistOrder('call', async () => client), /Insufficient stock/);
  assert.equal(sql.at(-1), 'ROLLBACK');
  assert.equal(sql.some(s => s.startsWith('INSERT INTO orders')), false);
});
test('order, stock and lines commit together using current catalog price', async () => {
  const { client, sql } = clientForOrder();
  const session = manager();
  await session.persistOrder('call', async () => client);
  assert.equal(sql[0], 'BEGIN');
  assert.equal(sql.at(-1), 'COMMIT');
  assert.equal(session.get('call')?.total, 40);
  assert.ok(sql.findIndex(s=>s.startsWith('UPDATE products')) < sql.findIndex(s=>s.startsWith('INSERT INTO orders')));
});
test('payment timeout cannot initialize another payment on retry', async () => {
  const order = { total: 40, payment_started: false };
  let attempts = 0;
  const client: any = { release() {}, async query(sql: string) {
    if (sql.startsWith('SELECT')) return { rows: [order] };
    if (sql.startsWith('UPDATE')) order.payment_started = true;
    return { rows: [] };
  } };
  const deps: any = { getClient: async () => client, query: async () => {}, createPayment: async () => { attempts++; throw new Error('timeout'); } };
  await assert.rejects(paymentForOrder('order', deps), /timeout/);
  await assert.rejects(paymentForOrder('order', deps), /being prepared/);
  assert.equal(attempts, 1);
});
test('confirmed payment link is reused without contacting provider', async () => {
  const client: any = { release() {}, async query(sql: string) { return { rows: sql.startsWith('SELECT') ? [{ checkout_url: 'https://checkout.paystack.com/example', payment_ref: 'ref', payment_provider: 'paystack' }] : [] }; } };
  const deps: any = { getClient: async () => client, createPayment: async () => { assert.fail('must not create another payment'); } };
  assert.equal((await paymentForOrder('order', deps)).reference, 'ref');
});
test('missing admin configuration denies access', () => {
  const previous = config.admin.apiKey;
  (config.admin as any).apiKey = '';
  let status = 0;
  const res: any = { status(code: number) { status = code; return this; }, json() {} };
  try { adminAuth({} as any, res, () => assert.fail('must not authorize')); assert.equal(status, 503); }
  finally { (config.admin as any).apiKey = previous; }
});
test('voice webhook rejects missing/wrong secret before database access', async () => {
  const previous = config.vapi.webhookSecret;
  (config.vapi as any).webhookSecret = 'test-secret';
  const app = express(); app.use(express.json()); app.use(functions);
  const server = app.listen(0);
  await new Promise<void>(resolve => server.once('listening', resolve));
  const port = (server.address() as any).port;
  try {
    for (const secret of ['', 'wrong']) {
      const res = await fetch(`http://127.0.0.1:${port}/webhook/vapi`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-vera-secret': secret }, body: JSON.stringify({ message: { type: 'tool-calls' } }) });
      assert.equal(res.status, 401);
    }
  } finally { (config.vapi as any).webhookSecret = previous; await new Promise<void>(resolve => server.close(()=>resolve())); }
});
test.after(async () => { await pool.end(); });
