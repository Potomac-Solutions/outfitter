// Outfitter: rent and book, on one small Node server.
//
// - Pages are rendered by @zubra/server; the kit's slot-picker, booking-summary and
//   checkout-form come from the kit's package, beside this app's own components.
// - Every form is a plain post to a route here, so the whole booking works without JavaScript.
// - The conditions note and each rental's status are Sync documents the server writes; pages
//   follow them live (@zubra/sync).
// - The deciding is the kit's (src/rentals.js): hold, reserve, pay, stages.
import { createServer } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createZubra } from '@zubra/server';
import { signedCookie } from '@potomac-solutions/kit/auth';
import { createStaff } from '@potomac-solutions/kit/staff';
import { staffPages, clientAddress } from '@potomac-solutions/kit/staff/pages';
import { createCustomers } from '@potomac-solutions/kit/customers';
import { createNotify, outbox } from '@potomac-solutions/kit/notify';
import { createNotices } from '@potomac-solutions/kit/notice';
import { lockedStaff, lockedCustomers, staffSignIn, guestSignIn, nightly } from './src/demo.js';
import { loadQr } from '@journey-to-code/symbology';
import { createRentals, dayLabel } from './src/rentals.js';
import { layout, escape } from './src/layout.js';
import { shell } from './src/shell.js';
import { cards } from './src/tables.js';
import { serveAsset } from './src/assets.js';
import * as site from './src/site.js';
import { money } from './src/site.js';
import { createAdmin } from './src/admin.js';

const here = dirname(fileURLToPath(import.meta.url));
/** The staff's pages, for marking where you are in the sidebar. */
const STAFF_LINKS = ['/counter', '/admin', '/admin/rentals', '/admin/customers', '/admin/reports', '/admin/settings', '/admin/outbox', '/staff/people'];
const components = join(here, 'src', 'components');

export async function createApp({ db = join(process.env.DATA_DIR ?? here, 'outfitter.db'), cache = true, secret = process.env.SESSION_SECRET, holdMs, sweepMs, now = Date.now, staffCost, publicUrl = process.env.PUBLIC_URL ?? '' , demo = process.env.DEMO === '1' } = {}) {
  if (!secret) {
    if (process.env.NODE_ENV === 'production') throw new Error('Set SESSION_SECRET.');
    secret = 'outfitter-development-only';
  }
  const desk = await createRentals({ db, holdMs, sweepMs, now });
  const guests = signedCookie({ secret, name: 'guest' });
  const production = process.env.NODE_ENV === 'production';
  // Customers who make an account (kit/customers), in the shop's own log.
  // The public demo (src/demo.js) refuses changes to its sign-ins.
  const kitCustomers = createCustomers({ store: desk.store, secure: production, now, ...(staffCost ? { cost: staffCost } : {}) });
  const customers = demo ? lockedCustomers(kitCustomers) : kitCustomers;
  // A page follows the rentals of its browser and, signed in, of its account.
  desk.identify((request) => {
    const guest = guests.session(request);
    return guest ? { ...guest, customer: customers.session(request)?.customer } : null;
  });
  // Email goes to an outbox the owner can read: this demo sends nothing for real.
  const mail = outbox();
  const notify = createNotify({
    send: mail.send,
    templates: {
      reset: ({ name, link }) => ({ subject: `Reset your ${desk.shop.name} password`, body: `Hi ${name},\n\nSomeone asked to reset the password for your account. This link works once, for an hour:\n\n${link}\n\nIf it wasn’t you, ignore this email.` }),
      booked: ({ name, what, days, code, link, total }) => ({ subject: `Booked: ${what}`, body: `Hi ${name},\n\nYou’re booked: ${what}, ${days}. ${total}, paid (test mode).\n\nYour pickup code is ${code}. Show it at the dock shed:\n${link}\n\n${desk.shop.pickup}` }),
    },
  });
  const zubra = createZubra({ components, cache, packages: ['@potomac-solutions/kit/components'] });
  const qr = await loadQr();
  const { shop } = desk;
  const time = (ms) => new Date(ms).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: shop.timeZone });

  // The people who run the shop: an owner and the staff they invite (the kit's staff module), in the
  // shop's own log; their pages and routes are the kit's too.
  const kitStaff = createStaff({ store: desk.store, secure: production, ...(staffCost ? { cost: staffCost } : {}) });
  const staff = demo ? lockedStaff(kitStaff) : kitStaff;
  // Staff are sent the counter's board: the document that says a rental was booked or moved.
  desk.staffed((request) => staff.can(staff.session(request), 'staff'));
  // A message in an address shows only if the server signed it (kit/notice), so a link can't put
  // its own words in a page's alert.
  const notices = createNotices({ secret });
  const pages = staffPages({ staff, notices, proxies: Number(process.env.TRUST_PROXIES ?? 0), home: '/admin', business: shop.name, secure: production, // A signed-in member of staff sees the kit's pages (people, their password) inside the staff shell;
    // signing in and accepting an invite are a narrow card on the shop's own page.
    render: (res, title, body) => (staff.can(res.who, 'staff') ? staffPage(res, zubra.page(), title, body, { here: title === 'People' ? '/staff/people' : '' }) : page(res, zubra.page(), title, `<div class="auth">${body}</div>`)) });
  const send = (res, status, html) => (res.writeHead(status, { 'content-type': 'text/html; charset=utf-8' }), res.end(html));
  const admin = createAdmin({ desk, customers, sent: mail.sent, now });
  const proxies = Number(process.env.TRUST_PROXIES ?? 0);
  const origin = (req) => publicUrl || `http://${req.headers.host ?? 'localhost'}`;
  const downloadCsv = (res, name, text) => (res.writeHead(200, { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="${name}"`, 'cache-control': 'no-store' }), res.end(text));
  const done = (url) => {
    const words = notices.read(url).done;
    return words ? `<p class="ok" role="status">${escape(words.slice(0, 200))}</p>` : '';
  };
  const back = (res, location) => (res.writeHead(303, { location: notices.sign(location) }), res.end());
  const page = (res, p, title, body, options = {}) => send(res, options.status ?? 200, p.finish(layout({ title, shop, body, ...options })));
  const staffPage = (res, p, title, body, { status = 200, ...options } = {}) => send(res, status, p.finish(shell({ title, shop, body: cards(body), who: res.who, owner: staff.can(res.who, 'owner'), waiting: desk.counter().pickups.length, ...options })));
  const said = (url) => {
    const problem = notices.read(url).problem;
    return problem ? `<p class="notice" role="alert">${escape(problem)}</p>` : '';
  };
  const withProblem = (path, answer) => `${path}?problem=${encodeURIComponent(answer.error)}`;
  async function readForm(req) {
    let body = '';
    for await (const chunk of req) {
      body += chunk;
      if (body.length > 8000) return null;
    }
    return new URLSearchParams(body);
  }

  function rent(p, url, guest, fleet) {
    const draft = desk.draft(guest, fleet.id);
    const live = draft && (draft.state === 'held' || draft.state === 'failed');
    const labels = Object.fromEntries((draft?.pools ?? []).map((pool) => [pool, dayLabel(pool.slice(pool.indexOf('/') + 1))]));
    return `<section class="page-head"><a class="back" href="/#fleet">All rentals</a><h1>${escape(fleet.name)}</h1><p class="lede">${escape(fleet.blurb)} ${money(fleet.cents)} a day, ${money(fleet.weekend)} on Saturdays and Sundays. You get the same ${escape(fleet.one)} every day you book.</p></section>
${said(url)}
${p.render('slot-picker', { days: desk.days(fleet, guest?.pub), hold: `/rent/${fleet.id}/hold`, key: draft?.key ?? '', count: live ? draft.units.length : 1, max: fleet.units.length, unit: fleet.one, heading: 'Pick your days' })}
${live ? p.render('booking-summary', { booking: draft, labels, key: draft.key, book: `/book/${draft.key}/riders`, release: `/rent/${fleet.id}/release`, heldUntil: time(draft.until), unit: fleet.one[0].toUpperCase() + fleet.one.slice(1) }) : ''}`;
  }

  function riders(url, booking, fleet, waiver) {
    const rows = booking.units
      .map(
        (unit, i) => `<div class="rider"><label>Rider on ${escape(fleet.one)} ${escape(unit)}<input name="name-${i}" autocomplete="${i === 0 ? 'name' : 'off'}" required value="${escape(waiver?.riders?.[i]?.name ?? '')}"></label>
<label>${escape(fleet.sizing.label)}<select name="size-${i}" required><option value="">Choose…</option>${fleet.sizing.choices.map((choice) => `<option${waiver?.riders?.[i]?.size === choice ? ' selected' : ''}>${escape(choice)}</option>`).join('')}</select></label></div>`,
      )
      .join('');
    return `<section class="page-head"><a class="back" href="/rent/${fleet.id}">Back to the days</a><h1>Riders and waiver</h1><p class="lede">${booking.units.length} ${escape(booking.units.length === 1 ? fleet.one : fleet.name.toLowerCase())}, ${booking.pools.map((pool) => dayLabel(pool.slice(pool.indexOf('/') + 1))).join(', ')}. Held until ${time(booking.until)}.</p></section>
${said(url)}
<form class="panel" method="post" action="/book/${booking.key}/riders">
  <h2>Who’s riding</h2>
  ${rows}
  <h2>Waiver</h2>
  <ul class="waiver">${shop.waiver.map((line) => `<li>${escape(line)}</li>`).join('')}</ul>
  <label class="check"><input type="checkbox" name="agree" value="yes" required> I agree to this for every rider in this booking.</label>
  <label>Sign with your full name<input name="signature" autocomplete="name" required></label>
  <button type="submit" class="go lg">Sign and go on to pay</button>
</form>`;
  }

  function pay(p, url, booking, fleet, account) {
    const cart = {
      lines: booking.lines.map((line) => ({ item: `${line.pool}/${line.unit}`, qty: 1, name: `${fleet.one[0].toUpperCase() + fleet.one.slice(1)} ${line.unit}, ${dayLabel(line.pool.slice(line.pool.indexOf('/') + 1))}`, total: line.cents })),
      cents: booking.cents,
      ready: booking.state === 'held' || booking.state === 'failed',
    };
    return `<section class="page-head"><a class="back" href="/book/${booking.key}/riders">Back to riders</a><h1>Pay</h1><p class="lede">Held until ${time(booking.until)}. Waiver signed by ${escape(desk.waiver(booking.key).signedBy)}.</p></section>
${p.render('checkout-form', { cart, place: '/book', checkout: booking.key, problem: notices.read(url).problem, testMode: true, name: account?.name ?? desk.waiver(booking.key).signedBy, email: account?.email ?? '' })}`;
  }

  function rentalPage(p, rental) {
    const code = qr.svg(qr.encode(rental.key), { title: `Rental ${rental.key}` });
    return `<section class="page-head"><p class="kicker">Rental · test mode</p><h1>${rental.units.length} ${escape(rental.units.length === 1 ? rental.fleet.one : rental.fleet.name.toLowerCase())}</h1><p class="lede">${rental.days.map(dayLabel).join(', ')} · ${escape(rental.units.join(', '))} · ${money(rental.cents)}</p></section>
${p.render('rental-status', { rental: rental.key, statusNow: rental.status, outNow: rental.out ?? 0, returnedNow: rental.returned ?? 0, timeZone: shop.timeZone })}
<section class="panel dock"><h2>At the dock</h2><p>${escape(shop.pickup)} Show this code at the counter.</p><div class="code">${code}</div><p>Code <strong>${escape(rental.key)}</strong> · waiver signed by ${escape(rental.signedBy)}</p></section>`;
  }

  function counter(p, url) {
    const day = desk.counter();
    const row = (rental, action, label) =>
      `<tr><td><strong>${escape(rental.name || rental.signedBy)}</strong><br><small>${escape(rental.key)}</small></td><td>${escape(rental.fleet.name)}: ${escape(rental.units.join(', '))}<br><small>${rental.days.map(dayLabel).join(', ')}</small></td><td>${rental.riders.map((rider) => `${escape(rider.unit)}: ${escape(rider.name)} (${escape(rider.size)})`).join('<br>')}</td><td><form method="post" action="/counter/${action}"><input type="hidden" name="code" value="${escape(rental.key)}"><button type="submit">${label}</button></form></td></tr>`;
    const done = notices.read(url).done;
    return `${p.render('board-watch', { board: 'counter', revNow: desk.boardRev(), single: 'A new rental', plural: 'new rentals' })}<section class="page-head" data-live="head"><h1>The counter</h1><p class="lede">Today, ${dayLabel(day.today)}. Hand rentals out and take them back; guests see it on their phones.</p></section>
${said(url)}${done ? `<p class="ok" role="status">${escape(done.slice(0, 200))}</p>` : ''}
<form class="panel" method="post" action="/counter/out"><h2>A code from a guest</h2><label>Rental code<input name="code" autocomplete="off" spellcheck="false" required></label><button type="submit">Hand out</button></form>
<div class="stack" data-live="day"><section class="panel"><h2>Going out today <b class="count">${day.pickups.length}</b></h2>${day.pickups.length ? `<table><tbody>${day.pickups.map((rental) => row(rental, 'out', 'Hand out')).join('')}</tbody></table>` : '<p>Nothing waiting.</p>'}</section>
<section class="panel"><h2>Out now <b class="count">${day.out.length}</b></h2>${day.out.length ? `<table><tbody>${day.out.map((rental) => row(rental, 'returned', 'Take back')).join('')}</tbody></table>` : '<p>Nothing out.</p>'}</section></div>
<form class="panel" method="post" action="/counter/conditions"><h2>Today’s note</h2><label>What guests should know (the water, the wind, the trails)<textarea name="text" rows="2" maxlength="280">${escape(desk.conditions().text)}</textarea></label><button type="submit">Post it</button></form>`;
  }

  const server = createServer(async (req, res) => {
    try {
      if (await desk.sync.handle(req, res)) return;
      if (zubra.handle(req, res)) return;
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname === '/health') return res.writeHead(200, { 'content-type': 'text/plain' }).end('ok');
      if (serveAsset(req, res, url)) return;
      // A made-up shop asks not to be listed; a real one (shop.listed) lists its public pages only.
      if (url.pathname === '/robots.txt') return res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' }).end(shop.listed ? 'User-agent: *\nDisallow: /admin\nDisallow: /counter\nDisallow: /staff\nDisallow: /account\nDisallow: /book\nDisallow: /rental\n' : 'User-agent: *\nDisallow: /\n');
      if (url.pathname === '/favicon.ico') return res.writeHead(302, { location: '/assets/favicon.svg' }).end();
      const account = customers.session(req);
      const guest = { ...guests.ensure(req, res), customer: account?.customer };
      const who = staff.session(req);
      const onShift = staff.can(who, 'staff');
      const owner = staff.can(who, 'owner');
      const nav = { customer: account, staff: onShift };
      res.who = who;
      // Staff pages (the admin passes `wide`) go in the staff shell; the rest in the shop's own page.
      const staffHere = () => STAFF_LINKS.filter((href) => url.pathname === href || url.pathname.startsWith(`${href}/`)).sort((a, b) => b.length - a.length)[0] ?? '';
      const show = (p, title, body, { wide = false, here, ...options } = {}) => (wide ? staffPage(res, p, title, body, { here: staffHere(), ...options }) : page(res, p, title, body, { nav, here, ...options }));
      const signInPage = () => show(zubra.page(), 'Sign in', `<div class="auth">${demo ? staffSignIn(escape) : ''}${pages.signIn(url)}</div>`);
      if (url.pathname.startsWith('/account') || url.pathname.startsWith('/admin')) res.setHeader('cache-control', 'no-store');

      if (req.method === 'POST') {
        // Every form is ours: another site's post is refused (the cookies are SameSite=Lax too).
        if (req.headers['sec-fetch-site'] === 'cross-site') return send(res, 403, 'Forbidden');
        const form = await readForm(req);
        if (!form) return send(res, 413, 'Too large');
        const renting = url.pathname.match(/^\/rent\/([a-z]+)\/(hold|release)$/);
        const fleet = renting && desk.fleet(renting[1]);
        if (fleet && renting[2] === 'hold') {
          const done = await desk.hold(guest, fleet, form);
          return back(res, done.ok ? `/rent/${fleet.id}` : withProblem(`/rent/${fleet.id}`, done));
        }
        if (fleet) {
          await desk.release(guest, fleet);
          return back(res, `/rent/${fleet.id}`);
        }
        const signing = url.pathname.match(/^\/book\/(r[a-z0-9]+)\/riders$/);
        if (signing) {
          const done = await desk.sign(guest, signing[1], form);
          return back(res, done.ok ? `/book/${signing[1]}` : withProblem(`/book/${signing[1]}/riders`, done));
        }
        if (url.pathname === '/book') {
          const done = await desk.book(guest, form);
          if (done.ok) {
            const rental = desk.rental(guest, done.key);
            if (rental.email) {
              await notify.notify({ email: rental.email }, 'booked', { name: rental.name || rental.signedBy, what: `${rental.units.length} ${rental.units.length === 1 ? rental.fleet.one : rental.fleet.name.toLowerCase()}`, days: rental.days.map(dayLabel).join(', '), code: rental.key, link: `${origin(req)}/rental/${rental.key}`, total: money(rental.cents) });
            }
            return back(res, `/rental/${done.key}`);
          }
          return back(res, done.key ? withProblem(done.error === 'Sign the waiver first.' ? `/book/${done.key}/riders` : `/book/${done.key}`, done) : withProblem('/', done));
        }
        // A customer's account.
        if (url.pathname.startsWith('/account/')) {
          const p = zubra.page();
          const problem = (words) => `<p class="notice" role="alert">${escape(words)}</p>`;
          if (url.pathname === '/account/sign-up') {
            const made = await customers.signUp({ email: form.get('email'), name: form.get('name'), password: form.get('password') });
            if (made.error) return show(p, 'Make an account', site.signUp({ problem: problem(made.error), form }), { status: 422 });
            await desk.claim(guest, made.customer);
            res.setHeader('set-cookie', made.cookie);
            return back(res, `/account?done=${encodeURIComponent('Welcome. Your account is ready.')}`);
          }
          if (url.pathname === '/account/sign-in') {
            const signed = await customers.signIn(form.get('email'), form.get('password'), { client: clientAddress(req, { proxies }) });
            if (signed.error) return show(p, 'Sign in', (demo ? `<div class="auth">${guestSignIn(escape)}</div>` : '') + site.signIn({ problem: problem(signed.error === 'locked' ? 'Too many tries. Wait 15 minutes, or reset your password.' : 'That email and password don’t match.'), email: String(form.get('email') ?? '') }), { status: 401 });
            await desk.claim(guest, signed.customer);
            res.setHeader('set-cookie', signed.cookie);
            return back(res, '/account');
          }
          if (url.pathname === '/account/sign-out') {
            res.setHeader('set-cookie', (await customers.signOut(req)).cookie);
            return back(res, '/');
          }
          if (url.pathname === '/account/forgot') {
            const raw = await customers.resetToken(form.get('email'));
            const one = raw && customers.list().find((c) => c.email === String(form.get('email')).trim().toLowerCase());
            if (one) {
              const link = `${origin(req)}/account/reset?token=${raw}`;
              await notify.notify({ email: one.email }, 'reset', { name: one.name, link });
              if (!production) console.log(`Password reset for ${one.email}: ${link}`);
            }
            // The same answer whether or not there's an account.
            return show(p, 'Reset your password', site.forgot({ sent: true }));
          }
          if (url.pathname === '/account/reset') {
            const raw = String(form.get('token') ?? '');
            const reset = await customers.reset(raw, form.get('password'));
            if (reset.error) return show(p, 'Choose a new password', site.reset({ token: raw, problem: problem(reset.error), works: customers.peek(raw) }), { status: 422 });
            res.setHeader('set-cookie', reset.cookie);
            return back(res, `/account?done=${encodeURIComponent('Your new password is saved.')}`);
          }
          if (url.pathname === '/account/profile') {
            if (!account) return back(res, '/account/sign-in');
            const renamed = await customers.rename(account.customer, form.get('name'));
            return back(res, renamed.ok ? `/account?done=${encodeURIComponent('Saved.')}` : withProblem('/account', renamed));
          }
          return send(res, 404, 'Not found');
        }
        // The admin's changes. Staff move rentals; owners change customers and settings.
        if (url.pathname.startsWith('/admin/')) {
          if (!onShift) return back(res, '/admin');
          const moving = url.pathname.match(/^\/admin\/rentals\/(r[a-z0-9]+)\/move$/);
          if (moving) {
            const to = form.get('to');
            const moved = to === 'out' || to === 'returned' ? await desk.move(moving[1], to) : { error: 'Not now.' };
            if (moved.error) return back(res, withProblem(`/admin/rentals/${moving[1]}`, moved));
            await desk.audit(who, to === 'out' ? `handed out ${moving[1]}` : `took back ${moving[1]}`, moving[1]);
            return back(res, `/admin/rentals/${moving[1]}?done=${encodeURIComponent(to === 'out' ? 'Handed out.' : 'Taken back.')}`);
          }
          if (!owner) return back(res, '/admin');
          const customerAction = url.pathname.match(/^\/admin\/customers\/(c[a-z0-9]+)\/(disabled|reset)$/);
          const one = customerAction && customers.get(customerAction[1]);
          if (one && customerAction[2] === 'disabled') {
            const off = form.get('disabled') === 'yes';
            const changed = await customers.setDisabled(one.customer, off);
            if (changed?.error) return back(res, withProblem(`/admin/customers/${one.customer}`, changed));
            await desk.audit(who, `${off ? 'turned off' : 'turned back on'} ${one.name}’s account`, one.customer);
            return back(res, `/admin/customers/${one.customer}?done=${encodeURIComponent(off ? 'Turned off and signed out everywhere.' : 'Turned back on.')}`);
          }
          if (one) {
            const raw = await customers.resetToken(one.email);
            if (!raw) return back(res, withProblem(`/admin/customers/${one.customer}`, { error: 'That account is turned off.' }));
            await notify.notify({ email: one.email }, 'reset', { name: one.name, link: `${origin(req)}/account/reset?token=${raw}` });
            await desk.audit(who, `emailed ${one.name} a reset link`, one.customer);
            return back(res, `/admin/customers/${one.customer}?done=${encodeURIComponent('Sent. It’s in the outbox.')}`);
          }
          const fleetSetting = url.pathname.match(/^\/admin\/settings\/fleet\/([a-z]+)$/);
          if (fleetSetting || url.pathname === '/admin/settings/shop') {
            const saved = fleetSetting ? await desk.setFleet(fleetSetting[1], form) : await desk.setShop(form);
            if (saved.error) return back(res, withProblem('/admin/settings', saved));
            await desk.audit(who, fleetSetting ? `changed ${saved.fleet.name.toLowerCase()} prices to ${money(saved.fleet.cents)} and ${money(saved.fleet.weekend)} weekends` : 'changed the shop’s hours, pickup or waiver');
            return back(res, `/admin/settings?done=${encodeURIComponent('Saved. New bookings use it now.')}`);
          }
          return send(res, 404, 'Not found');
        }
        // Sign-in, links, people and passwords.
        if (await pages.handle(req, res, url, form)) return;
        const moving = url.pathname.match(/^\/counter\/(out|returned)$/);
        if (moving || url.pathname === '/counter/conditions') {
          if (!onShift) return back(res, '/counter');
          if (!moving) {
            await desk.setConditions(form.get('text'));
            await desk.audit(who, 'posted today’s note');
            return back(res, `/counter?done=${encodeURIComponent('Posted. Every open page shows it now.')}`);
          }
          const done = await desk.move(form.get('code'), moving[1]);
          if (!done.ok) return back(res, withProblem('/counter', done));
          await desk.audit(who, `${moving[1] === 'out' ? 'handed out' : 'took back'} ${done.rental.key} at the counter`, done.rental.key);
          const what = `${done.rental.units.length} ${done.rental.units.length === 1 ? done.rental.fleet.one : done.rental.fleet.name.toLowerCase()} (${done.rental.units.join(', ')})`;
          return back(res, `/counter?done=${encodeURIComponent(moving[1] === 'out' ? `Handed out: ${what}.` : `Taken back: ${what}.`)}`);
        }
        return send(res, 404, 'Not found');
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method not allowed');

      if (await pages.handle(req, res, url, null)) return;
      const p = zubra.page();
      if (url.pathname === '/') {
        const conditions = desk.conditions();
        const note = p.render('conditions-note', { shop: 'shop', textNow: conditions.text, atNow: conditions.at, atLabel: conditions.at ? time(conditions.at) : '', timeZone: shop.timeZone });
        return show(p, 'Rentals', site.landing({ desk, guest, customer: account, conditions: note }), { here: '/', landing: true });
      }

      // A customer's pages.
      const problem = notices.read(url).problem;
      const said = `${problem ? `<p class="notice" role="alert">${escape(problem)}</p>` : ''}${done(url)}`;
      if (url.pathname === '/account') return account ? show(p, 'Your account', site.account({ desk, guest, customer: account, said }), { here: '/account' }) : back(res, '/account/sign-in');
      if (url.pathname === '/account/sign-in') return account ? back(res, '/account') : show(p, 'Sign in', (demo ? `<div class="auth">${guestSignIn(escape)}</div>` : '') + site.signIn({ problem: said }), { here: '/account/sign-in' });
      if (url.pathname === '/account/sign-up') return account ? back(res, '/account') : show(p, 'Make an account', site.signUp({ problem: said }));
      if (url.pathname === '/account/forgot') return show(p, 'Reset your password', site.forgot());
      if (url.pathname === '/account/reset') {
        const raw = url.searchParams.get('token') ?? '';
        return show(p, 'Choose a new password', site.reset({ token: raw, works: customers.peek(raw) }));
      }

      // The admin: staff only; reports, settings and the outbox for owners.
      if (url.pathname === '/admin' || url.pathname.startsWith('/admin/')) {
        if (!onShift) return signInPage();
        const bar = '';
        const wide = { wide: true, here: '/admin' };
        const ownersOnly = () => show(p, 'Owners only', `<section class="page-head"><h1>Owners only</h1><p class="lede">Reports, settings and the outbox are for owners. Ask one to show you this page.</p></section><p><a class="button light" href="/admin">Back to the overview</a></p>`, { status: 403, wide: true });
        if (url.pathname === '/admin') return show(p, 'Overview', admin.dashboard({ who, owner, bar }), wide);
        if (url.pathname === '/admin/rentals') return show(p, 'Rentals', admin.rentals({ url, owner, bar }), wide);
        if (url.pathname === '/admin/rentals.csv') return downloadCsv(res, 'rentals.csv', admin.rentalsCsv(url));
        const oneRental = url.pathname.match(/^\/admin\/rentals\/(r[a-z0-9]+)$/);
        if (oneRental) {
          const rental = desk.staffRental(oneRental[1]);
          return rental ? show(p, `Rental ${rental.key}`, admin.rental({ rental, owner, bar, said }), wide) : send(res, 404, 'Not found');
        }
        if (url.pathname === '/admin/customers') return show(p, 'Customers', admin.customers({ url, owner, bar }), wide);
        if (url.pathname === '/admin/customers.csv') return downloadCsv(res, 'customers.csv', admin.customersCsv());
        const oneCustomer = url.pathname.match(/^\/admin\/customers\/(c[a-z0-9]+)$/);
        if (oneCustomer) {
          const one = customers.get(oneCustomer[1]);
          return one ? show(p, one.name, admin.customer({ one, owner, bar, said }), wide) : send(res, 404, 'Not found');
        }
        if (!owner) return ownersOnly();
        if (url.pathname === '/admin/reports') return show(p, 'Reports', admin.reports({ url, owner, bar }), wide);
        if (url.pathname === '/admin/reports.csv') return downloadCsv(res, 'revenue.csv', admin.reportCsv(url));
        if (url.pathname === '/admin/settings') return show(p, 'Settings', admin.settings({ owner, bar, said }), wide);
        if (url.pathname === '/admin/outbox') return show(p, 'Outbox', admin.outbox({ owner, bar }), wide);
        return send(res, 404, 'Not found');
      }
      const renting = url.pathname.match(/^\/rent\/([a-z]+)$/);
      const fleet = renting && desk.fleet(renting[1]);
      if (fleet) return show(p, fleet.name, rent(p, url, guest, fleet));

      const booking = url.pathname.match(/^\/book\/(r[a-z0-9]+)(\/riders)?$/);
      if (booking) {
        const held = desk.store.get('bookings', booking[1]);
        if (!held || held.holder !== guest.pub) return back(res, '/');
        const bookedFleet = desk.fleet(held.pools[0].slice(0, held.pools[0].indexOf('/')));
        if (held.state === 'paid') return back(res, `/rental/${booking[1]}`);
        if (!['held', 'failed'].includes(held.state)) return back(res, `/rent/${bookedFleet.id}`);
        const waiver = desk.waiver(booking[1]);
        if (booking[2] || !waiver) return show(p, 'Riders and waiver', riders(url, { ...held, key: booking[1] }, bookedFleet, waiver));
        return show(p, 'Pay', pay(p, url, { ...held, key: booking[1] }, bookedFleet, account));
      }
      const renting2 = url.pathname.match(/^\/rental\/(r[a-z0-9]+)$/);
      const rental = renting2 && desk.rental(guest, renting2[1]);
      if (rental) return show(p, 'Your rental', rentalPage(p, rental));

      if (url.pathname === '/counter') {
        if (!onShift) return signInPage();
        return show(p, 'The counter', counter(p, url), { wide: true });
      }
      send(res, 404, 'Not found');
    } catch (error) {
      console.error(error);
      if (!res.headersSent) send(res, 500, 'Something went wrong.');
      else res.end();
    }
  });

  server.on('close', () => desk.close());
  return Object.assign(server, { demo, desk, staff, customers, sent: mail.sent });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT ?? 3000);
  const server = await createApp();
  if (server.staff.needsOwner()) console.log(`Set up the first owner (works once, for a day): http://localhost:${port}/staff/accept?token=${await server.staff.setup()}`);
  if (server.demo) nightly();
  server.listen(port, '0.0.0.0', () => console.log(`Outfitter on http://localhost:${port}`));
}
