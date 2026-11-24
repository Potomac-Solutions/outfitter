// Demo data: an owner and a counter hand, forty customers, four months of rentals behind today
// and two weeks of bookings ahead, so every admin page and report has something to show.
//
//   npm run seed            add to an empty shop (refuses if it has rentals)
//   npm run seed -- --fresh start over: delete the database first
//
// Past rentals are written as finished records. Today's and future ones go through the real
// booking (hold, waiver, pay), so their boats are taken and the counter sees them.
// The names are made up and every address is @example.com. Run it with the server stopped.
import { existsSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../server.js';
import { bookableDays } from '../src/rentals.js';
import { moment } from '@potomac-solutions/kit/price';

const here = dirname(fileURLToPath(import.meta.url));
const db = join(process.env.DATA_DIR ?? join(here, '..'), 'outfitter.db');
const fresh = process.argv.includes('--fresh');
if (fresh) for (const file of [db, `${db}-wal`, `${db}-shm`]) if (existsSync(file)) rmSync(file);

// The demo sign-ins live in src/demo.js, so the public demo can show and protect them.
import { DEMO } from '../src/demo.js';
export { DEMO };

// The same "random" shop every time.
let seed = 20261115;
const random = () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const pick = (list) => list[Math.floor(random() * list.length)];
const weighted = (pairs) => {
  let roll = random() * pairs.reduce((sum, [, w]) => sum + w, 0);
  for (const [value, w] of pairs) if ((roll -= w) < 0) return value;
  return pairs.at(-1)[0];
};

const FIRST = ['Avery', 'Blake', 'Casey', 'Drew', 'Emerson', 'Finley', 'Harper', 'Jamie', 'Kendall', 'Logan', 'Morgan', 'Noah', 'Parker', 'Quinn', 'Reese', 'Sawyer', 'Taylor', 'Peyton', 'Rowan', 'Skyler', 'Elliot', 'Hayden', 'Jordan', 'Kai', 'Lane', 'Micah', 'Sasha', 'Tatum', 'Wren', 'Ari'];
const LAST = ['Abbott', 'Barnes', 'Calloway', 'Dunmore', 'Ellison', 'Fairbanks', 'Garrett', 'Holloway', 'Iverson', 'Jessup', 'Kessler', 'Lowry', 'Marsh', 'Nolan', 'Oakley', 'Pruitt', 'Ramsey', 'Sutton', 'Thayer', 'Underwood', 'Vance', 'Whitaker', 'Yates', 'Zeller'];
const person = () => {
  const name = `${pick(FIRST)} ${pick(LAST)}`;
  return { name, email: `${name.toLowerCase().replace(' ', '.')}${Math.floor(random() * 90 + 10)}@example.com`, phone: `301-555-0${String(Math.floor(random() * 200)).padStart(3, '0')}` };
};

const DAY = 86_400_000;
const realNow = Date.now();
let clock = realNow - 160 * DAY;
const server = await createApp({ db, cache: false, now: () => clock });
const { desk, staff, customers } = server;
const { shop } = desk;

if (desk.store.under('rentals').length) {
  console.log(`The shop in ${db} already has rentals. Run \`npm run seed -- --fresh\` to start over.`);
  process.exit(1);
}

/** A local clock time on a date in the shop's zone, as an instant. */
function at(date, hour, minute = 0) {
  let guess = Date.parse(`${date}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00Z`) + 5 * 3_600_000;
  for (let i = 0; i < 3; i++) {
    const local = moment(new Date(guess), shop.timeZone);
    const h = Number(local.time.slice(0, 2));
    const off = local.date === date ? h - hour : local.date > date ? 24 + h - hour : h - hour - 24;
    if (!off) break;
    guess -= off * 3_600_000;
  }
  return guess;
}
const dateOf = (ms) => moment(new Date(ms), shop.timeZone).date;
const addDays = (date, n) => new Date(Date.parse(`${date}T12:00:00Z`) + n * DAY).toISOString().slice(0, 10);
const weekend = (date) => [0, 6].includes(new Date(`${date}T12:00:00Z`).getUTCDay());

// The staff.
clock = realNow - 150 * DAY;
const owned = await staff.accept(await staff.setup(), DEMO.owner);
if (!owned.ok) throw new Error(owned.error);
const ownerView = staff.list().find((one) => one.email === DEMO.owner.email);
const invited = await staff.invite(ownerView, { email: DEMO.staff.email, name: DEMO.staff.name, roles: ['staff'] });
await staff.accept(invited.token, DEMO.staff);
const counterHand = staff.list().find((one) => one.email === DEMO.staff.email);

// Customers with accounts, joining over five months; the demo customer joined early.
const accounts = [];
clock = realNow - 140 * DAY;
const riley = await customers.signUp(DEMO.customer);
accounts.push({ id: riley.customer, ...DEMO.customer, at: clock, phone: '301-555-0142' });
for (let i = 0; i < 40; i++) {
  clock = realNow - Math.floor(random() * 140 + 1) * DAY - Math.floor(random() * DAY);
  const who = person();
  const made = await customers.signUp({ ...who, password: `demo-password-${i}-${Math.floor(random() * 1e6)}` });
  if (made.ok) accounts.push({ id: made.customer, ...who, at: clock });
}
// Two accounts the owner turned off.
for (const one of accounts.slice(-2)) await customers.setDisabled(one.id, true);

// Four months of finished rentals. Busier in summer and on weekends.
const SEASON = { 7: 3.2, 8: 3.6, 9: 2.2, 10: 1.3, 11: 0.5 };
const taken = new Map(); // fleet/date → units out
const free = (fleet, days) => fleet.units.filter((unit) => days.every((day) => !taken.get(`${fleet.id}/${day}`)?.has(unit)));
const today = dateOf(realNow);
let past = 0;
for (let date = addDays(today, -120); date < today; date = addDays(date, 1)) {
  const month = Number(date.slice(5, 7));
  const expected = (SEASON[month] ?? 0.4) * (weekend(date) ? 1.9 : 1);
  const starts = Math.round(expected * (0.6 + random() * 0.8));
  for (let n = 0; n < starts; n++) {
    const fleet = desk.fleet(weighted([['kayaks', 45], ['boards', 30], ['bikes', 25]]));
    const length = weighted([[1, 62], [2, 28], [3, 10]]);
    const days = Array.from({ length }, (_, i) => addDays(date, i)).filter((day) => day < today);
    const units = free(fleet, days).slice(0, weighted([[1, 50], [2, 35], [3, 12], [4, 3]]));
    if (!units.length) continue;
    for (const day of days) {
      const set = taken.get(`${fleet.id}/${day}`) ?? new Set();
      units.forEach((unit) => set.add(unit));
      taken.set(`${fleet.id}/${day}`, set);
    }
    const lines = days.flatMap((day) => units.map((unit) => ({ pool: `${fleet.id}/${day}`, unit, base: fleet.cents, cents: weekend(day) ? fleet.weekend : fleet.cents, applied: weekend(day) ? ['Weekend'] : [] })));
    const booked = Math.min(at(date, 7) - 1, at(addDays(date, -Math.floor(random() * 10)), 8 + Math.floor(random() * 13), Math.floor(random() * 60)));
    const known = random() < 0.6 ? accounts.filter((one) => one.at < booked) : [];
    const account = known.length ? (random() < 0.04 ? accounts[0] : pick(known)) : null;
    const who = account ?? person();
    const riders = units.map((unit, i) => ({ unit, name: i === 0 ? who.name : `${pick(FIRST)} ${who.name.split(' ')[1]}`, size: pick(fleet.sizing.choices) }));
    const key = `r${booked.toString(36)}${Math.floor(random() * 36 ** 6).toString(36).padStart(6, '0')}`;
    await desk.store.write('rentals', key, {
      name: who.name, email: who.email, phone: who.phone ?? '', fleet: fleet.id, days, signedBy: who.name, customer: account?.id ?? '',
      holder: `seed-${key}`, pools: days.map((day) => `${fleet.id}/${day}`), units, lines, cents: lines.reduce((sum, line) => sum + line.cents, 0),
      status: 'returned', booked, out: at(date, 8 + Math.floor(random() * 3), Math.floor(random() * 60)), returned: at(days.at(-1), 14 + Math.floor(random() * 4), Math.floor(random() * 60)),
    });
    await desk.store.write('waivers', key, { riders, signedBy: who.name, agreed: shop.waiver, at: booked });
    past++;
  }
}

// Today and the next two weeks, through the real booking.
clock = realNow;
const ahead = bookableDays(realNow);
let coming = 0;
const outToday = [];
for (let i = 0; i < 26; i++) {
  const start = i < 5 ? 0 : 1 + Math.floor(random() * (ahead.length - 3));
  const fleet = desk.fleet(weighted([['kayaks', 45], ['boards', 30], ['bikes', 25]]));
  const length = weighted([[1, 65], [2, 25], [3, 10]]);
  const days = ahead.slice(start, start + length);
  const count = weighted([[1, 55], [2, 35], [3, 10]]);
  const account = random() < 0.6 ? (i === 6 || i === 1 ? accounts[0] : pick(accounts.slice(0, -2))) : null;
  const who = account ?? person();
  const guest = { pub: `seed-guest-${i}`, customer: account?.id };
  const held = await desk.hold(guest, fleet, new URLSearchParams([...days.map((day) => ['pool', `${fleet.id}/${day}`]), ['count', String(count)]]));
  if (!held.ok) continue;
  const riders = Object.fromEntries(held.units.flatMap((_, n) => [[`name-${n}`, n === 0 ? who.name : `${pick(FIRST)} ${who.name.split(' ')[1]}`], [`size-${n}`, pick(fleet.sizing.choices)]]));
  await desk.sign(guest, held.key, new URLSearchParams({ ...riders, agree: 'yes', signature: who.name }));
  const paid = await desk.book(guest, new URLSearchParams({ checkout: held.key, name: who.name, email: who.email, phone: who.phone ?? '', card: '4242 4242 4242 4242' }));
  if (!paid.ok) continue;
  // Booked some days ago, as real bookings would have been.
  const bookedAt = Math.min(realNow - 3_600_000, at(dateOf(realNow - Math.floor(random() * 9 + 1) * DAY), 8 + Math.floor(random() * 13), Math.floor(random() * 60)));
  await desk.store.write('rentals', held.key, { booked: bookedAt });
  if (start === 0 && outToday.length < 2) outToday.push(held.key);
  coming++;
}
for (const key of outToday) {
  await desk.move(key, 'out');
  await desk.audit(counterHand, `handed out ${key} at the counter`, key);
}
await desk.setConditions('Light west wind, water 52°F. Trails dry; wear layers, it warms up after 11.');
await desk.audit(counterHand, 'posted today’s note');
clock = realNow - 20 * DAY;
await desk.audit(ownerView, `turned off ${accounts.at(-1).name}’s account`, accounts.at(-1).id);
clock = realNow;

console.log(`Seeded ${db}:
  ${accounts.length} customer accounts, ${past} past rentals, ${coming} from today on (${outToday.length} out now).

Sign in (this machine only; these are demo passwords):
  Owner     ${DEMO.owner.email} / ${DEMO.owner.password}      → /admin
  Staff     ${DEMO.staff.email} / ${DEMO.staff.password}    → /admin, /counter
  Customer  ${DEMO.customer.email} / ${DEMO.customer.password}      → /account

Then: npm start`);
desk.close();
process.exit(0);
