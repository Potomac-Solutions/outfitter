// The rental desk: what the server knows, and what only it may decide.
//
// Everything lives in one Sync log (a SQLite file), read and written through the kit's store.
// The kit does the deciding: `hold` gives a boat to one person at a time, `reserve` books the
// same boats on every day of a booking and charges once, `stages` moves a rental from booked to
// out to returned. This file says what the shop rents, puts the answers into words, and keeps
// the two things the kit doesn't: each booking's riders and signed waiver, and the conditions
// note the staff post.
//
//   units/<fleet>/<date>/<unit>   held or taken, by whom, until when     (kit hold)
//   bookings/<key>                the draft: days, boats, price, state   (kit reserve)
//   rentals/<key>                 a paid booking: booked → out → returned (kit stages)
//   waivers/<key>                 riders, their sizes, who signed and when
//   conditions/shop               the note on the home page, live
import { createSyncServer } from '@zubra/sync/server';
import { sqliteLog } from '@zubra/sync/sqlite';
import { syncStore, serverOnly, SERVER_ONLY } from '@potomac-solutions/kit/store';
import { createHolds } from '@potomac-solutions/kit/hold';
import { createReserve } from '@potomac-solutions/kit/reserve';
import { createPay, testProvider } from '@potomac-solutions/kit/pay';
import { createStages } from '@potomac-solutions/kit/stages';
import { moment } from '@potomac-solutions/kit/price';
import { shop, fleets, DAYS_AHEAD } from './shop.js';

const DAY = 86_400_000;
const fleetsById = new Map(fleets.map((fleet) => [fleet.id, fleet]));

/** A booking's code: what the counter types or scans. */
const KEY = /^r[a-z0-9]{8,24}$/;
const newKey = () => `r${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;

/** The days that can be booked, from today on the shop's clock: `YYYY-MM-DD`. */
export function bookableDays(now = Date.now()) {
  return Array.from({ length: DAYS_AHEAD }, (_, i) => moment(new Date(now + i * DAY), shop.timeZone).date);
}

/** "Sat 21 Nov" for a `YYYY-MM-DD` (noon UTC, so the date is the same everywhere). */
export const dayLabel = (date) => new Intl.DateTimeFormat('en-US', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${date}T12:00:00Z`));

const poolOf = (fleet, date) => `${fleet}/${date}`;
const parsePool = (pool) => {
  const at = pool.indexOf('/');
  return { fleet: pool.slice(0, at), date: pool.slice(at + 1) };
};

export async function createRentals({ db = ':memory:', holdMs = 10 * 60_000, sweepMs = 1000, now = Date.now } = {}) {
  // Who is asking, from a request: server.js says how.
  let who = () => null;
  const mine = (pub) => store.under('rentals').filter((rental) => rental.holder === pub).map((rental) => rental.key);

  const sync = createSyncServer({
    log: await sqliteLog(db),
    // Pages write nothing: every collection here is the server's.
    authorize: serverOnly([...SERVER_ONLY, 'rentals', 'waivers', 'conditions'], ({ kind }) => kind === 'read'),
    // A page reads the conditions note and its own rentals; nobody else's names or sizes.
    scope({ request }) {
      const guest = who(request);
      const keys = guest ? mine(guest.pub) : [];
      return { conditions: true, ...(keys.length ? { rentals: keys } : {}) };
    },
  });
  const store = await syncStore(sync);

  const holds = createHolds({ store, holdMs, sweepMs, max: 6, now });
  const rentals = createStages({ store, collection: 'rentals', steps: ['booked', 'out', 'returned'], may: ({ to }) => to === 'out' || to === 'returned', now });
  const reserve = createReserve({
    store,
    holds,
    pay: createPay({ provider: testProvider(), store, now }),
    stages: rentals,
    base: (unit, pool) => fleetsById.get(parsePool(pool).fleet).cents,
    // Weekend days cost the fleet's weekend price.
    rules: fleets.map((fleet) => ({ label: 'Weekend', when: { fleet: fleet.id, day: [0, 6] }, set: fleet.weekend })),
    context: (pool) => {
      const { fleet, date } = parsePool(pool);
      return { fleet, ...moment(new Date(`${date}T12:00:00Z`), 'UTC') };
    },
    pools: (pool) => {
      const { fleet, date } = parsePool(pool);
      return fleetsById.has(fleet) && bookableDays(now()).includes(date);
    },
    now,
  });

  /** The guest's draft for a fleet (held, or tried and declined), newest first. */
  const draft = (pub, fleet) =>
    store
      .under('bookings')
      .filter((booking) => booking.holder === pub && (booking.state === 'held' || booking.state === 'failed') && parsePool(booking.pools[0]).fleet === fleet)
      .sort((a, b) => b.at - a.at)[0] ?? null;

  const WORDS = {
    'none-free': (answer) => (answer.left ? `Only ${answer.left} free on every one of those days.` : 'None free on every one of those days.'),
    'no-pools': () => 'Pick at least one day.',
    'unknown-pool': () => 'Pick from the days shown.',
    'bad-count': () => 'Choose how many.',
    taken: () => 'Someone just took one of those. Pick again.',
    limit: () => 'That’s more than one person can hold at once.',
    lapsed: () => 'Your hold ran out and someone else took one. Pick your days again.',
    declined: () => 'That card was declined. Try another.',
    'in-progress': () => 'Your booking is already going through.',
    'lapsed-after-payment': () => 'Your hold ran out while the payment went through. The shop will refund it.',
  };
  const words = (answer) => ({ error: (WORDS[answer.error] ?? (() => 'That didn’t go through. Try again.'))(answer) });

  return {
    sync,
    store,
    shop,
    fleets,
    fleet: (id) => fleetsById.get(id) ?? null,
    holdMs,
    /** How the desk tells who a request is from. */
    identify(fn) {
      who = fn;
    },

    /** A fleet's next days: how many are free each day, and whether the guest holds any. */
    days(fleet, pub = '') {
      return reserve.days(bookableDays(now()).map((date) => poolOf(fleet.id, date)), fleet.units, pub).map((day) => ({ ...day, label: dayLabel(parsePool(day.pool).date) }));
    },

    draft: (guest, fleet) => (guest ? draft(guest.pub, fleet) : null),

    /** Hold `count` of a fleet on the ticked days: the same boats every day, or none. */
    async hold(guest, fleet, form) {
      if (!guest) return { error: 'Open the page again to book.' };
      const dates = form.getAll('pool').map(String);
      const count = Number(form.get('count'));
      const before = draft(guest.pub, fleet.id);
      const answer = await reserve.hold(guest.pub, { key: before?.key ?? newKey(), pools: dates, count, from: fleet.units });
      return answer.ok ? answer : words(answer);
    },

    /** Let go of the guest's draft. */
    async release(guest, fleet) {
      const before = guest && draft(guest.pub, fleet.id);
      if (before) await reserve.release(guest.pub, before.key);
      return { ok: true };
    },

    waiver: (key) => store.get('waivers', key),

    /**
     * Riders and the waiver, before paying: one rider per boat, each with a name and a size, and
     * the waiver agreed to and signed with a full name.
     */
    async sign(guest, key, form) {
      const booking = store.get('bookings', key);
      if (!guest || !booking || booking.holder !== guest.pub || !['held', 'failed'].includes(booking.state)) return { error: 'Your hold ran out. Pick your days again.' };
      const fleet = fleetsById.get(parsePool(booking.pools[0]).fleet);
      const riders = booking.units.map((unit, i) => ({ unit, name: String(form.get(`name-${i}`) ?? '').trim().slice(0, 80), size: String(form.get(`size-${i}`) ?? '') }));
      if (riders.some((rider) => !rider.name)) return { error: 'Give every rider’s name.' };
      if (riders.some((rider) => !fleet.sizing.choices.includes(rider.size))) return { error: `Choose every rider’s ${fleet.sizing.short}.` };
      if (form.get('agree') !== 'yes') return { error: 'Agree to the waiver to go on.' };
      const signedBy = String(form.get('signature') ?? '').trim().slice(0, 80);
      if (signedBy.split(/\s+/).length < 2) return { error: 'Sign with your full name.' };
      await store.write('waivers', key, { riders, signedBy, agreed: shop.waiver, at: now() });
      return { ok: true };
    },

    /** Pay for a held, signed booking. Paid: the boats are taken on every day, and it's a rental. */
    async book(guest, form) {
      const key = String(form.get('checkout') ?? '');
      const booking = KEY.test(key) && store.get('bookings', key);
      if (!guest || !booking || booking.holder !== guest.pub) return { error: 'Your hold ran out. Pick your days again.' };
      const waiver = store.get('waivers', key);
      if (!waiver) return { error: 'Sign the waiver first.', key };
      const done = await reserve.book(guest.pub, key, {
        method: { card: String(form.get('card') ?? '') },
        fields: { name: String(form.get('name') ?? '').trim().slice(0, 80), email: String(form.get('email') ?? '').trim().slice(0, 200), phone: String(form.get('phone') ?? '').trim().slice(0, 40), fleet: parsePool(booking.pools[0]).fleet, days: booking.pools.map((pool) => parsePool(pool).date), signedBy: waiver.signedBy },
        description: `${shop.name} rental (test mode)`,
      });
      return done.ok ? { ok: true, key } : { ...words(done), key };
    },

    /** A rental the guest owns, or null. */
    rental(guest, key) {
      const rental = KEY.test(key) && store.get('rentals', key);
      return rental && guest && rental.holder === guest.pub ? { key, ...rental, fleet: fleetsById.get(rental.fleet) } : null;
    },

    /** The guest's rentals, soonest first. */
    rentalsFor(guest) {
      if (!guest) return [];
      return store
        .under('rentals')
        .filter((rental) => rental.holder === guest.pub)
        .map((rental) => ({ ...rental, fleet: fleetsById.get(rental.fleet) }))
        .sort((a, b) => (a.days[0] < b.days[0] ? -1 : 1));
    },

    /**
     * The counter's day: rentals starting today waiting to go out, and every rental that's out.
     * With riders and sizes (the counter needs them); never the card.
     */
    counter() {
      const today = bookableDays(now())[0];
      const all = store.under('rentals').map((rental) => ({ ...rental, fleet: fleetsById.get(rental.fleet), riders: store.get('waivers', rental.key)?.riders ?? [] }));
      return {
        today,
        pickups: all.filter((rental) => rental.status === 'booked' && rental.days.includes(today)),
        out: all.filter((rental) => rental.status === 'out'),
      };
    },

    /** The counter hands a rental out, or takes it back. Each step once. */
    async move(key, to) {
      key = String(key ?? '').trim();
      const rental = KEY.test(key) && store.get('rentals', key);
      if (!rental) return { error: 'That isn’t one of our rentals.' };
      const done = await rentals.advance(key, to);
      if (done.ok) return { ok: true, rental: { key, ...store.get('rentals', key), fleet: fleetsById.get(rental.fleet) } };
      if (done.error === 'wrong-step') return { error: { booked: 'That rental hasn’t gone out yet.', out: 'That rental is already out.', returned: 'That rental is already back.' }[done.at] ?? 'Not now.' };
      return { error: 'That didn’t go through.' };
    },

    /** The staff's note about today: the water, the trails, what's sold out. Everyone sees it live. */
    async setConditions(text) {
      await store.write('conditions', 'shop', { text: String(text ?? '').trim().slice(0, 280), at: now() });
      return { ok: true };
    },
    conditions: () => store.get('conditions', 'shop') ?? { text: '', at: 0 },

    close() {
      holds.close?.();
    },
  };
}
