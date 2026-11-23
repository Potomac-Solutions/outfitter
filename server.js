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
import { staffPages } from '@potomac-solutions/kit/staff/pages';
import { createNotices } from '@potomac-solutions/kit/notice';
import { loadQr } from '@journey-to-code/symbology';
import { createRentals, dayLabel } from './src/rentals.js';
import { layout, escape } from './src/layout.js';
import { shell } from './src/shell.js';
import { cards } from './src/tables.js';
import { serveAsset } from './src/assets.js';
import { landing } from './src/site.js';

const here = dirname(fileURLToPath(import.meta.url));
const components = join(here, 'src', 'components');
const money = (cents) => `$${(cents / 100).toFixed(2).replace(/\.00$/, '')}`;

export async function createApp({ db = join(process.env.DATA_DIR ?? here, 'outfitter.db'), cache = true, secret = process.env.SESSION_SECRET, holdMs, sweepMs, now , staffCost } = {}) {
  if (!secret) {
    if (process.env.NODE_ENV === 'production') throw new Error('Set SESSION_SECRET.');
    secret = 'outfitter-development-only';
  }
  const desk = await createRentals({ db, holdMs, sweepMs, now });
  const guests = signedCookie({ secret, name: 'guest' });
  desk.identify((request) => guests.session(request));
  const zubra = createZubra({ components, cache, packages: ['@potomac-solutions/kit/components'] });
  const qr = await loadQr();
  const { shop } = desk;
  const time = (ms) => new Date(ms).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: shop.timeZone });

  // The people who run the shop: an owner and the staff they invite (the kit's staff module), in the
  // shop's own log; their pages and routes are the kit's too.
  const production = process.env.NODE_ENV === 'production';
  const staff = createStaff({ store: desk.store, secure: production, ...(staffCost ? { cost: staffCost } : {}) });
  // A message in an address shows only if the server signed it (kit/notice), so a link can't put
  // its own words in a page's alert.
  const notices = createNotices({ secret });
  const pages = staffPages({ staff, notices, proxies: Number(process.env.TRUST_PROXIES ?? 0), home: '/counter', business: shop.name, secure: production, // A signed-in member of staff sees the kit's pages (people, their password) inside the staff frame;
    // signing in and accepting an invite are a narrow card on the shop's own page.
    render: (res, title, body) => (staff.can(res.who, 'staff') ? staffPage(res, zubra.page(), title, body, { here: title === 'People' ? '/staff/people' : '' }) : page(res, zubra.page(), title, `<div class="auth">${body}</div>`)) });
  const send = (res, status, html) => (res.writeHead(status, { 'content-type': 'text/html; charset=utf-8' }), res.end(html));
  const back = (res, location) => (res.writeHead(303, { location: notices.sign(location) }), res.end());
  const page = (res, p, title, body, options = {}) => send(res, 200, p.finish(layout({ title, shop, body, ...options })));
  const staffPage = (res, p, title, body, options = {}) => send(res, 200, p.finish(shell({ title, shop, body: cards(body), who: res.who, owner: staff.can(res.who, 'owner'), waiting: desk.counter().pickups.length, ...options })));
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

  function home(p, guest) {
    const conditions = desk.conditions();
    const note = p.render('conditions-note', { shop: 'shop', textNow: conditions.text, atNow: conditions.at, atLabel: conditions.at ? new Date(conditions.at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: shop.timeZone }) : '', timeZone: shop.timeZone });
    const mine = desk
      .rentalsFor(guest)
      .map((rental) => `<li><a href="/rental/${rental.key}">${rental.units.length} ${escape(rental.units.length === 1 ? rental.fleet.one : rental.fleet.name.toLowerCase())}, ${rental.days.map(dayLabel).join(', ')}<span>${rental.status === 'booked' ? 'booked' : rental.status === 'out' ? 'out' : 'returned'}</span></a></li>`)
      .join('');
    return landing({ shop, fleets: desk.fleets, money, mine, note });
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

  function pay(p, url, booking, fleet) {
    const cart = {
      lines: booking.lines.map((line) => ({ item: `${line.pool}/${line.unit}`, qty: 1, name: `${fleet.one[0].toUpperCase() + fleet.one.slice(1)} ${line.unit}, ${dayLabel(line.pool.slice(line.pool.indexOf('/') + 1))}`, total: line.cents })),
      cents: booking.cents,
      ready: booking.state === 'held' || booking.state === 'failed',
    };
    return `<section class="page-head"><a class="back" href="/book/${booking.key}/riders">Back to riders</a><h1>Pay</h1><p class="lede">Held until ${time(booking.until)}. Waiver signed by ${escape(desk.waiver(booking.key).signedBy)}.</p></section>
${p.render('checkout-form', { cart, place: '/book', checkout: booking.key, problem: notices.read(url).problem, testMode: true, name: desk.waiver(booking.key).signedBy })}`;
  }

  function rentalPage(p, rental) {
    const code = qr.svg(qr.encode(rental.key), { title: `Rental ${rental.key}` });
    return `<section class="page-head"><p class="kicker">Rental · test mode</p><h1>${rental.units.length} ${escape(rental.units.length === 1 ? rental.fleet.one : rental.fleet.name.toLowerCase())}</h1><p class="lede">${rental.days.map(dayLabel).join(', ')} · ${escape(rental.units.join(', '))} · ${money(rental.cents)}</p></section>
${p.render('rental-status', { rental: rental.key, statusNow: rental.status, outNow: rental.out ?? 0, returnedNow: rental.returned ?? 0, timeZone: shop.timeZone })}
<section class="panel dock"><h2>At the dock</h2><p>${escape(shop.pickup)} Show this code at the counter.</p><div class="code">${code}</div><p>Code <strong>${escape(rental.key)}</strong> · waiver signed by ${escape(rental.signedBy)}</p></section>`;
  }

  function counter(url) {
    const day = desk.counter();
    const row = (rental, action, label) =>
      `<tr><td><strong>${escape(rental.name || rental.signedBy)}</strong><br><small>${escape(rental.key)}</small></td><td>${escape(rental.fleet.name)}: ${escape(rental.units.join(', '))}<br><small>${rental.days.map(dayLabel).join(', ')}</small></td><td>${rental.riders.map((rider) => `${escape(rider.unit)}: ${escape(rider.name)} (${escape(rider.size)})`).join('<br>')}</td><td><form method="post" action="/counter/${action}"><input type="hidden" name="code" value="${escape(rental.key)}"><button type="submit">${label}</button></form></td></tr>`;
    const done = notices.read(url).done;
    return `<section class="page-head"><h1>The counter</h1><p class="lede">Today, ${dayLabel(day.today)}. Hand rentals out and take them back; guests see it on their phones.</p></section>
${said(url)}${done ? `<p class="ok" role="status">${escape(done.slice(0, 200))}</p>` : ''}
<form class="panel" method="post" action="/counter/out"><h2>A code from a guest</h2><label>Rental code<input name="code" autocomplete="off" spellcheck="false" required></label><button type="submit">Hand out</button></form>
<section class="panel"><h2>Going out today <b class="count">${day.pickups.length}</b></h2>${day.pickups.length ? `<table><tbody>${day.pickups.map((rental) => row(rental, 'out', 'Hand out')).join('')}</tbody></table>` : '<p>Nothing waiting.</p>'}</section>
<section class="panel"><h2>Out now <b class="count">${day.out.length}</b></h2>${day.out.length ? `<table><tbody>${day.out.map((rental) => row(rental, 'returned', 'Take back')).join('')}</tbody></table>` : '<p>Nothing out.</p>'}</section>
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
      if (url.pathname === '/robots.txt') return res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' }).end(shop.listed ? 'User-agent: *\nDisallow: /counter\nDisallow: /staff\nDisallow: /book\nDisallow: /rental\n' : 'User-agent: *\nDisallow: /\n');
      if (url.pathname === '/favicon.ico') return res.writeHead(302, { location: '/assets/favicon.svg' }).end();
      const guest = guests.ensure(req, res);
      const who = staff.session(req);
      const onShift = staff.can(who, 'staff');
      res.who = who;

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
          if (done.ok) return back(res, `/rental/${done.key}`);
          return back(res, done.key ? withProblem(done.error === 'Sign the waiver first.' ? `/book/${done.key}/riders` : `/book/${done.key}`, done) : withProblem('/', done));
        }
        // Sign-in, links, people and passwords.
        if (await pages.handle(req, res, url, form)) return;
        const moving = url.pathname.match(/^\/counter\/(out|returned)$/);
        if (moving || url.pathname === '/counter/conditions') {
          if (!onShift) return back(res, '/counter');
          if (!moving) {
            await desk.setConditions(form.get('text'));
            return back(res, `/counter?done=${encodeURIComponent('Posted. Every open page shows it now.')}`);
          }
          const done = await desk.move(form.get('code'), moving[1]);
          if (!done.ok) return back(res, withProblem('/counter', done));
          const what = `${done.rental.units.length} ${done.rental.units.length === 1 ? done.rental.fleet.one : done.rental.fleet.name.toLowerCase()} (${done.rental.units.join(', ')})`;
          return back(res, `/counter?done=${encodeURIComponent(moving[1] === 'out' ? `Handed out: ${what}.` : `Taken back: ${what}.`)}`);
        }
        return send(res, 404, 'Not found');
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method not allowed');

      if (await pages.handle(req, res, url, null)) return;
      const p = zubra.page();
      if (url.pathname === '/') return page(res, p, 'Kayaks, paddleboards and bikes by the day', home(p, guest), { landing: true });
      const renting = url.pathname.match(/^\/rent\/([a-z]+)$/);
      const fleet = renting && desk.fleet(renting[1]);
      if (fleet) return page(res, p, fleet.name, rent(p, url, guest, fleet));

      const booking = url.pathname.match(/^\/book\/(r[a-z0-9]+)(\/riders)?$/);
      if (booking) {
        const held = desk.store.get('bookings', booking[1]);
        if (!held || held.holder !== guest.pub) return back(res, '/');
        const bookedFleet = desk.fleet(held.pools[0].slice(0, held.pools[0].indexOf('/')));
        if (held.state === 'paid') return back(res, `/rental/${booking[1]}`);
        if (!['held', 'failed'].includes(held.state)) return back(res, `/rent/${bookedFleet.id}`);
        const waiver = desk.waiver(booking[1]);
        if (booking[2] || !waiver) return page(res, p, 'Riders and waiver', riders(url, { ...held, key: booking[1] }, bookedFleet, waiver));
        return page(res, p, 'Pay', pay(p, url, { ...held, key: booking[1] }, bookedFleet));
      }
      const renting2 = url.pathname.match(/^\/rental\/(r[a-z0-9]+)$/);
      const rental = renting2 && desk.rental(guest, renting2[1]);
      if (rental) return page(res, p, 'Your rental', rentalPage(p, rental));

      if (url.pathname === '/counter') {
        if (!onShift) return page(res, p, 'Sign in', `<div class="auth">${pages.signIn(url)}</div>`);
        return staffPage(res, p, 'The counter', pages.bar(who) + counter(url), { here: '/counter' });
      }
      send(res, 404, 'Not found');
    } catch (error) {
      console.error(error);
      if (!res.headersSent) send(res, 500, 'Something went wrong.');
      else res.end();
    }
  });

  server.on('close', () => desk.close());
  return Object.assign(server, { desk, staff });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT ?? 3000);
  const server = await createApp();
  if (server.staff.needsOwner()) console.log(`Set up the first owner (works once, for a day): http://localhost:${port}/staff/accept?token=${await server.staff.setup()}`);
  server.listen(port, '0.0.0.0', () => console.log(`Outfitter on http://localhost:${port}`));
}
