// The admin, the customer accounts and the reports, over plain HTTP (no browser needed).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server.js';
import { bookableDays } from '../src/rentals.js';

const COST = { N: 2 ** 10, r: 8, p: 1 };
const OWNER = { email: 'owner@example.com', name: 'Test Owner', password: 'test owner password' };
const STAFF = { email: 'hand@example.com', name: 'Counter Hand', password: 'counter hand password' };
const dir = mkdtempSync(join(tmpdir(), 'outfitter-admin-'));
let server;
let base;

before(async () => {
  server = await createApp({ staffCost: COST, db: join(dir, 'shop.db'), cache: false, secret: 'test' });
  await server.staff.accept(await server.staff.setup(), OWNER);
  const owner = server.staff.list().find((one) => one.email === OWNER.email);
  await server.staff.accept((await server.staff.invite(owner, { email: STAFF.email, name: STAFF.name, roles: ['staff'] })).token, STAFF);
  await new Promise((done) => server.listen(0, done));
  base = `http://localhost:${server.address().port}`;
});
after(async () => {
  server.closeAllConnections?.();
  await new Promise((done) => server.close(done));
  rmSync(dir, { recursive: true, force: true });
});

/** One browser: its cookies, plain gets and form posts. */
function browser() {
  const jar = new Map();
  const remember = (response) => {
    for (const line of response.headers.getSetCookie()) {
      const [pair] = line.split(';');
      const at = pair.indexOf('=');
      const value = pair.slice(at + 1);
      if (value) jar.set(pair.slice(0, at), value);
      else jar.delete(pair.slice(0, at));
    }
    return response;
  };
  const cookie = () => [...jar].map(([name, value]) => `${name}=${value}`).join('; ');
  const where = (response) => decodeURIComponent((response.headers.get('location') ?? '').replace(/&sig=[\w-]+/, '').replaceAll('+', ' '));
  return {
    jar,
    async get(path) {
      const response = remember(await fetch(`${base}${path}`, { headers: { cookie: cookie() }, redirect: 'manual' }));
      return { status: response.status, type: response.headers.get('content-type'), location: where(response), text: await response.text() };
    },
    async post(path, form) {
      const response = remember(await fetch(`${base}${path}`, { method: 'POST', headers: { cookie: cookie(), 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(form), redirect: 'manual' }));
      return { status: response.status, location: where(response), text: await response.text() };
    },
  };
}

async function signInStaff(who) {
  const b = browser();
  await b.get('/');
  const signed = await b.post('/staff/sign-in', { email: who.email, password: who.password });
  assert.equal(signed.location, '/admin');
  return b;
}

/** Hold, sign and pay for one unit; the rental's key. */
async function rent(b, { fleet = 'kayaks', day = 2, email = 'pat@example.com' } = {}) {
  const held = await b.post(`/rent/${fleet}/hold`, [['pool', `${fleet}/${bookableDays()[day]}`], ['count', '1']]);
  assert.equal(held.location, `/rent/${fleet}`);
  const key = /name="key" value="(r[a-z0-9]+)"/.exec((await b.get(`/rent/${fleet}`)).text)[1];
  const sizes = { kayaks: '5 ft to 5 ft 8 in', boards: '150 to 200 lb', bikes: '5 ft 4 in to 5 ft 9 in (M)' };
  await b.post(`/book/${key}/riders`, { 'name-0': 'Pat Quill', 'size-0': sizes[fleet], agree: 'yes', signature: 'Pat Quill' });
  const paid = await b.post('/book', { checkout: key, name: 'Pat Quill', email, card: '4242 4242 4242 4242' });
  assert.equal(paid.location, `/rental/${key}`);
  return key;
}

test('the landing page shows the fleets, how it works, and a way to book', async () => {
  const page = (await browser().get('/')).text;
  for (const words of ['Out on Deep Creek Lake', 'What we rent', 'How it works', 'href="/rent/kayaks"', 'href="/account/sign-in"']) assert.ok(page.includes(words), words);
  assert.ok(!page.includes('href="/admin">Admin<'), 'no admin link for a guest');
});

test('a customer signs up, and rentals booked from the browser join the account and follow it', async () => {
  const phone = browser();
  await phone.get('/');
  const key = await rent(phone, { day: 3 });
  const made = await phone.post('/account/sign-up', { name: 'Pat Quill', email: 'Pat@Example.com', password: 'pat quill password' });
  assert.equal(made.location, '/account?done=Welcome. Your account is ready.');
  assert.match((await phone.get('/account')).text, new RegExp(`Hello, Pat[\\s\\S]*${key}`));
  assert.equal(server.desk.store.get('rentals', key).customer, server.customers.list()[0].customer);

  // Another device, signed in: the same rental, and checkout knows who it is.
  const laptop = browser();
  await laptop.get('/');
  assert.match((await laptop.post('/account/sign-in', { email: 'pat@example.com', password: 'wrong password!' })).text, /don’t match/);
  assert.equal((await laptop.post('/account/sign-in', { email: 'pat@example.com', password: 'pat quill password' })).location, '/account');
  assert.match((await laptop.get(`/rental/${key}`)).text, /Show this code at the counter/);
  const second = await rent(laptop, { fleet: 'bikes', day: 4 });
  assert.equal(server.desk.store.get('rentals', second).customer, server.customers.list()[0].customer, 'booked signed in: on the account');
  assert.match((await phone.get('/account')).text, new RegExp(second));

  // Signed out, the laptop sees neither.
  assert.equal((await laptop.post('/account/sign-out', {})).location, '/');
  assert.equal((await laptop.get('/account')).location, '/account/sign-in');
  assert.equal((await laptop.get(`/rental/${key}`)).status, 404);
});

test('a forgotten password: the same answer either way, and the emailed link works once', async () => {
  const b = browser();
  await b.get('/');
  await b.post('/account/sign-up', { name: 'Lee Forgets', email: 'lee@example.com', password: 'lee first password' });
  const before = server.sent.length;
  const nobody = await b.post('/account/forgot', { email: 'nobody@example.com' });
  const lee = await b.post('/account/forgot', { email: 'lee@example.com' });
  assert.equal(nobody.text.match(/<main[\s\S]*<\/main>/)[0], lee.text.match(/<main[\s\S]*<\/main>/)[0], 'no hint whether an account exists');
  assert.equal(server.sent.length, before + 1);
  const link = /http:\/\/[^\s]+\/account\/reset\?token=([\w-]{43})/.exec(server.sent.at(-1).body);
  assert.ok(link, 'the email carries the link');
  assert.equal((await b.post('/account/reset', { token: link[1], password: 'lee second password' })).location, '/account?done=Your new password is saved.');
  assert.match((await b.post('/account/reset', { token: link[1], password: 'lee third password' })).text, /expired/);
});

test('the admin is for staff; reports, settings and the outbox are for owners', async () => {
  const guest = browser();
  await guest.get('/');
  for (const path of ['/admin', '/admin/rentals', '/admin/reports', '/admin/customers.csv']) {
    const page = await guest.get(path);
    assert.ok(!/Overview|Revenue|text\/csv/.test(`${page.text}${page.type}`), path);
    assert.match(page.text, /Sign in/, path);
  }
  assert.equal((await guest.post('/admin/settings/fleet/kayaks', { cents: '1', weekend: '1', blurb: 'x' })).location, '/admin');

  const hand = await signInStaff(STAFF);
  assert.match((await hand.get('/admin')).text, /Overview[\s\S]*Revenue, last 30 days/);
  assert.match((await hand.get('/admin/rentals')).text, /<h1>Rentals<\/h1>/);
  assert.ok(!(await hand.get('/admin')).text.includes('href="/admin/reports"'), 'staff see no owner links');
  for (const path of ['/admin/reports', '/admin/settings', '/admin/outbox']) assert.equal((await hand.get(path)).status, 403, path);
  assert.equal((await hand.post('/admin/settings/fleet/kayaks', { cents: '1', weekend: '1', blurb: 'x' })).location, '/admin');
  assert.equal(server.desk.fleet('kayaks').cents, 4000);

  const owner = await signInStaff(OWNER);
  for (const path of ['/admin/reports', '/admin/settings', '/admin/outbox']) assert.equal((await owner.get(path)).status, 200, path);
});

test('staff find a rental, hand it out from its page, and it shows in the activity', async () => {
  const b = browser();
  await b.get('/');
  const key = await rent(b, { fleet: 'boards', day: 0, email: 'finder@example.com' });
  const hand = await signInStaff(STAFF);
  const found = (await hand.get('/admin/rentals?q=finder%40example')).text;
  assert.match(found, new RegExp(`/admin/rentals/${key}`));
  assert.ok(!found.includes('pat@example.com'), 'search narrows the list');
  assert.match((await hand.get(`/admin/rentals/${key}`)).text, /Hand out[\s\S]*Pat Quill \(150 to 200 lb\)/);
  assert.equal((await hand.post(`/admin/rentals/${key}/move`, { to: 'out' })).location, `/admin/rentals/${key}?done=Handed out.`);
  assert.equal(server.desk.store.get('rentals', key).status, 'out');
  assert.match((await hand.get('/admin')).text, new RegExp(`Counter Hand</strong> handed out ${key}`));
  assert.match((await hand.post(`/admin/rentals/${key}/move`, { to: 'out' })).location, /already out/);
});

test('an owner changes a price: new holds use it, and paid rentals keep theirs', async () => {
  const owner = await signInStaff(OWNER);
  const paidBefore = server.desk.allRentals().find((rental) => rental.fleet.id === 'kayaks');
  assert.match((await owner.post('/admin/settings/fleet/kayaks', { cents: 'lots', weekend: '50', blurb: 'Boats.' })).location, /day price/);
  assert.equal((await owner.post('/admin/settings/fleet/kayaks', { cents: '42.50', weekend: '$55', blurb: 'Steady boats.' })).location, '/admin/settings?done=Saved. New bookings use it now.');
  assert.match((await browser().get('/')).text, /Steady boats\.[\s\S]*\$42\.50 a day, \$55 weekends/);
  const days = bookableDays();
  const weekday = days.findIndex((day) => ![0, 6].includes(new Date(`${day}T12:00:00Z`).getUTCDay()));
  const weekendDay = days.findIndex((day) => [0, 6].includes(new Date(`${day}T12:00:00Z`).getUTCDay()));
  const b = browser();
  await b.get('/');
  await b.post('/rent/kayaks/hold', [['pool', `kayaks/${days[weekday]}`], ['pool', `kayaks/${days[weekendDay]}`], ['count', '1']]);
  const held = server.desk.store.under('bookings').filter((booking) => booking.state === 'held').at(-1);
  assert.equal(held.cents, 4250 + 5500);
  assert.equal(server.desk.store.get('rentals', paidBefore.key).cents, paidBefore.cents);
  // Back as it was, for the other tests.
  await owner.post('/admin/settings/fleet/kayaks', { cents: '40', weekend: '50', blurb: 'Stable sit-on-top kayaks for the coves. Paddle and life jacket included.' });
});

test('an owner turns a customer off: signed out everywhere, and can’t sign back in', async () => {
  const b = browser();
  await b.get('/');
  await b.post('/account/sign-up', { name: 'Off Switch', email: 'off@example.com', password: 'off switch password' });
  const one = server.customers.list().find((c) => c.email === 'off@example.com');
  const owner = await signInStaff(OWNER);
  assert.equal((await owner.post(`/admin/customers/${one.customer}/disabled`, { disabled: 'yes' })).location, `/admin/customers/${one.customer}?done=Turned off and signed out everywhere.`);
  assert.equal((await b.get('/account')).location, '/account/sign-in');
  assert.match((await b.post('/account/sign-in', { email: 'off@example.com', password: 'off switch password' })).text, /don’t match/);
  const hand = await signInStaff(STAFF);
  await hand.post(`/admin/customers/${one.customer}/disabled`, { disabled: 'no' });
  assert.equal(server.customers.get(one.customer).disabled, true, 'staff can’t turn it back on');
});

test('reports and CSV downloads: the numbers add up, and a name can’t become a formula', async () => {
  const b = browser();
  await b.get('/');
  await rent(b, { fleet: 'bikes', day: 5, email: 'sheet@example.com' });
  await server.desk.store.write('rentals', server.desk.allRentals()[0].key, { name: '=HYPERLINK("http://evil.example")' });
  const owner = await signInStaff(OWNER);
  const report = (await owner.get('/admin/reports?range=30d')).text;
  const total = server.desk.allRentals().reduce((sum, rental) => sum + rental.cents, 0);
  assert.match(report, new RegExp(`Revenue</span><strong>\\$${(total / 100).toLocaleString('en-US')}</strong>`));
  const csv = await owner.get('/admin/reports.csv?range=30d');
  assert.match(csv.type, /^text\/csv/);
  const rows = csv.text.trim().split('\r\n');
  assert.equal(rows[0], 'Day,Rentals,Revenue (USD)');
  assert.equal(rows.length, 31);
  assert.equal(rows.slice(1).reduce((sum, row) => sum + Number(row.split(',')[2]), 0), total / 100);
  const rentals = (await owner.get('/admin/rentals.csv')).text;
  assert.match(rentals, /"'=HYPERLINK\(""http:\/\/evil\.example""\)"/);
  assert.match((await owner.get('/admin/customers.csv')).text, /^Name,Email,Joined/);
});
