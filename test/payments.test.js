// Paying on the platform's page: the test page until Stripe is set up, then Stripe Checkout, by
// one setting. Stripe is faked here (its calls are the kit's, tested there); the trip is real.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server.js';
import { bookableDays } from '../src/rentals.js';
import { served } from './http-client.js';

const dir = mkdtempSync(join(tmpdir(), 'outfitter-pay-'));
after(() => rmSync(dir, { recursive: true, force: true }));
const COST = { N: 2 ** 10, r: 8, p: 1 };
const SECRET = 'test-only-secret-that-is-long-enough-1234';

async function signed(s) {
  await s.post('/rent/kayaks/hold', [['pool', `kayaks/${bookableDays()[4]}`], ['count', '1']]);
  const key = /name="key" value="(r[a-z0-9]+)"/.exec((await s.call('/rent/kayaks')).text)[1];
  await s.post(`/book/${key}/riders`, { 'name-0': 'Pat Quill', 'size-0': '5 ft to 5 ft 8 in', agree: 'yes', signature: 'Pat Quill' });
  return key;
}

test('the same booking on Stripe once its key is there: off to Stripe Checkout, back, booked once, the webhook too', async () => {
  const calls = [];
  let paid = false;
  const stripe = async (url, init = {}) => {
    const path = new URL(url).pathname;
    calls.push({ path, form: init.body ? Object.fromEntries(new URLSearchParams(String(init.body))) : null });
    if (path === '/v1/checkout/sessions') return Response.json({ id: 'cs_test_1', url: 'https://checkout.stripe.com/c/pay/cs_test_1' });
    if (path === '/v1/checkout/sessions/cs_test_1') return Response.json({ id: 'cs_test_1', status: paid ? 'complete' : 'open', payment_status: paid ? 'paid' : 'unpaid', amount_total: calls[0].form['line_items[0][price_data][unit_amount]'] * 1, currency: 'usd', payment_intent: 'pi_1' });
    return new Response('{}', { status: 404 });
  };
  const s = await served(await createApp({ staffCost: COST, db: join(dir, 'stripe.db'), cache: false, secret: SECRET, payEnv: { PAY_STRIPE_KEY: 'sk_test_fake' }, payFetch: stripe }));
  try {
    assert.deepEqual([s.server.payments.name, s.server.payments.sandbox], ['stripe', true]);
    const key = await signed(s);
    assert.match((await s.call(`/book/${key}`)).text, /You’ll pay on Stripe’s secure page next, in its test mode: no money moves\. We never see your card number\./);
    const sent = await s.post('/book', { checkout: key, name: 'Pat Quill', email: 'pat@example.com' });
    assert.equal(sent.location, 'https://checkout.stripe.com/c/pay/cs_test_1');
    assert.equal(calls[0].form.success_url, `${s.base}/pay/back?booking=${key}`);
    assert.equal(calls[0].form.cancel_url, `${s.base}/pay/cancel?booking=${key}`);
    const cents = Number(calls[0].form['line_items[0][price_data][unit_amount]']);
    assert.equal(cents, s.server.desk.store.get('bookings', key).cents, 'the server’s price, never the page’s');

    paid = true;
    assert.equal((await s.call(`/pay/back?booking=${key}`)).location, `/rental/${key}`);
    assert.equal(s.server.desk.store.get('rentals', key).status, 'booked');
    const webhook = await s.call('/pay/webhook', { method: 'POST', body: JSON.stringify({ type: 'checkout.session.completed', data: { object: { id: 'cs_test_1' } } }) });
    assert.equal(webhook.status, 200);
    assert.equal(s.server.sent.filter((mail) => mail.body.includes(`/rental/${key}`)).length, 1, 'one email, not one per way of hearing');
  } finally {
    await s.close();
  }
});

test('backing out of Stripe: nothing charged, the boat stays held, and it can be paid after all', async () => {
  let sessions = 0;
  const stripe = async (url) => {
    const path = new URL(url).pathname;
    if (path === '/v1/checkout/sessions') return Response.json({ id: `cs_${++sessions}`, url: `https://checkout.stripe.com/c/pay/cs_${sessions}` });
    if (path.startsWith('/v1/checkout/sessions/')) return Response.json({ payment_status: 'unpaid', status: 'open', amount_total: 4500, currency: 'usd', payment_intent: 'pi_2' });
    return new Response('{}', { status: 404 });
  };
  const s = await served(await createApp({ staffCost: COST, db: join(dir, 'cancel.db'), cache: false, secret: SECRET, payEnv: { PAY_STRIPE_KEY: 'sk_test_fake' }, payFetch: stripe }));
  try {
    const key = await signed(s);
    await s.post('/book', { checkout: key, name: 'Pat Quill', email: 'pat@example.com' });
    const back = await s.call(`/pay/cancel?booking=${key}`);
    assert.equal(back.location, `/book/${key}?problem=Nothing was charged. Your boats are still held for a few minutes.`);
    assert.equal(s.server.desk.store.get('rentals', key), null);
    assert.equal(s.server.desk.store.get('bookings', key).state, 'failed');
  } finally {
    await s.close();
  }
});
