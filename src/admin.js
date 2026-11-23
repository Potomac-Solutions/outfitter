// The admin pages: the shop at a glance, every rental, customers, reports and settings.
//
// Staff see the dashboard, rentals and customers. Owners also see reports, settings and the
// outbox, and can turn a customer's account off. Every page is plain HTML and forms.
import { series, totals, breakdown, csv } from '@potomac-solutions/kit/reports';
import { escape } from './layout.js';
import { dayLabel, bookableDays } from './rentals.js';
import { money } from './site.js';
import { barChart, rankBars } from '@potomac-solutions/kit/charts';

const DAY = 86_400_000;
const STATUS = { booked: 'Booked', out: 'Out', returned: 'Returned' };
const badge = (status) => `<span class="badge ${status}">${STATUS[status] ?? escape(status)}</span>`;
const what = (rental) => `${rental.units.length} ${escape(rental.units.length === 1 ? rental.fleet.one : rental.fleet.name.toLowerCase())}`;
const PAGE = 25;

/** The report ranges: how far back, and the bucket. */
export const RANGES = {
  '30d': { label: 'Last 30 days', days: 30, by: 'day' },
  '13w': { label: 'Last 13 weeks', days: 91, by: 'week' },
  '12m': { label: 'Last 12 months', days: 365, by: 'month' },
};

export function createAdmin({ desk, customers, sent, now = Date.now }) {
  const { shop } = desk;
  const zone = shop.timeZone;
  const dateTime = (ms) => (ms ? new Date(ms).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: zone }) : '');
  const short = (start, by) => {
    const date = new Date(`${start}T12:00:00Z`);
    return by === 'month' ? date.toLocaleDateString('en-US', { month: 'short', year: '2-digit', timeZone: 'UTC' }) : date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
  };
  const paidAt = (rental) => rental.booked;
  const customerOf = (rental) => (rental.customer ? customers.get(rental.customer) : null);

  function nav(here, owner) {
    const link = (href, words) => `<a href="${href}"${here === href ? ' aria-current="page"' : ''}>${words}</a>`;
    return `<nav class="admin-nav" aria-label="Admin"><small>Shop</small>${link('/admin', 'Overview')}${link('/admin/rentals', 'Rentals')}${link('/admin/customers', 'Customers')}${link('/counter', 'The counter')}${
      owner ? `<small>Owner</small>${link('/admin/reports', 'Reports')}${link('/admin/settings', 'Settings')}${link('/staff/people', 'Staff')}${link('/admin/outbox', 'Outbox')}` : ''
    }</nav>`;
  }
  const frame = (here, owner, bar, body) => `<div class="admin">${nav(here, owner)}<div class="admin-body">${bar}${body}</div></div>`;

  function rentalRows(list) {
    if (!list.length) return '<p>None.</p>';
    return `<div class="table-wrap"><table><thead><tr><th scope="col">Rental</th><th scope="col">Customer</th><th scope="col">What</th><th scope="col">Days</th><th scope="col">Status</th><th scope="col" class="num">Paid</th></tr></thead><tbody>${list
      .map(
        (rental) =>
          `<tr><td><a href="/admin/rentals/${rental.key}">${escape(rental.key)}</a><br><small class="muted">${dateTime(rental.booked)}</small></td><td>${escape(rental.name || rental.signedBy)}${rental.customer ? ` <a href="/admin/customers/${escape(rental.customer)}" class="muted">(account)</a>` : ''}<br><small class="muted">${escape(rental.email)}</small></td><td>${escape(rental.fleet.name)}: ${escape(rental.units.join(', '))}</td><td>${rental.days.map(dayLabel).join(', ')}</td><td>${badge(rental.status)}</td><td class="num">${money(rental.cents)}</td></tr>`,
      )
      .join('')}</tbody></table></div>`;
  }

  /** Booked unit-days over available unit-days for these dates, as a share. */
  function utilization(rentals, dates, fleetList = desk.fleets) {
    const set = new Set(dates);
    const ids = new Set(fleetList.map((fleet) => fleet.id));
    const used = rentals.filter((rental) => ids.has(rental.fleet?.id ?? rental.fleet)).reduce((sum, rental) => sum + rental.units.length * rental.days.filter((day) => set.has(day)).length, 0);
    const capacity = fleetList.reduce((sum, fleet) => sum + fleet.units.length, 0) * dates.length;
    return capacity ? used / capacity : 0;
  }
  const percent = (share) => `${Math.round(share * 100)}%`;

  return {
    nav,

    dashboard({ who, owner, bar }) {
      const all = desk.allRentals();
      const at = now();
      const last30 = all.filter((rental) => paidAt(rental) > at - 30 * DAY);
      const before30 = all.filter((rental) => paidAt(rental) <= at - 30 * DAY && paidAt(rental) > at - 60 * DAY);
      const revenue = totals(last30, { amount: (rental) => rental.cents }).amount;
      const earlier = totals(before30, { amount: (rental) => rental.cents }).amount;
      const change = earlier ? Math.round(((revenue - earlier) / earlier) * 100) : null;
      const day = desk.counter();
      const people = customers.list();
      const newPeople = people.filter((one) => one.at > at - 30 * DAY).length;
      const week = bookableDays(at).slice(0, 7);
      const days = series(all, { at: paidAt, amount: (rental) => rental.cents, by: 'day', zone, from: at - 29 * DAY, to: at });
      const activity = desk.activity(8);
      return frame(
        '/admin',
        owner,
        bar,
        `<section><h1>Overview</h1><p class="lede">${escape(shop.name)}, ${dayLabel(day.today)}. Good to see you, ${escape(who.name.split(' ')[0])}.</p></section>
<div class="tiles">
  <div class="tile"><span>Revenue, last 30 days</span><strong>${money(revenue)}</strong><small>${change === null ? 'No earlier month to compare' : `${change >= 0 ? '▲' : '▼'} ${Math.abs(change)}% on the 30 days before`}</small></div>
  <div class="tile"><span>Rentals, last 30 days</span><strong>${last30.length}</strong><small>${before30.length} the 30 days before</small></div>
  <div class="tile"><span>Going out today</span><strong>${day.pickups.length}</strong><small>${day.out.length} out now</small></div>
  <div class="tile"><span>Booked, next 7 days</span><strong>${percent(utilization(all, week))}</strong><small>of the fleet’s days</small></div>
  <div class="tile"><span>Customer accounts</span><strong>${people.length}</strong><small>${newPeople} new in 30 days</small></div>
</div>
<section class="panel"><h2>Revenue by day, last 30 days</h2>${barChart(
          days.map((bucket) => ({ label: short(bucket.start, 'day'), value: bucket.amount, tip: `${dayLabel(bucket.start)}: ${money(bucket.amount)} from ${bucket.count} rental${bucket.count === 1 ? '' : 's'}` })),
          { name: 'Revenue', format: money },
        )}${owner ? '<p><a href="/admin/reports">All reports</a></p>' : ''}</section>
<section class="panel"><h2>Latest rentals</h2>${rentalRows(all.slice(0, 8))}<p><a href="/admin/rentals">Every rental</a></p></section>
<section class="panel"><h2>Staff activity</h2>${activity.length ? `<ul>${activity.map((one) => `<li><strong>${escape(one.by)}</strong> ${escape(one.what)} <small class="muted">${dateTime(one.at)}</small></li>`).join('')}</ul>` : '<p>Nothing yet.</p>'}</section>`,
      );
    },

    /** Filtered rentals, newest first: by status, fleet, and words (a name, an email, a code). */
    filterRentals(url) {
      const status = url.searchParams.get('status') ?? '';
      const fleet = url.searchParams.get('fleet') ?? '';
      const words = (url.searchParams.get('q') ?? '').trim().toLowerCase().slice(0, 80);
      return desk.allRentals().filter(
        (rental) =>
          (!status || rental.status === status) &&
          (!fleet || rental.fleet.id === fleet) &&
          (!words || [rental.key, rental.name, rental.email, rental.signedBy, rental.phone].some((field) => String(field ?? '').toLowerCase().includes(words))),
      );
    },

    rentals({ url, owner, bar }) {
      const list = this.filterRentals(url);
      const page = Math.max(1, Number.parseInt(url.searchParams.get('page') ?? '1', 10) || 1);
      const pages = Math.max(1, Math.ceil(list.length / PAGE));
      const shown = list.slice((page - 1) * PAGE, page * PAGE);
      const keep = (changes) => {
        const next = new URLSearchParams(url.searchParams);
        for (const [name, value] of Object.entries(changes)) next.set(name, value);
        return `/admin/rentals?${next}`;
      };
      const option = (value, words, current) => `<option value="${value}"${current === value ? ' selected' : ''}>${words}</option>`;
      const csvQuery = new URLSearchParams(url.searchParams);
      csvQuery.delete('page');
      return frame(
        '/admin/rentals',
        owner,
        bar,
        `<section><h1>Rentals</h1><p class="lede">${list.length} rental${list.length === 1 ? '' : 's'}, ${money(totals(list, { amount: (rental) => rental.cents }).amount)} in all.</p></section>
<form class="panel filters" method="get" action="/admin/rentals">
  <label>Search<input name="q" value="${escape(url.searchParams.get('q') ?? '')}" placeholder="Name, email or code"></label>
  <label>Status<select name="status">${option('', 'Any', url.searchParams.get('status') ?? '')}${Object.entries(STATUS).map(([value, words]) => option(value, words, url.searchParams.get('status'))).join('')}</select></label>
  <label>Fleet<select name="fleet">${option('', 'Any', url.searchParams.get('fleet') ?? '')}${desk.fleets.map((one) => option(one.id, escape(one.name), url.searchParams.get('fleet'))).join('')}</select></label>
  <button type="submit">Show</button>
  <a class="button light" href="/admin/rentals.csv?${csvQuery}">Download CSV</a>
</form>
<section class="panel">${rentalRows(shown)}
${pages > 1 ? `<p class="pager">${page > 1 ? `<a href="${escape(keep({ page: page - 1 }))}">Newer</a>` : ''}<span>Page ${page} of ${pages}</span>${page < pages ? `<a href="${escape(keep({ page: page + 1 }))}">Older</a>` : ''}</p>` : ''}</section>`,
      );
    },

    rentalsCsv(url) {
      return csv(this.filterRentals(url), [
        { key: 'key', label: 'Code' },
        { key: 'booked', label: 'Booked', value: (rental) => new Date(rental.booked).toISOString() },
        { key: 'status', label: 'Status' },
        { key: 'fleet', label: 'Fleet', value: (rental) => rental.fleet.name },
        { key: 'units', label: 'Units', value: (rental) => rental.units.join(' ') },
        { key: 'days', label: 'Days', value: (rental) => rental.days.join(' ') },
        { key: 'name', label: 'Name' },
        { key: 'email', label: 'Email' },
        { key: 'phone', label: 'Phone' },
        { key: 'cents', label: 'Paid (USD)', value: (rental) => rental.cents / 100 },
      ]);
    },

    rental({ rental, owner, bar, said }) {
      const account = customerOf(rental);
      const riders = rental.waiver?.riders ?? [];
      const next = rental.status === 'booked' ? ['out', 'Hand out'] : rental.status === 'out' ? ['returned', 'Take back'] : null;
      return frame(
        '/admin/rentals',
        owner,
        bar,
        `<section><a href="/admin/rentals">All rentals</a><h1>${what(rental)} · ${escape(rental.fleet.name)}</h1><p class="lede">${escape(rental.key)} · ${badge(rental.status)}</p></section>
${said}
<section class="two">
  <div class="panel"><h2>The booking</h2><dl class="facts"><dt>Days</dt><dd>${rental.days.map(dayLabel).join(', ')}</dd><dt>Units</dt><dd>${escape(rental.units.join(', '))}</dd><dt>Paid</dt><dd>${money(rental.cents)} (test mode)</dd>${rental.lines.map((line) => `<dt>${escape(line.unit)}, ${dayLabel(line.pool.slice(line.pool.indexOf('/') + 1))}</dt><dd>${money(line.cents)}${line.applied?.length ? ` <small class="muted">${escape(line.applied.join(', '))}</small>` : ''}</dd>`).join('')}</dl>
  ${next ? `<form method="post" action="/admin/rentals/${rental.key}/move"><input type="hidden" name="to" value="${next[0]}"><button type="submit">${next[1]}</button></form>` : ''}</div>
  <div class="panel"><h2>Who</h2><dl class="facts"><dt>Name</dt><dd>${escape(rental.name || rental.signedBy)}</dd><dt>Email</dt><dd>${escape(rental.email)}</dd><dt>Phone</dt><dd>${escape(rental.phone || '—')}</dd><dt>Account</dt><dd>${account ? `<a href="/admin/customers/${escape(account.customer)}">${escape(account.name)}</a>` : 'Booked as a guest'}</dd></dl></div>
</section>
<section class="two">
  <div class="panel"><h2>Riders</h2>${riders.length ? `<ul>${riders.map((rider) => `<li>${escape(rider.unit)}: ${escape(rider.name)} (${escape(rider.size)})</li>`).join('')}</ul>` : '<p>None recorded.</p>'}<p class="muted">Waiver signed by ${escape(rental.waiver?.signedBy ?? rental.signedBy)}${rental.waiver?.at ? `, ${dateTime(rental.waiver.at)}` : ''}.</p></div>
  <div class="panel"><h2>Timeline</h2><dl class="facts"><dt>Booked</dt><dd>${dateTime(rental.booked)}</dd><dt>Handed out</dt><dd>${dateTime(rental.out) || '—'}</dd><dt>Returned</dt><dd>${dateTime(rental.returned) || '—'}</dd></dl></div>
</section>`,
      );
    },

    customers({ url, owner, bar }) {
      const words = (url.searchParams.get('q') ?? '').trim().toLowerCase().slice(0, 80);
      const all = desk.allRentals();
      const stats = new Map();
      for (const rental of all) {
        if (!rental.customer) continue;
        const one = stats.get(rental.customer) ?? { count: 0, cents: 0, last: 0 };
        one.count += 1;
        one.cents += rental.cents;
        one.last = Math.max(one.last, rental.booked ?? 0);
        stats.set(rental.customer, one);
      }
      const list = customers.list().filter((one) => !words || one.name.toLowerCase().includes(words) || one.email.includes(words));
      const guests = new Set(all.filter((rental) => !rental.customer).map((rental) => rental.email.toLowerCase())).size;
      return frame(
        '/admin/customers',
        owner,
        bar,
        `<section><h1>Customers</h1><p class="lede">${customers.list().length} with accounts; ${guests} more booked as guests.</p></section>
<form class="panel filters" method="get" action="/admin/customers"><label>Search<input name="q" value="${escape(url.searchParams.get('q') ?? '')}" placeholder="Name or email"></label><button type="submit">Show</button><a class="button light" href="/admin/customers.csv">Download CSV</a></form>
<section class="panel"><div class="table-wrap"><table><thead><tr><th scope="col">Customer</th><th scope="col">Joined</th><th scope="col" class="num">Rentals</th><th scope="col" class="num">Spent</th><th scope="col">Last booked</th></tr></thead><tbody>${list
          .map((one) => {
            const s = stats.get(one.customer) ?? { count: 0, cents: 0, last: 0 };
            return `<tr><td><a href="/admin/customers/${escape(one.customer)}">${escape(one.name)}</a>${one.disabled ? ' <span class="badge off">Off</span>' : ''}<br><small class="muted">${escape(one.email)}</small></td><td>${dateTime(one.at)}</td><td class="num">${s.count}</td><td class="num">${money(s.cents)}</td><td>${s.last ? dateTime(s.last) : '—'}</td></tr>`;
          })
          .join('')}</tbody></table></div></section>`,
      );
    },

    customersCsv() {
      const all = desk.allRentals();
      return csv(customers.list(), [
        { key: 'name', label: 'Name' },
        { key: 'email', label: 'Email' },
        { key: 'at', label: 'Joined', value: (one) => new Date(one.at).toISOString() },
        { key: 'disabled', label: 'Turned off', value: (one) => (one.disabled ? 'yes' : 'no') },
        { key: 'rentals', label: 'Rentals', value: (one) => all.filter((rental) => rental.customer === one.customer).length },
        { key: 'spent', label: 'Spent (USD)', value: (one) => all.filter((rental) => rental.customer === one.customer).reduce((sum, rental) => sum + rental.cents, 0) / 100 },
      ]);
    },

    customer({ one, owner, bar, said }) {
      const rentals = desk.allRentals().filter((rental) => rental.customer === one.customer);
      return frame(
        '/admin/customers',
        owner,
        bar,
        `<section><a href="/admin/customers">All customers</a><h1>${escape(one.name)}</h1><p class="lede">${escape(one.email)} · joined ${dateTime(one.at)}${one.disabled ? ' · <span class="badge off">Turned off</span>' : ''}</p></section>
${said}
<div class="tiles"><div class="tile"><span>Rentals</span><strong>${rentals.length}</strong></div><div class="tile"><span>Spent</span><strong>${money(totals(rentals, { amount: (rental) => rental.cents }).amount)}</strong></div><div class="tile"><span>Favourite</span><strong>${escape(breakdown(rentals, { key: (rental) => rental.fleet.name })[0]?.key ?? '—')}</strong></div></div>
<section class="panel"><h2>Rentals</h2>${rentalRows(rentals)}</section>
${
  owner
    ? `<section class="panel"><h2>Account</h2><p>Turning an account off signs it out everywhere; its rentals stay.</p><div class="filters"><form method="post" action="/admin/customers/${escape(one.customer)}/disabled"><input type="hidden" name="disabled" value="${one.disabled ? 'no' : 'yes'}"><button type="submit" class="${one.disabled ? '' : 'button light'}">${one.disabled ? 'Turn back on' : 'Turn off'}</button></form>${one.disabled ? '' : `<form method="post" action="/admin/customers/${escape(one.customer)}/reset"><button class="button light" type="submit">Email a reset link</button></form>`}</div></section>`
    : ''
}`,
      );
    },

    /** The numbers for a range and fleet, shared by the report page and its CSV. */
    report(url) {
      const range = RANGES[url.searchParams.get('range')] ? url.searchParams.get('range') : '30d';
      const { days, by, label } = RANGES[range];
      const fleet = desk.fleet(url.searchParams.get('fleet') ?? '');
      const to = now();
      const from = to - (days - 1) * DAY;
      const rentals = desk.allRentals().filter((rental) => (!fleet || rental.fleet.id === fleet.id) && paidAt(rental) >= from && paidAt(rental) <= to);
      const buckets = series(rentals, { at: paidAt, amount: (rental) => rental.cents, by, zone, from, to });
      return { range, label, by, fleet, from, to, rentals, buckets };
    },

    reports({ url, owner, bar }) {
      const { range, label, by, fleet, from, to, rentals, buckets } = this.report(url);
      const sum = totals(rentals, { amount: (rental) => rental.cents });
      const unitDays = rentals.reduce((n, rental) => n + rental.units.length * rental.days.length, 0);
      const dates = [];
      for (let at = from; at <= to; at += DAY) dates.push(new Date(at).toLocaleDateString('en-CA', { timeZone: zone }));
      const fleetRows = desk.fleets.filter((one) => !fleet || one.id === fleet.id);
      const byFleet = breakdown(rentals, { key: (rental) => rental.fleet.name, amount: (rental) => rental.cents }).sort((a, b) => b.amount - a.amount);
      const weekday = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((name, i) => ({
        label: name,
        value: rentals.reduce((n, rental) => n + rental.units.length * rental.days.filter((day) => (new Date(`${day}T12:00:00Z`).getUTCDay() + 6) % 7 === i).length, 0),
      }));
      const top = breakdown(rentals, { key: (rental) => rental.email.toLowerCase(), amount: (rental) => rental.cents })
        .sort((a, b) => b.amount - a.amount)
        .slice(0, 8)
        .map((row) => ({ ...row, name: rentals.find((rental) => rental.email.toLowerCase() === row.key)?.name || row.key }));
      const link = (changes) => {
        const next = new URLSearchParams(url.searchParams);
        for (const [name, value] of Object.entries(changes)) (value ? next.set(name, value) : next.delete(name));
        return `?${next}`;
      };
      const chip = (href, words, on) => `<a class="button${on ? '' : ' light'}" href="${escape(href)}"${on ? ' aria-current="true"' : ''}>${words}</a>`;
      return frame(
        '/admin/reports',
        owner,
        bar,
        `<section><h1>Reports</h1><p class="lede">${label}${fleet ? `, ${escape(fleet.name.toLowerCase())}` : ''}, by ${by}, in the shop’s time (${escape(zone)}). Counted on the day each rental was paid for.</p></section>
<div class="panel filters" role="group" aria-label="Range and fleet">${Object.entries(RANGES).map(([key, one]) => chip(link({ range: key }), one.label, key === range)).join('')}
<span class="muted">·</span>${chip(link({ fleet: '' }), 'All fleets', !fleet)}${desk.fleets.map((one) => chip(link({ fleet: one.id }), escape(one.name), fleet?.id === one.id)).join('')}</div>
<div class="tiles">
  <div class="tile"><span>Revenue</span><strong>${money(sum.amount)}</strong></div>
  <div class="tile"><span>Rentals</span><strong>${sum.count}</strong></div>
  <div class="tile"><span>Average rental</span><strong>${money(sum.count ? Math.round(sum.amount / sum.count) : 0)}</strong></div>
  <div class="tile"><span>Unit-days rented</span><strong>${unitDays}</strong></div>
  <div class="tile"><span>Fleet booked</span><strong>${percent(utilization(desk.allRentals(), dates, fleetRows))}</strong><small>of its days in the range</small></div>
</div>
<section class="panel"><h2>Revenue by ${by}</h2>${barChart(
          buckets.map((bucket) => ({ label: short(bucket.start, by), value: bucket.amount, tip: `${by === 'week' ? 'Week of ' : ''}${short(bucket.start, by)}: ${money(bucket.amount)} from ${bucket.count} rental${bucket.count === 1 ? '' : 's'}` })),
          { name: 'Revenue', format: money },
        )}<p><a class="button light" href="/admin/reports.csv${escape(link({}))}">Download CSV</a></p></section>
<section class="panel"><h2>Rentals by ${by}</h2>${barChart(
          buckets.map((bucket) => ({ label: short(bucket.start, by), value: bucket.count })),
          { name: 'Rentals', format: (n) => String(n) },
        )}</section>
<section class="two">
  <div class="panel"><h2>Revenue by fleet</h2>${byFleet.length ? rankBars(byFleet.map((row) => ({ label: row.key, value: row.amount })), { format: money }) : '<p>None in this range.</p>'}</div>
  <div class="panel"><h2>Busiest days of the week</h2><p class="muted">Units out on each weekday</p>${rankBars(weekday, { format: (n) => String(n) })}</div>
</section>
<section class="panel"><h2>Top customers</h2>${top.length ? `<div class="table-wrap"><table><thead><tr><th scope="col">Customer</th><th scope="col" class="num">Rentals</th><th scope="col" class="num">Spent</th></tr></thead><tbody>${top.map((row) => `<tr><td>${escape(row.name)}<br><small class="muted">${escape(row.key)}</small></td><td class="num">${row.count}</td><td class="num">${money(row.amount)}</td></tr>`).join('')}</tbody></table></div>` : '<p>None in this range.</p>'}</section>`,
      );
    },

    reportCsv(url) {
      const { buckets, by } = this.report(url);
      return csv(buckets, [
        { key: 'start', label: by === 'day' ? 'Day' : by === 'week' ? 'Week starting' : 'Month' },
        { key: 'count', label: 'Rentals' },
        { key: 'amount', label: 'Revenue (USD)', value: (bucket) => bucket.amount / 100 },
      ]);
    },

    settings({ owner, bar, said }) {
      const dollars = (cents) => (cents / 100).toFixed(2);
      return frame(
        '/admin/settings',
        owner,
        bar,
        `<section><h1>Settings</h1><p class="lede">Prices and words guests see. A change applies to new bookings at once; paid rentals keep their price.</p></section>
${said}
<section class="two">${desk.fleets
          .map(
            (one) => `<form class="panel" method="post" action="/admin/settings/fleet/${one.id}"><h2>${escape(one.name)}</h2>
<label>Day price ($)<input name="cents" inputmode="decimal" required value="${dollars(one.cents)}"></label>
<label>Saturday and Sunday price ($)<input name="weekend" inputmode="decimal" required value="${dollars(one.weekend)}"></label>
<label>Description<textarea name="blurb" rows="2" maxlength="200" required>${escape(one.blurb)}</textarea></label>
<p class="muted">${one.units.length} units: ${escape(one.units.join(', '))}</p>
<button type="submit">Save ${escape(one.name.toLowerCase())}</button></form>`,
          )
          .join('')}</section>
<form class="panel" method="post" action="/admin/settings/shop"><h2>The shop</h2>
<label>Hours<input name="hours" required maxlength="120" value="${escape(shop.hours)}"></label>
<label>Pickup<textarea name="pickup" rows="2" maxlength="240" required>${escape(shop.pickup)}</textarea></label>
<label>Waiver, one point per line<textarea name="waiver" rows="6" required>${escape(shop.waiver.join('\n'))}</textarea></label>
<p class="muted">A changed waiver applies to bookings signed from now on; each signed waiver keeps the words it was signed with.</p>
<button type="submit">Save the shop</button></form>`,
      );
    },

    outbox({ owner, bar }) {
      const list = [...sent].reverse();
      return frame(
        '/admin/outbox',
        owner,
        bar,
        `<section><h1>Outbox</h1><p class="lede">This demo sends no real email. What it would have sent since the server started is here, newest first.</p></section>
<section class="panel">${list.length ? list.map((message) => `<article class="stack" style="border-top:1px solid var(--border);padding-top:0.75rem"><p><strong>${escape(message.subject)}</strong><br><small class="muted">To ${escape(message.to)}</small></p><pre style="white-space:pre-wrap;margin:0">${escape(message.body)}</pre></article>`).join('') : '<p>Nothing sent yet.</p>'}</section>`,
      );
    },
  };
}
