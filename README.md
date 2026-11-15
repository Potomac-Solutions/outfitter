# Outfitter

Rent and book, for a shop that rents things by the day: kayaks, paddleboards, bikes, skis. A guest picks days and how many, says who's riding and signs the waiver, pays once, and gets a pickup code. The counter hands rentals out and takes them back, and the guest's phone follows. A Potomac Solutions platform, built on the [kit](https://github.com/Potomac-Solutions/kit) and [Zubra](https://github.com/journey-to-code-org/zubra).

The shop it starts with, Lakeside Paddle & Pedal on Deep Creek Lake, is made up. Nothing here is really for rent, and payments are in test mode.

## Try it

`npm install`, then `npm run demo`: it fills the shop with four months of made-up rentals and forty customers, and starts it on http://localhost:3000. It prints three demo sign-ins, for this machine only:

| Who | Email | Password | Where |
| --- | --- | --- | --- |
| Owner | `owner@example.com` | `lakeside-owner-demo` | `/admin`: everything |
| Staff | `counter@example.com` | `lakeside-staff-demo` | `/admin` (overview, rentals, customers) and `/counter` |
| Customer | `riley@example.com` | `lakeside-guest-demo` | `/account` |

`npm start` alone keeps what's there. With an empty database it prints a setup link for the first owner instead; `npm run seed` fills an empty shop, and `npm run seed -- --fresh` starts over.

**The public side**
1. **The landing page** (`/`): the fleets and prices, how booking works, where and when, and the staff's note for the day.
2. **Book.** Choose Kayaks, tick two days (a Saturday shows the weekend price) and how many, and **Hold**. You get the same kayaks every day you booked. **Book**, then name each rider and their size, agree to the waiver and sign. **Pay** with any card number (`4000 0000 0000 0002` is declined, to see that; your hold stays). You get the rental with its pickup code.
3. **An account** (`/account`): sign up, and rentals booked from this browser join it. Signed in on another device, they're there too, and checkout fills in your name and email. **Forgot your password?** sends a one-time link; this demo sends no real email, so it lands in the owner's **Outbox** (and the server's log).

**The admin** (`/admin`, staff sign-in)
4. **Overview**: revenue and rentals for the last 30 days against the 30 before, today's pickups, how booked the next week is, new accounts, revenue by day, the latest rentals, and what the staff did.
5. **Rentals**: search by name, email or code, filter by status and fleet, page through, download the list as CSV. A rental's page has its prices line by line, riders, waiver and timeline, and **Hand out** / **Take back**.
6. **Customers**: every account with its rentals and spend, as CSV too. An owner can turn an account off (it's signed out everywhere) or email it a reset link.
7. **Reports** (owners): revenue and rentals by day, week or month in the shop's time zone, by fleet, the busiest weekdays, how booked the fleet was, the top customers, and a CSV of the numbers.
8. **Settings** (owners): each fleet's day and weekend prices and description, the shop's hours, pickup words and waiver. New holds use a new price at once; paid rentals keep theirs.
9. **The counter**: today's pickups with riders and sizes; **Hand out** and **Take back**, which guests' phones show live, and the day's note, which every open page shows at once.
10. **Without JavaScript** (turn it off in the browser's settings), all of it works the same.

## How it is put together

| Piece | Job |
| --- | --- |
| [Potomac kit](https://github.com/Potomac-Solutions/kit) (private) | `hold` (who has which boat, and when a hold ends), `reserve` (the same boats on every day of a booking, priced, paid once), `pay` (charged at most once; its test provider), `stages` (a rental: booked, out, returned), `price` (the weekend rule), `staff` and `staff/pages` (the owner and staff: passwords, sessions, invites, roles, and their pages), `auth` (the guest and counter cookies), `store` (the Sync log). The kit's `slot-picker`, `booking-summary` and `checkout-form`, from its package |
| `@zubra/server` | Renders every page before any JavaScript runs |
| `@zubra/sync` | The log (one SQLite file). The conditions note and each rental's status are documents only the server writes; pages follow them live, and read only the note and their own rentals |
| [symbology](https://github.com/journey-to-code-org/symbology) | Draws the pickup code (the rental's code) |
| `src/shop.js` | The shop, what it rents, prices, sizing questions and waiver, as data |
| `src/rentals.js` | The shop's side: which days and boats exist, riders and waivers, the counter, the note, the owner's settings, the staff activity, and the words |
| `kit/customers` | Customer accounts: sign-up, sign-in with lockout, sessions, reset links, turned off by an owner |
| `kit/reports`, `kit/charts` | The numbers by day, week or month in the shop's zone, and CSV; charts drawn on the server as SVG, with a table under each |
| `src/site.js`, `src/admin.js` | The landing page and account pages; the admin pages |
| `bin/seed.js` | The demo data |

## Run it

```sh
npm install      # needs read access to the private Potomac-Solutions/kit repository
npm start        # http://localhost:3000
npm test         # needs Chrome or Playwright's Chromium
```

Node 22.13 or later. `SESSION_SECRET` is required in production; `DATA_DIR` says where the database file goes. Behind a proxy (Railway, Fly, a load balancer), set `TRUST_PROXIES` to how many add to `X-Forwarded-For` (usually `1`), so a wrong-password lockout falls on the device guessing and not on everyone; left unset, no header is trusted and every sign-in counts as the proxy's address.

## What the tests prove

1. Without JavaScript: two days, two kayaks, the same boats both days, weekend prices; riders, sizes and the waiver; paying; the pickup code (symbology's drawing of the rental's code); those boats gone for everyone on those days; the rental on the home page.
2. The waiver comes first: each missing piece is refused with its own message, and paying before signing goes back to it.
3. The last bike on a day goes to one person, even when two ask at the same moment; a booking gets the same bikes every day or none; letting go frees them.
4. A declined card keeps the hold for another try, and the same booking is paid on the second. Another guest can't pay for it or see it. A hold that runs out books nothing.
5. The counter needs a staff sign-in; it sees riders and sizes; it hands a rental out once and takes it back once, and the guest sees each step live.
6. The note the counter posts reaches every open page at once, and is in the page without JavaScript.
7. A page reads the note and its own rentals, nothing else, even when it asks; it writes nothing; another site's post is refused.
8. With JavaScript, the whole booking in the browser; the kit's components come from its package.

9. The landing page shows the fleets and a way to book, and no admin link to a guest.
10. A customer's sign-up takes in the rentals booked from that browser; signed in elsewhere they follow, and so does a new booking; signed out, they don't.
11. A forgotten password gets the same page whether or not the account exists; the emailed link works once.
12. The admin needs a staff sign-in; staff get no reports, settings or outbox (403), and their posts to settings change nothing; owners get them all.
13. Staff search for a rental, hand it out from its page, and it shows in the activity.
14. A new price applies to new holds, weekend price included; paid rentals keep theirs. A bad price is refused.
15. A turned-off customer is signed out and can't sign in; only an owner can turn them back on.
16. The report's revenue matches the rentals; the CSV's days add up to it; a name starting with `=` opens in a spreadsheet as text.

Every behaviour was broken on purpose once to check a test fails (19 caught). One can't be: the rule letting pages write collections the app doesn't list is also refused by Sync's scope, which is checked first.

## Not yet

- Adding or retiring units and whole fleets, and the season's dates, from the admin (they're still in `src/shop.js`).
- Refunds and cancellations from the admin.
- A ski-shop season (rentals by the season, boot fitting), lessons and guided trips, which are the same hold with other units.
- A real payment provider, and real email.
