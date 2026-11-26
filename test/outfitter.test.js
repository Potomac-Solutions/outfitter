// Outfitter's walk: each browser context is one person's phone (or the counter's tablet).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { loadQr } from '@journey-to-code/symbology';
import { createApp } from '../server.js';

// The owner every test shop starts with, set up from the shop's setup link; cheap hashing for tests.
const OWNER = { email: 'owner@example.com', name: 'Test Owner', password: 'test owner password' };
const COST = { N: 2 ** 10, r: 8, p: 1 };
async function withOwner(server) {
  const made = await server.staff.accept(await server.staff.setup(), OWNER);
  if (!made.ok) throw new Error(made.error);
  return server;
}
import { bookableDays } from '../src/rentals.js';

// A redirect's location as words: the signature on its message (kit/notice) checked and taken off.
const plain = (location) => {
  location = String(location ?? '');
  if (/[?&](problem|done)=/.test(location) && !location.startsWith('?')) assert.match(location, /&sig=[\w-]{22}/, `unsigned message: ${location}`);
  return decodeURIComponent(location.replace(/&sig=[\w-]+/, '').replaceAll('+', ' '));
};

const dir = mkdtempSync(join(tmpdir(), 'outfitter-'));
const errors = [];
let browser;
let app;
let quick; // holds that run out in a second and a half

async function start(name, options = {}) {
  const server = await withOwner(await createApp({ staffCost: COST, db: join(dir, `${name}.db`), cache: false, secret: 'test-only-secret-that-is-long-enough-1234', ...options }));
  await new Promise((done) => server.listen(0, done));
  return { server, base: `http://localhost:${server.address().port}` };
}
const stop = (server) => {
  server.closeAllConnections?.();
  return new Promise((done) => server.close(done));
};

before(async () => {
  app = await start('app');
  quick = await start('quick', { holdMs: 1500, sweepMs: 200 });
  // Playwright's own Chromium when it is installed; otherwise the machine's Chrome.
  const system = ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser', 'C:/Program Files/Google/Chrome/Application/chrome.exe', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find((path) => existsSync(path));
  browser = await chromium.launch().catch(() => chromium.launch({ executablePath: process.env.CHROME ?? system }));
});
after(async () => {
  await browser?.close();
  await stop(app.server);
  await stop(quick.server);
  rmSync(dir, { recursive: true, force: true });
  assert.deepEqual(errors, [], 'no page errors in any browser');
});

/** A phone: a browser context with its own guest cookie, with and without JavaScript. */
async function phone(site, name, { javaScriptEnabled = true } = {}) {
  const context = await browser.newContext({ javaScriptEnabled });
  const page = await context.newPage();
  page.on('pageerror', (error) => errors.push(`${name}: ${error.message}`));
  page.on('console', (message) => message.type() === 'error' && !/403/.test(message.text()) && errors.push(`${name}: ${message.text()}`));
  await page.goto(site.base);
  /** A plain form post, as the page's own forms make it: where the server sends the browser. */
  const post = async (path, form, headers = {}) => {
    const response = await context.request.post(`${site.base}${path}`, { form, headers, maxRedirects: 0 });
    return { status: response.status(), location: plain(response.headers().location ?? '') };
  };
  const get = async (path) => (await context.request.get(`${site.base}${path}`)).text();
  return { context, page, post, get };
}

/** Hold, sign and pay by plain posts; the rental's key. */
async function rent(site, guest, { fleet = 'kayaks', days = [3], count = 1, card = '4242 4242 4242 4242', riders } = {}) {
  const held = await postPools(site, guest, fleet, days, count);
  assert.equal(held.location, `/rent/${fleet}`, JSON.stringify(held));
  const key = keyOf(await guest.get(`/rent/${fleet}`));
  const signed = await guest.post(`/book/${key}/riders`, { ...ridersForm(riders ?? Array.from({ length: count }, (_, i) => [`Rider ${i} Teets`, choiceFor(fleet)])), agree: 'yes', signature: 'Sam Teets' });
  assert.equal(signed.location, `/book/${key}`, JSON.stringify(signed));
  const started = await guest.post('/book', { checkout: key, name: 'Sam Teets', email: 'sam@example.com' });
  const paid = await through(site, guest, started, { pay: card !== DECLINED });
  return { key, paid };
}

/**
 * The test payment page, by plain requests: "Pay" (or "Go back without paying"), then the way
 * back. Where it ends up. Stripe's own page stands here until Stripe is set up.
 */
const DECLINED = '4000 0000 0000 0002';
async function through(site, guest, answer, { pay = true } = {}) {
  if (!answer.location.startsWith('/pay/test')) return answer;
  const page = await guest.get(answer.location);
  assert.match(page, /Once Stripe is set up, this page is Stripe’s own\./);
  const ref = new URL(answer.location, site.base).searchParams.get('ref');
  const next = pay ? (await guest.post('/pay/test', { ref, answer: 'pay' })).location : /href="([^"]+)">Go back without paying/.exec(page)[1].replaceAll('&amp;', '&');
  const back = await guest.context.request.get(new URL(next, site.base).href, { maxRedirects: 0 });
  return { status: back.status(), location: plain(back.headers().location ?? '') };
}
const CHOICES = { kayaks: '5 ft to 5 ft 8 in', boards: '150 to 200 lb', bikes: '5 ft 4 in to 5 ft 9 in (M)' };
const choiceFor = (fleet) => CHOICES[fleet];
const ridersForm = (riders) => Object.fromEntries(riders.flatMap(([name, size], i) => [[`name-${i}`, name], [`size-${i}`, size]]));
const keyOf = (html) => /name="key" value="(r[a-z0-9]+)"/.exec(html)?.[1];
async function postPools(site, guest, fleet, days, count) {
  const body = new URLSearchParams([...days.map((i) => ['pool', `${fleet}/${bookableDays()[i]}`]), ['count', String(count)]]).toString();
  const response = await guest.context.request.post(`${site.base}/rent/${fleet}/hold`, { data: body, headers: { 'content-type': 'application/x-www-form-urlencoded' }, maxRedirects: 0 });
  return { status: response.status(), location: plain(response.headers().location ?? '') };
}
const free = (site, fleet, day) => site.server.desk.days(site.server.desk.fleet(fleet)).find((one) => one.pool === `${fleet}/${bookableDays()[day]}`).free;

test('without JavaScript: pick days, sign the waiver, pay, and get a pickup code', async () => {
  const guest = await phone(app, 'no-js', { javaScriptEnabled: false });
  const { page } = guest;
  assert.deepEqual(await page.$$eval('.fleet h2', (h) => h.map((x) => x.textContent)), ['Kayaks', 'Paddleboards', 'Mountain bikes']);
  await page.click('a[href="/rent/kayaks"]');
  // Two days, two kayaks: the same two boats both days.
  const days = page.locator('slot-picker input[name=pool]');
  assert.equal(await days.count(), 14);
  await days.nth(1).check();
  await days.nth(2).check();
  await page.fill('slot-picker input[name=count]', '2');
  await page.click('slot-picker button[type=submit]');
  await page.waitForURL(`${app.base}/rent/kayaks`);
  const summary = await page.locator('booking-summary').innerText();
  const [k1, k2] = /Kayak (K\d)[\s\S]*Kayak (K\d)/.exec(summary).slice(1);
  assert.equal((summary.match(new RegExp(`Kayak ${k1}`, 'g')) ?? []).length, 2, 'the same kayak on both days');
  const weekend = (date) => [0, 6].includes(new Date(`${date}T12:00:00Z`).getUTCDay());
  const expected = [1, 2].reduce((sum, i) => sum + 2 * (weekend(bookableDays()[i]) ? 5000 : 4000), 0);
  assert.match(summary, new RegExp(`Total\\s*\\$${(expected / 100).toFixed(2)}`), 'weekend days at the weekend price');

  // Riders and the waiver come before paying.
  await page.click('booking-summary a');
  await page.waitForURL(/\/riders$/);
  await page.fill('[name=name-0]', 'Rosa Bittinger');
  await page.selectOption('[name=size-0]', '5 ft to 5 ft 8 in');
  await page.fill('[name=name-1]', 'Ana Bittinger');
  await page.selectOption('[name=size-1]', 'Under 5 ft');
  await page.check('[name=agree]');
  await page.fill('[name=signature]', 'Rosa Bittinger');
  await page.click('form.panel button[type=submit]');
  await page.waitForURL(/\/book\/r[a-z0-9]+$/);
  assert.match(await page.locator('main').innerText(), /Waiver signed by Rosa Bittinger/);
  await page.fill('checkout-form input[name=email]', 'rosa@example.com');
  assert.equal(await page.locator('checkout-form input[name=card]').count(), 0, 'no card is typed here');
  await page.click('checkout-form button[type=submit]');
  await page.waitForURL(/\/pay\/test\?ref=/);
  assert.match(await page.locator('main').innerText(), /Test payment page\. No money moves[\s\S]*Once Stripe is set up/);
  await page.click('button:has-text("Pay $")');
  await page.waitForURL(/\/rental\/r[a-z0-9]+$/);
  const key = page.url().split('/').pop();
  assert.match(await page.locator('main').innerText(), new RegExp(`2 kayaks[\\s\\S]*${k1}, ${k2}[\\s\\S]*\\$${expected / 100}`));
  assert.match(await page.locator('rental-status').innerText(), /Booked/);

  // The pickup code is the rental's, drawn by symbology.
  const qr = await loadQr();
  const svg = await page.locator('.code').innerHTML();
  assert.equal(svg, qr.svg(qr.encode(key), { title: `Rental ${key}` }).replace(/<rect([^>]*)\/>/, '<rect$1></rect>').replace(/<path([^>]*)\/>/, '<path$1></path>'));

  // Those two kayaks are gone on those days for everyone, and the rental is on the home page.
  assert.equal(free(app, 'kayaks', 1), 4);
  assert.equal(free(app, 'kayaks', 2), 4);
  await page.goto(app.base);
  assert.match(await page.locator('main').innerText(), /Your rentals[\s\S]*2 kayaks/);
  await guest.context.close();
});

test('the waiver comes first: no riders, no sizes, no agreement or no full name, no paying', async () => {
  const guest = await phone(app, 'waiver');
  assert.equal((await postPools(app, guest, 'boards', [4], 1)).location, '/rent/boards');
  const key = keyOf(await guest.get('/rent/boards'));
  const good = { 'name-0': 'Kai Sines', 'size-0': '150 to 200 lb', agree: 'yes', signature: 'Kai Sines' };
  const tries = [
    [{ ...good, 'name-0': '' }, 'Give every rider’s name.'],
    [{ ...good, 'size-0': 'Huge' }, 'Choose every rider’s weight.'],
    [{ ...good, agree: '' }, 'Agree to the waiver to go on.'],
    [{ ...good, signature: 'Kai' }, 'Sign with your full name.'],
  ];
  for (const [form, said] of tries) assert.equal((await guest.post(`/book/${key}/riders`, form)).location, `/book/${key}/riders?problem=${said}`);
  // Paying before signing goes back to the waiver.
  assert.equal((await guest.post('/book', { checkout: key, name: 'Kai', email: 'k@example.com' })).location, `/book/${key}/riders?problem=Sign the waiver first.`);
  assert.equal(app.server.desk.store.get('bookings', key).state, 'held');
  // The pay page sends an unsigned booking back to the waiver too.
  assert.equal((await guest.context.request.get(`${app.base}/book/${key}`)).url(), `${app.base}/book/${key}`);
  assert.match(await guest.get(`/book/${key}`), /Riders and waiver/);
  await guest.context.close();
});

test('the last bike on a day goes to one person; the same bikes every day or none', async () => {
  const first = await phone(app, 'first bikes', { javaScriptEnabled: false });
  const second = await phone(app, 'second bikes', { javaScriptEnabled: false });
  // First holds four bikes over days 5 and 6; second wants two on day 6 alone: one is left.
  assert.equal((await postPools(app, first, 'bikes', [5, 6], 4)).location, '/rent/bikes');
  assert.equal((await postPools(app, second, 'bikes', [6], 2)).location, '/rent/bikes?problem=Only 1 free on every one of those days.');
  // Two people after the last one at the same moment: one gets it.
  const third = await phone(app, 'third bikes', { javaScriptEnabled: false });
  const [a, b] = await Promise.all([postPools(app, second, 'bikes', [6], 1), postPools(app, third, 'bikes', [6], 1)]);
  assert.deepEqual([a.location, b.location].sort(), ['/rent/bikes', '/rent/bikes?problem=None free on every one of those days.']);
  assert.equal(free(app, 'bikes', 6), 0);
  // Letting go frees them for everyone.
  assert.equal((await first.post('/rent/bikes/release', {})).location, '/rent/bikes');
  assert.equal(free(app, 'bikes', 6), 4);
  assert.equal((await postPools(app, first, 'bikes', [99], 1)).location, '/rent/bikes?problem=Pick from the days shown.');
  await Promise.all([first.context.close(), second.context.close(), third.context.close()]);
});

test('backing out of the payment page books nothing and keeps the hold, to try again; a hold that runs out books nothing', async () => {
  const guest = await phone(app, 'declined', { javaScriptEnabled: false });
  const { key, paid } = await rent(app, guest, { fleet: 'kayaks', days: [7], count: 1, card: '4000 0000 0000 0002' });
  assert.equal(paid.location, `/book/${key}?problem=Nothing was charged. Your boats are still held for a few minutes.`);
  assert.equal(app.server.desk.store.get('bookings', key).state, 'failed');
  assert.equal(free(app, 'kayaks', 7), 5, 'still held');
  assert.equal((await through(app, guest, await guest.post('/book', { checkout: key, name: 'Sam', email: 's@example.com' }))).location, `/rental/${key}`);
  // Someone else's booking can't be paid with their form.
  const other = await phone(app, 'not theirs', { javaScriptEnabled: false });
  assert.equal((await other.post('/book', { checkout: key, name: 'X', email: 'x@example.com' })).location, '/?problem=Your hold ran out. Pick your days again.');
  assert.equal((await other.context.request.get(`${app.base}/rental/${key}`)).status(), 404);
  await other.context.close();
  await guest.context.close();

  const slow = await phone(quick, 'too slow', { javaScriptEnabled: false });
  assert.equal((await postPools(quick, slow, 'kayaks', [2], 1)).location, '/rent/kayaks');
  const slowKey = keyOf(await slow.get('/rent/kayaks'));
  await slow.post(`/book/${slowKey}/riders`, { 'name-0': 'Slow Poke', 'size-0': '5 ft to 5 ft 8 in', agree: 'yes', signature: 'Slow Poke' });
  await new Promise((done) => setTimeout(done, 2000));
  assert.equal(free(quick, 'kayaks', 2), 6, 'the hold ran out on the server');
  const late = await through(quick, slow, await slow.post('/book', { checkout: slowKey, name: 'Slow', email: 's@example.com' }));
  assert.ok(late.location.startsWith(`/book/${slowKey}?problem=`), late.location);
  assert.equal(quick.server.desk.store.get('rentals', slowKey), null);
  await slow.context.close();
});

test('the counter hands a rental out and takes it back, each once; the guest sees it live', async () => {
  const guest = await phone(app, 'paddler');
  const { key, paid } = await rent(app, guest, { fleet: 'boards', days: [0], count: 1 });
  assert.equal(paid.location, `/rental/${key}`);
  await guest.page.goto(`${app.base}/rental/${key}`);
  await guest.page.waitForFunction(() => customElements.get('rental-status'));
  await guest.page.waitForTimeout(400); // the live stream open

  // Not on a shift: no counter, and its posts do nothing.
  const outsider = await phone(app, 'outsider', { javaScriptEnabled: false });
  assert.match(await outsider.get('/counter'), /<button type=\"submit\">Sign in<\/button>/);
  assert.equal((await outsider.post('/counter/out', { code: key })).location, '/counter');
  assert.equal(app.server.desk.store.get('rentals', key).status, 'booked');
  assert.equal((await outsider.post('/staff/sign-in', {}, { 'sec-fetch-site': 'cross-site' })).status, 403);

  const staff = await phone(app, 'counter', { javaScriptEnabled: false });
  await staff.post('/staff/sign-in', { email: OWNER.email, password: OWNER.password });
  const today = await staff.get('/counter');
  assert.match(today, new RegExp(`Going out today[\\s\\S]*${key}[\\s\\S]*Rider 0 Teets \\(150 to 200 lb\\)`), 'the counter sees riders and sizes');
  assert.equal((await staff.post('/counter/returned', { code: key })).location, '/counter?problem=That rental hasn’t gone out yet.');
  assert.match((await staff.post('/counter/out', { code: key })).location, /^\/counter\?done=Handed out: 1 paddleboard \(P\d\)\.$/);
  assert.equal((await staff.post('/counter/out', { code: key })).location, '/counter?problem=That rental is already out.');
  await guest.page.locator('rental-status li.done', { hasText: 'Out' }).waitFor({ timeout: 5000 });
  assert.match(await guest.page.locator('rental-status').innerText(), /Handed out at \d{1,2}:\d{2} [AP]M/);
  assert.match((await staff.post('/counter/returned', { code: key })).location, /^\/counter\?done=Taken back/);
  await guest.page.locator('rental-status li.done', { hasText: 'Returned' }).waitFor({ timeout: 5000 });
  assert.equal((await staff.post('/counter/out', { code: 'r00000000' })).location, '/counter?problem=That isn’t one of our rentals.');
  await Promise.all([guest.context.close(), outsider.context.close(), staff.context.close()]);
});

test('the staff post today’s note, and every open page shows it at once', async () => {
  const reader = await phone(app, 'reader');
  await reader.page.waitForFunction(() => customElements.get('conditions-note'));
  await reader.page.waitForTimeout(400);
  const staff = await phone(app, 'note writer', { javaScriptEnabled: false });
  await staff.post('/staff/sign-in', { email: OWNER.email, password: OWNER.password });
  assert.match((await staff.post('/counter/conditions', { text: 'Fog until 9, then calm. Water 64°F.' })).location, /^\/counter\?done=Posted/);
  await reader.page.locator('conditions-note', { hasText: 'Fog until 9, then calm. Water 64°F.' }).waitFor({ timeout: 5000 });
  // Without JavaScript it's in the page.
  const plain = await phone(app, 'plain reader', { javaScriptEnabled: false });
  assert.match(await plain.page.locator('conditions-note').innerText(), /Today on the lake: Fog until 9[\s\S]*Posted at \d{1,2}:\d{2} [AP]M/);
  await Promise.all([reader.context.close(), staff.context.close(), plain.context.close()]);
});

test('a page reads the note and its own rentals, nothing else; it writes nothing', async () => {
  const owner = await phone(app, 'owner', { javaScriptEnabled: false });
  const { key } = await rent(app, owner, { fleet: 'kayaks', days: [9], count: 1 });
  const other = await phone(app, 'nosy', { javaScriptEnabled: false });
  const pull = async (person, scope = '') => {
    const all = [];
    for (let since = 0, i = 0; i < 200; i++) {
      const page = await (await person.context.request.get(`${app.base}/_zb/sync/pull?since=${encodeURIComponent(since)}${scope}`)).json();
      all.push(...(page.changes ?? []));
      if (!page.changes?.length || page.cursor === since) break;
      since = page.cursor;
    }
    return all;
  };
  for (const change of await pull(other)) assert.equal(change.collection, 'conditions', `${change.collection} isn't sent to another guest`);
  const theirs = await pull(owner);
  assert.deepEqual([...new Set(theirs.filter((change) => change.collection === 'rentals').map((change) => change.key))], [key]);
  for (const change of theirs) assert.ok(['conditions', 'rentals'].includes(change.collection), change.collection);
  assert.deepEqual(await pull(other, `&scope=${encodeURIComponent(JSON.stringify({ waivers: true, bookings: true, rentals: true }))}`), []);
  const push = await other.context.request.post(`${app.base}/_zb/sync/push`, {
    headers: { 'sec-fetch-site': 'same-origin' },
    data: { changes: [{ collection: 'conditions', key: 'shop', field: 'text', value: 'Closed!', clock: `${String(Date.now()).padStart(15, '0')}-00000-x` }] },
  });
  assert.equal(push.status(), 403);
  // Nor any collection of its own making.
  const own = await other.context.request.post(`${app.base}/_zb/sync/push`, {
    headers: { 'sec-fetch-site': 'same-origin' },
    data: { changes: [{ collection: 'notes', key: 'mine', field: 'text', value: 'hi', clock: `${String(Date.now()).padStart(15, '0')}-00000-x` }] },
  });
  assert.equal(own.status(), 403);
  // A post from another site changes nothing.
  assert.equal((await other.post('/rent/kayaks/hold', { pool: `kayaks/${bookableDays()[1]}`, count: '1' }, { 'sec-fetch-site': 'cross-site' })).status, 403);
  await owner.context.close();
  await other.context.close();
});

test('with JavaScript: the whole booking in the browser, and the page tells the components apart', async () => {
  const guest = await phone(app, 'with-js');
  const { page } = guest;
  await page.click('a[href="/rent/boards"]');
  await page.locator('slot-picker input[name=pool]').nth(10).check();
  await page.click('slot-picker button[type=submit]');
  await page.waitForURL(`${app.base}/rent/boards`);
  await page.click('booking-summary a');
  await page.fill('[name=name-0]', 'June Harsh');
  await page.selectOption('[name=size-0]', 'Under 150 lb');
  await page.check('[name=agree]');
  await page.fill('[name=signature]', 'June Harsh');
  await page.click('form.panel button[type=submit]');
  await page.waitForURL(/\/book\/r[a-z0-9]+$/);
  await page.waitForFunction(() => customElements.get('checkout-form') && customElements.get('text-field'));
  await page.waitForTimeout(300);
  await page.fill('checkout-form input[name=email]', 'june@example.com');
  assert.equal(await page.locator('checkout-form input[name=card]').count(), 0, 'no card is typed here');
  await page.click('checkout-form button[type=submit]');
  await page.waitForURL(/\/pay\/test\?ref=/);
  assert.match(await page.locator('main').innerText(), /Test payment page\. No money moves[\s\S]*Once Stripe is set up/);
  await page.click('button:has-text("Pay $")');
  await page.waitForURL(/\/rental\/r[a-z0-9]+$/);
  await page.waitForFunction(() => customElements.get('rental-status'));
  // The kit's components come from its package; the app's own from its folder.
  for (const path of ['/_zubra/components/@potomac-solutions/kit/components/checkout-form.js', '/_zubra/components/rental-status.js', '/_zubra/components/conditions-note.js']) {
    assert.equal((await guest.context.request.get(`${app.base}${path}`)).status(), 200, path);
  }
  await guest.context.close();
});

test('the counter’s lists are live: a rental booked for today and one handed out show without a reload, to staff only', async () => {
  const desk = await phone(app, 'counter tablet');
  await desk.post('/staff/sign-in', { email: OWNER.email, password: OWNER.password });
  await desk.page.goto(`${app.base}/counter`);
  await desk.page.waitForFunction(() => customElements.get('board-watch'));
  await desk.page.waitForTimeout(400);
  // The page is the same document throughout: a reload would lose this.
  await desk.page.evaluate(() => (window.sameDocument = true));
  await desk.page.fill('input[name=code]:not([type=hidden])', 'half-typed');

  const guest = await phone(app, 'booking today', { javaScriptEnabled: false });
  const { key } = await rent(app, guest, { fleet: 'bikes', days: [0], count: 1 });
  const going = desk.page.locator('[data-live=day] section', { hasText: 'Going out today' });
  await going.locator('tr', { hasText: key }).waitFor({ timeout: 5000 });
  // The count in the sidebar follows too: it says what a fresh page would.
  const sideNow = /data-live="waiting-side">(?:<b[^>]*>(\d+)<\/b>)?/.exec(await desk.get('/counter'))?.[1] ?? '';
  await desk.page.waitForFunction((want) => (document.querySelector('[data-live="waiting-side"]')?.textContent ?? '') === want, sideNow, { timeout: 5000 });
  // A rental for a later day changes nothing the counter shows, so the board isn't touched.
  const revBefore = app.server.desk.boardRev();
  const later = await phone(app, 'booking next week', { javaScriptEnabled: false });
  await rent(app, later, { fleet: 'kayaks', days: [6], count: 1 });
  assert.equal(app.server.desk.boardRev(), revBefore, 'a later day leaves the board alone');
  await later.context.close();
  await desk.page.locator('board-watch [role=status]', { hasText: 'A new rental came in.' }).waitFor({ timeout: 2000 });
  assert.equal(await desk.page.inputValue('input[name=code]:not([type=hidden])'), 'half-typed', 'what staff were typing is kept');

  // Another tablet hands it out: this one follows.
  const other = await phone(app, 'second tablet', { javaScriptEnabled: false });
  await other.post('/staff/sign-in', { email: OWNER.email, password: OWNER.password });
  await other.post('/counter/out', { code: key });
  const out = desk.page.locator('[data-live=day] section', { hasText: 'Out now' });
  await out.locator('tr', { hasText: key }).waitFor({ timeout: 5000 });
  assert.equal(await desk.page.evaluate(() => window.sameDocument), true, 'never reloaded');

  // The swapped-in row still works: its button takes the rental back.
  await out.locator('tr', { hasText: key }).locator('button').click();
  await desk.page.waitForURL(/done=/);
  assert.equal(app.server.desk.store.get('rentals', key).status, 'returned');

  // Staff are sent the board; a guest's page never is.
  const pull = async (who) => (await who.context.request.get(`${app.base}/_zb/sync/pull?since=0`)).text();
  assert.match(await pull(other), /boards/, 'staff pull the board');
  assert.doesNotMatch(await pull(guest), /boards/, 'a guest does not');
  await Promise.all([desk, guest, other].map((one) => one.context.close()));
});
