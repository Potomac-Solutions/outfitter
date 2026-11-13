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
import { loadQr } from '@journey-to-code/symbology';
import { createRentals, dayLabel } from './src/rentals.js';
import { layout, escape } from './src/layout.js';

const here = dirname(fileURLToPath(import.meta.url));
const components = join(here, 'src', 'components');
const money = (cents) => `$${(cents / 100).toFixed(2).replace(/\.00$/, '')}`;

export async function createApp({ db = join(process.env.DATA_DIR ?? here, 'outfitter.db'), cache = true, secret = process.env.SESSION_SECRET, holdMs, sweepMs, now } = {}) {
  if (!secret) {
    if (process.env.NODE_ENV === 'production') throw new Error('Set SESSION_SECRET.');
    secret = 'outfitter-development-only';
  }
  const desk = await createRentals({ db, holdMs, sweepMs, now });
  const guests = signedCookie({ secret, name: 'guest' });
  // Staff accounts come later: for the concept, a device starts a counter shift.
  const staff = signedCookie({ secret, name: 'staff', maxAge: 12 * 3600 });
  desk.identify((request) => guests.session(request));
  const zubra = createZubra({ components, cache, packages: ['@potomac-solutions/kit/components'] });
  const qr = await loadQr();
  const { shop } = desk;
  const time = (ms) => new Date(ms).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: shop.timeZone });

  const send = (res, status, html) => (res.writeHead(status, { 'content-type': 'text/html; charset=utf-8' }), res.end(html));
  const back = (res, location) => (res.writeHead(303, { location }), res.end());
  const page = (res, p, title, body) => send(res, 200, p.finish(layout({ title, shop, body })));
  const said = (url) => {
    const problem = (url.searchParams.get('problem') ?? '').slice(0, 200);
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
    const mine = desk.rentalsFor(guest);
    const conditions = desk.conditions();
    return `<section><h1>Out on ${escape(shop.place)}</h1><p class="lede">${escape(shop.hours)}. Book by the day, sign the waiver online, and pick up at the dock.</p></section>
${p.render('conditions-note', { shop: 'shop', textNow: conditions.text, atNow: conditions.at, timeZone: shop.timeZone })}
${mine.length ? `<section class="panel"><h2>Your rentals</h2><ul>${mine.map((rental) => `<li><a href="/rental/${rental.key}">${rental.units.length} ${escape(rental.units.length === 1 ? rental.fleet.one : rental.fleet.name.toLowerCase())}, ${rental.days.map(dayLabel).join(', ')}</a>${rental.status === 'booked' ? '' : ` · ${rental.status === 'out' ? 'out' : 'returned'}`}</li>`).join('')}</ul></section>` : ''}
<ul class="fleets">${desk.fleets
      .map(
        (fleet) => `<li class="fleet"><h2>${escape(fleet.name)}</h2><p>${escape(fleet.blurb)}</p><p class="price">${money(fleet.cents)} a day, ${money(fleet.weekend)} weekends</p><a class="go" href="/rent/${fleet.id}">Book ${escape(fleet.name.toLowerCase())}</a></li>`,
      )
      .join('')}</ul>`;
  }

  function rent(p, url, guest, fleet) {
    const draft = desk.draft(guest, fleet.id);
    const live = draft && (draft.state === 'held' || draft.state === 'failed');
    const labels = Object.fromEntries((draft?.pools ?? []).map((pool) => [pool, dayLabel(pool.slice(pool.indexOf('/') + 1))]));
    return `<section><a href="/">All rentals</a><h1>${escape(fleet.name)}</h1><p class="lede">${escape(fleet.blurb)} ${money(fleet.cents)} a day, ${money(fleet.weekend)} on Saturdays and Sundays. You get the same ${escape(fleet.one)} every day you book.</p></section>
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
    return `<section><a href="/rent/${fleet.id}">Back to the days</a><h1>Riders and waiver</h1><p class="lede">${booking.units.length} ${escape(booking.units.length === 1 ? fleet.one : fleet.name.toLowerCase())}, ${booking.pools.map((pool) => dayLabel(pool.slice(pool.indexOf('/') + 1))).join(', ')}. Held until ${time(booking.until)}.</p></section>
${said(url)}
<form class="panel" method="post" action="/book/${booking.key}/riders">
  <h2>Who’s riding</h2>
  ${rows}
  <h2>Waiver</h2>
  <ul>${shop.waiver.map((line) => `<li>${escape(line)}</li>`).join('')}</ul>
  <label class="check"><input type="checkbox" name="agree" value="yes" required> I agree to this for every rider in this booking.</label>
  <label>Sign with your full name<input name="signature" autocomplete="name" required></label>
  <button type="submit">Sign and go on to pay</button>
</form>`;
  }

  function pay(p, url, booking, fleet) {
    const cart = {
      lines: booking.lines.map((line) => ({ item: `${line.pool}/${line.unit}`, qty: 1, name: `${fleet.one[0].toUpperCase() + fleet.one.slice(1)} ${line.unit}, ${dayLabel(line.pool.slice(line.pool.indexOf('/') + 1))}`, total: line.cents })),
      cents: booking.cents,
      ready: booking.state === 'held' || booking.state === 'failed',
    };
    return `<section><a href="/book/${booking.key}/riders">Back to riders</a><h1>Pay</h1><p class="lede">Held until ${time(booking.until)}. Waiver signed by ${escape(desk.waiver(booking.key).signedBy)}.</p></section>
${p.render('checkout-form', { cart, place: '/book', checkout: booking.key, problem: (url.searchParams.get('problem') ?? '').slice(0, 200), testMode: true, name: desk.waiver(booking.key).signedBy })}`;
  }

  function rentalPage(p, rental) {
    const code = qr.svg(qr.encode(rental.key), { title: `Rental ${rental.key}` });
    return `<section><p class="lede">Rental · test mode</p><h1>${rental.units.length} ${escape(rental.units.length === 1 ? rental.fleet.one : rental.fleet.name.toLowerCase())}</h1><p class="lede">${rental.days.map(dayLabel).join(', ')} · ${escape(rental.units.join(', '))} · ${money(rental.cents)}</p></section>
${p.render('rental-status', { rental: rental.key, statusNow: rental.status, outNow: rental.out ?? 0, returnedNow: rental.returned ?? 0, timeZone: shop.timeZone })}
<section class="panel"><h2>At the dock</h2><p>${escape(shop.pickup)} Show this code at the counter.</p><div class="code">${code}</div><p>Code <strong>${escape(rental.key)}</strong> · waiver signed by ${escape(rental.signedBy)}</p></section>`;
  }

  function counter(url) {
    const day = desk.counter();
    const row = (rental, action, label) =>
      `<tr><td><strong>${escape(rental.name || rental.signedBy)}</strong><br><small>${escape(rental.key)}</small></td><td>${escape(rental.fleet.name)}: ${escape(rental.units.join(', '))}<br><small>${rental.days.map(dayLabel).join(', ')}</small></td><td>${rental.riders.map((rider) => `${escape(rider.unit)}: ${escape(rider.name)} (${escape(rider.size)})`).join('<br>')}</td><td><form method="post" action="/counter/${action}"><input type="hidden" name="code" value="${escape(rental.key)}"><button type="submit">${label}</button></form></td></tr>`;
    const done = url.searchParams.get('done');
    return `<section><h1>The counter</h1><p class="lede">Today, ${dayLabel(day.today)}. Hand rentals out and take them back; guests see it on their phones.</p></section>
${said(url)}${done ? `<p class="ok" role="status">${escape(done.slice(0, 200))}</p>` : ''}
<form class="panel" method="post" action="/counter/out"><h2>A code from a guest</h2><label>Rental code<input name="code" autocomplete="off" spellcheck="false" required></label><button type="submit">Hand out</button></form>
<section class="panel"><h2>Going out today</h2>${day.pickups.length ? `<table><tbody>${day.pickups.map((rental) => row(rental, 'out', 'Hand out')).join('')}</tbody></table>` : '<p>Nothing waiting.</p>'}</section>
<section class="panel"><h2>Out now</h2>${day.out.length ? `<table><tbody>${day.out.map((rental) => row(rental, 'returned', 'Take back')).join('')}</tbody></table>` : '<p>Nothing out.</p>'}</section>
<form class="panel" method="post" action="/counter/conditions"><h2>Today’s note</h2><label>What guests should know (the water, the wind, the trails)<textarea name="text" rows="2" maxlength="280">${escape(desk.conditions().text)}</textarea></label><button type="submit">Post it</button></form>`;
  }

  const server = createServer(async (req, res) => {
    try {
      if (await desk.sync.handle(req, res)) return;
      if (zubra.handle(req, res)) return;
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname === '/health') return res.writeHead(200, { 'content-type': 'text/plain' }).end('ok');
      if (url.pathname === '/favicon.ico') return res.writeHead(204).end();
      const guest = guests.ensure(req, res);
      const onShift = Boolean(staff.read(req.headers.cookie ?? ''));

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
        if (url.pathname === '/staff/start') {
          res.setHeader('set-cookie', staff.cookie('counter'));
          return back(res, '/counter');
        }
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

      const p = zubra.page();
      if (url.pathname === '/') return page(res, p, 'Rentals', home(p, guest));
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
        if (!onShift) return page(res, p, 'The counter', `<section><h1>The counter</h1><p class="lede">This page is for the shop. Staff accounts come later; for the concept, any device can start a shift.</p></section><form method="post" action="/staff/start"><button type="submit">Start a counter shift</button></form>`);
        return page(res, p, 'The counter', counter(url));
      }
      send(res, 404, 'Not found');
    } catch (error) {
      console.error(error);
      if (!res.headersSent) send(res, 500, 'Something went wrong.');
      else res.end();
    }
  });

  server.on('close', () => desk.close());
  return Object.assign(server, { desk });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT ?? 3000);
  const server = await createApp();
  server.listen(port, '0.0.0.0', () => console.log(`Outfitter on http://localhost:${port}`));
}
